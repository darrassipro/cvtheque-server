import { google, drive_v3 } from 'googleapis';
import { config } from '../../config/index.js';
import { GoogleDriveFile } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Google Drive Storage Service
 * Uses Service Account for backend-only access
 * CV files are NEVER public
 */
class GoogleDriveService {
  private drive: drive_v3.Drive | null = null;
  private folderId: string | null = null;
  private initialized: boolean = false;

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    if (!config.googleDrive.serviceAccountEmail || !config.googleDrive.privateKey) {
      logger.warn('Google Drive credentials not configured');
      return;
    }

    try {
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: config.googleDrive.serviceAccountEmail,
          private_key: config.googleDrive.privateKey,
        },
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      });

      this.drive = google.drive({ version: 'v3', auth });
      this.folderId = config.googleDrive.folderId || null;
      this.initialized = true;
      logger.info('Google Drive service initialized');
    } catch (error) {
      logger.error('Failed to initialize Google Drive service:', error);
    }
  }

  /**
   * Check if the service is available
   */
  isAvailable(): boolean {
    return this.initialized && this.drive !== null;
  }

  /**
   * Upload a file to Google Drive
   * Files are stored privately, accessible only via Service Account
   */
  async uploadFile(
    filePath: string,
    fileName: string,
    mimeType: string
  ): Promise<GoogleDriveFile> {
    if (!this.drive) {
      throw new Error('Google Drive service not initialized');
    }

    try {
      // Calculate file checksum
      const checksum = await this.calculateChecksum(filePath);

      const fileMetadata: drive_v3.Schema$File = {
        name: `${Date.now()}_${fileName}`,
        parents: this.folderId ? [this.folderId] : undefined,
      };

      const media = {
        mimeType,
        body: fs.createReadStream(filePath),
      };

      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id, name, mimeType, webViewLink',
      });

      const file = response.data;

      if (!file.id) {
        throw new Error('File upload failed: No file ID returned');
      }

      logger.info(`File uploaded to Google Drive: ${file.id}`);

      return {
        fileId: file.id,
        mimeType: file.mimeType || mimeType,
        name: file.name || fileName,
        webViewLink: file.webViewLink || undefined,
      };
    } catch (error) {
      logger.error('Google Drive upload error:', error);
      throw new Error(`Failed to upload file to Google Drive: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Download a file from Google Drive
   */
  async downloadFile(fileId: string): Promise<Buffer> {
    if (!this.drive) {
      throw new Error('Google Drive service not initialized');
    }

    try {
      const response = await this.drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );

      return Buffer.from(response.data as ArrayBuffer);
    } catch (error) {
      logger.error('Google Drive download error:', error);
      throw new Error(`Failed to download file from Google Drive: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(fileId: string): Promise<drive_v3.Schema$File> {
    if (!this.drive) {
      throw new Error('Google Drive service not initialized');
    }

    try {
      const response = await this.drive.files.get({
        fileId,
        fields: 'id, name, mimeType, size, createdTime, modifiedTime',
      });

      return response.data;
    } catch (error) {
      logger.error('Google Drive metadata error:', error);
      throw new Error(`Failed to get file metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a file from Google Drive
   */
  async deleteFile(fileId: string): Promise<void> {
    if (!this.drive) {
      throw new Error('Google Drive service not initialized');
    }

    try {
      await this.drive.files.delete({ fileId });
      logger.info(`File deleted from Google Drive: ${fileId}`);
    } catch (error) {
      logger.error('Google Drive delete error:', error);
      throw new Error(`Failed to delete file from Google Drive: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate a view-only link (backend use only)
   * The link requires authentication and is not publicly accessible
   */
  async getViewLink(fileId: string): Promise<string | null> {
    if (!this.drive) {
      throw new Error('Google Drive service not initialized');
    }

    try {
      const response = await this.drive.files.get({
        fileId,
        fields: 'webViewLink',
      });

      return response.data.webViewLink || null;
    } catch (error) {
      logger.error('Google Drive view link error:', error);
      return null;
    }
  }

  /**
   * Calculate SHA-256 checksum of a file
   */
  private async calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Create the CV storage folder if it doesn't exist
   */
  async ensureFolder(folderName: string = 'CVTech_CVs'): Promise<string> {
    if (!this.drive) {
      throw new Error('Google Drive service not initialized');
    }

    // Check if folder exists
    const response = await this.drive.files.list({
      q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
    });

    if (response.data.files && response.data.files.length > 0) {
      this.folderId = response.data.files[0].id!;
      return this.folderId;
    }

    // Create folder
    const folderMetadata: drive_v3.Schema$File = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    };

    const folder = await this.drive.files.create({
      requestBody: folderMetadata,
      fields: 'id',
    });

    this.folderId = folder.data.id!;
    logger.info(`Created Google Drive folder: ${folderName} (${this.folderId})`);

    return this.folderId;
  }
}

// Singleton instance
let googleDriveService: GoogleDriveService | null = null;

export function getGoogleDriveService(): GoogleDriveService {
  if (!googleDriveService) {
    googleDriveService = new GoogleDriveService();
  }
  return googleDriveService;
}

export { GoogleDriveService };