import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
// @ts-ignore
import pdfParse from 'pdf-parse';
import { logger } from '../../utils/logger.js';

export interface ExtractedPhoto {
  buffer: Buffer;
  width: number;
  height: number;
  format: string;
}

/**
 * Photo Extraction Service
 * Extracts profile photos from CV documents
 */
class PhotoExtractorService {
  /**
   * Extract photo from a document
   */
  async extractPhoto(
    filePath: string,
    mimeType: string
  ): Promise<ExtractedPhoto | null> {
    try {
      switch (mimeType) {
        case 'application/pdf':
          return this.extractFromPDF(filePath);
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
          return this.extractFromDOCX(filePath);
        case 'image/jpeg':
        case 'image/png':
          // The document itself is an image, try to detect face
          return this.processImage(filePath);
        default:
          return null;
      }
    } catch (error) {
      logger.error('Photo extraction error:', error);
      return null;
    }
  }

  /**
   * Extract embedded images from PDF
   * Note: This is a simplified version. Full PDF image extraction
   * requires more sophisticated parsing.
   */
  private async extractFromPDF(filePath: string): Promise<ExtractedPhoto | null> {
    try {
      // PDF image extraction is complex and requires specialized libraries
      // For production, consider using pdf-lib, pdf2pic, or similar
      // This is a placeholder that indicates photos might exist
      
      const dataBuffer = fs.readFileSync(filePath);
      
      // Simple check for embedded images in PDF
      const hasImages = dataBuffer.includes(Buffer.from('/Image')) ||
                       dataBuffer.includes(Buffer.from('/XObject'));
      
      if (hasImages) {
        logger.info('PDF may contain embedded images');
        // In production, implement actual image extraction
        return null;
      }
      
      return null;
    } catch (error) {
      logger.error('PDF photo extraction error:', error);
      return null;
    }
  }

  /**
   * Extract embedded images from DOCX
   */
  private async extractFromDOCX(filePath: string): Promise<ExtractedPhoto | null> {
    try {
      // DOCX files are ZIP archives
      // Images are stored in word/media/ folder
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries();

      // Look for images in the media folder
      for (const entry of entries) {
        if (entry.entryName.startsWith('word/media/') && 
            (entry.entryName.endsWith('.png') || 
             entry.entryName.endsWith('.jpg') || 
             entry.entryName.endsWith('.jpeg'))) {
          
          const imageBuffer = entry.getData();
          
          // Process and validate the image
          const processed = await this.processImageBuffer(imageBuffer);
          if (processed) {
            return processed;
          }
        }
      }

      return null;
    } catch (error) {
      logger.error('DOCX photo extraction error:', error);
      return null;
    }
  }

  /**
   * Process an image file
   */
  private async processImage(filePath: string): Promise<ExtractedPhoto | null> {
    try {
      const imageBuffer = fs.readFileSync(filePath);
      return this.processImageBuffer(imageBuffer);
    } catch (error) {
      logger.error('Image processing error:', error);
      return null;
    }
  }

  /**
   * Process an image buffer
   * Validates, crops, and optimizes for profile photo use
   */
  private async processImageBuffer(buffer: Buffer): Promise<ExtractedPhoto | null> {
    try {
      const image = sharp(buffer);
      const metadata = await image.metadata();

      if (!metadata.width || !metadata.height) {
        return null;
      }

      // Skip very small images (likely icons/logos)
      if (metadata.width < 50 || metadata.height < 50) {
        return null;
      }

      // Skip very large images (likely full documents)
      if (metadata.width > 2000 && metadata.height > 2000) {
        return null;
      }

      // Check if it's roughly square (profile photo shape)
      const aspectRatio = metadata.width / metadata.height;
      const isProfileShape = aspectRatio >= 0.5 && aspectRatio <= 2;

      if (!isProfileShape) {
        return null;
      }

      // Process the image: resize and optimize
      const processed = await image
        .resize(400, 400, {
          fit: 'cover',
          position: 'centre',
        })
        .jpeg({ quality: 85 })
        .toBuffer();

      return {
        buffer: processed,
        width: 400,
        height: 400,
        format: 'jpeg',
      };
    } catch (error) {
      logger.error('Image buffer processing error:', error);
      return null;
    }
  }

  /**
   * Validate if an image looks like a profile photo
   * This is a heuristic check - in production, use face detection APIs
   */
  async isLikelyProfilePhoto(buffer: Buffer): Promise<boolean> {
    try {
      const image = sharp(buffer);
      const metadata = await image.metadata();

      if (!metadata.width || !metadata.height) {
        return false;
      }

      // Size check
      const minSize = 100;
      const maxSize = 1000;
      if (metadata.width < minSize || metadata.height < minSize) return false;
      if (metadata.width > maxSize && metadata.height > maxSize) return false;

      // Aspect ratio check (profile photos are usually squarish)
      const aspectRatio = metadata.width / metadata.height;
      if (aspectRatio < 0.5 || aspectRatio > 2) return false;

      // Could add more sophisticated checks:
      // - Face detection using Google Vision API
      // - Color analysis (skin tones)
      // - Edge detection patterns

      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let photoExtractorService: PhotoExtractorService | null = null;

export function getPhotoExtractorService(): PhotoExtractorService {
  if (!photoExtractorService) {
    photoExtractorService = new PhotoExtractorService();
  }
  return photoExtractorService;
}

export { PhotoExtractorService };