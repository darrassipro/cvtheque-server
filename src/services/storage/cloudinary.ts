import { v2 as cloudinary, UploadApiResponse, UploadApiOptions } from 'cloudinary';
import { config } from '../../config/index.js';
import { CloudinaryUploadResult } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Cloudinary Image Storage Service
 * Used ONLY for candidate profile photos extracted from CVs
 */
class CloudinaryService {
  private initialized: boolean = false;

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    if (!config.cloudinary.cloudName || !config.cloudinary.apiKey || !config.cloudinary.apiSecret) {
      logger.warn('Cloudinary credentials not configured');
      return;
    }

    try {
      cloudinary.config({
        cloud_name: config.cloudinary.cloudName,
        api_key: config.cloudinary.apiKey,
        api_secret: config.cloudinary.apiSecret,
        secure: true,
      });

      this.initialized = true;
      logger.info('Cloudinary service initialized');
    } catch (error) {
      logger.error('Failed to initialize Cloudinary service:', error);
    }
  }

  /**
   * Check if the service is available
   */
  isAvailable(): boolean {
    return this.initialized;
  }

  /**
   * Upload a profile photo
   * Applies optimization and transformation
   */
  async uploadProfilePhoto(
    imageBuffer: Buffer,
    options?: {
      folder?: string;
      publicId?: string;
    }
  ): Promise<CloudinaryUploadResult> {
    if (!this.initialized) {
      throw new Error('Cloudinary service not initialized');
    }

    try {
      const uploadOptions: UploadApiOptions = {
        folder: options?.folder || 'cvtech/profiles',
        public_id: options?.publicId,
        resource_type: 'image',
        transformation: [
          { width: 400, height: 400, crop: 'fill', gravity: 'face' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
        overwrite: true,
      };

      const result = await this.uploadBuffer(imageBuffer, uploadOptions);

      return {
        publicId: result.public_id,
        secureUrl: result.secure_url,
        width: result.width,
        height: result.height,
        format: result.format,
      };
    } catch (error) {
      logger.error('Cloudinary upload error:', error);
      throw new Error(`Failed to upload image to Cloudinary: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Upload a buffer to Cloudinary
   */
  private uploadBuffer(
    buffer: Buffer,
    options: UploadApiOptions
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        options,
        (error, result) => {
          if (error) {
            reject(error);
          } else if (result) {
            resolve(result);
          } else {
            reject(new Error('Upload returned no result'));
          }
        }
      );

      uploadStream.end(buffer);
    });
  }

  /**
   * Upload a file from path
   */
  async uploadFromPath(
    filePath: string,
    options?: UploadApiOptions
  ): Promise<CloudinaryUploadResult> {
    if (!this.initialized) {
      throw new Error('Cloudinary service not initialized');
    }

    try {
      const result = await cloudinary.uploader.upload(filePath, {
        folder: 'cvtech/profiles',
        resource_type: 'image',
        transformation: [
          { width: 400, height: 400, crop: 'fill', gravity: 'face' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
        ...options,
      });

      return {
        publicId: result.public_id,
        secureUrl: result.secure_url,
        width: result.width,
        height: result.height,
        format: result.format,
      };
    } catch (error) {
      logger.error('Cloudinary upload from path error:', error);
      throw new Error(`Failed to upload image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete an image by public ID
   */
  async deleteImage(publicId: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('Cloudinary service not initialized');
    }

    try {
      await cloudinary.uploader.destroy(publicId);
      logger.info(`Image deleted from Cloudinary: ${publicId}`);
    } catch (error) {
      logger.error('Cloudinary delete error:', error);
      throw new Error(`Failed to delete image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get optimized URL for an image
   */
  getOptimizedUrl(
    publicId: string,
    options?: {
      width?: number;
      height?: number;
      crop?: string;
    }
  ): string {
    return cloudinary.url(publicId, {
      secure: true,
      transformation: [
        {
          width: options?.width || 200,
          height: options?.height || 200,
          crop: options?.crop || 'fill',
          gravity: 'face',
        },
        { quality: 'auto', fetch_format: 'auto' },
      ],
    });
  }

  /**
   * Get thumbnail URL
   */
  getThumbnailUrl(publicId: string): string {
    return this.getOptimizedUrl(publicId, { width: 100, height: 100 });
  }
}

// Singleton instance
let cloudinaryService: CloudinaryService | null = null;

export function getCloudinaryService(): CloudinaryService {
  if (!cloudinaryService) {
    cloudinaryService = new CloudinaryService();
  }
  return cloudinaryService;
}

export { CloudinaryService };