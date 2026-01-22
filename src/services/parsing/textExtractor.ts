import fs from 'fs';
import path from 'path';
// @ts-ignore - pdf-parse types
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { createWorker, Worker } from 'tesseract.js';
import { logger } from '../../utils/logger.js';

export interface TextExtractionResult {
  text: string;
  pageCount?: number;
  language?: string;
  isScanned: boolean;
  confidence?: number;
}

/**
 * Text Extraction Service
 * Extracts text from PDF, DOCX, and images (OCR)
 */
class TextExtractorService {
  private ocrWorker: Worker | null = null;
  private ocrInitialized: boolean = false;

  /**
   * Extract text from a file based on its type
   */
  async extractText(filePath: string, mimeType: string): Promise<TextExtractionResult> {
    switch (mimeType) {
      case 'application/pdf':
        return this.extractFromPDF(filePath);
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return this.extractFromDOCX(filePath);
      case 'image/jpeg':
      case 'image/png':
      case 'image/gif':
      case 'image/webp':
        return this.extractFromImage(filePath);
      default:
        throw new Error(`Unsupported file type: ${mimeType}`);
    }
  }

  /**
   * Extract text from PDF
   * Handles both text-based and scanned PDFs
   */
  async extractFromPDF(filePath: string): Promise<TextExtractionResult> {
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse(dataBuffer);
      
      const text = data.text?.trim() || '';
      
      // If no text extracted, it might be a scanned PDF
      if (text.length < 50) {
        logger.info('PDF appears to be scanned, attempting OCR...');
        // For scanned PDFs, we would need to convert to images first
        // This is a simplified version - in production, use pdf2image
        return {
          text: text || '',
          pageCount: data.numpages,
          isScanned: true,
          confidence: 0.3,
        };
      }

      return {
        text,
        pageCount: data.numpages,
        isScanned: false,
        confidence: 0.95,
      };
    } catch (error) {
      logger.error('PDF extraction error:', error);
      throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract text from DOCX
   */
  async extractFromDOCX(filePath: string): Promise<TextExtractionResult> {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      const text = result.value?.trim() || '';

      if (result.messages.length > 0) {
        logger.debug('DOCX extraction messages:', result.messages);
      }

      return {
        text,
        isScanned: false,
        confidence: 0.95,
      };
    } catch (error) {
      logger.error('DOCX extraction error:', error);
      throw new Error(`Failed to extract text from DOCX: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract text from image using OCR (Tesseract)
   */
  async extractFromImage(filePath: string): Promise<TextExtractionResult> {
    try {
      // Initialize OCR worker if not already done
      if (!this.ocrWorker) {
        this.ocrWorker = await createWorker('eng+fra+ara+spa+deu');
        this.ocrInitialized = true;
      }

      const { data } = await this.ocrWorker.recognize(filePath);

      return {
        text: data.text?.trim() || '',
        isScanned: true,
        confidence: data.confidence / 100, // Tesseract returns 0-100
        language: (data as any).language || 'unknown',
      };
    } catch (error) {
      logger.error('OCR extraction error:', error);
      throw new Error(`Failed to extract text from image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Detect language of text
   * Simple heuristic-based detection
   */
  detectLanguage(text: string): string {
    // Count character patterns for common languages
    const arabicPattern = /[\u0600-\u06FF]/g;
    const frenchPattern = /[àâäéèêëïîôùûüç]/gi;
    const germanPattern = /[äöüß]/gi;
    const spanishPattern = /[áéíóúñ¿¡]/gi;

    const arabicCount = (text.match(arabicPattern) || []).length;
    const frenchCount = (text.match(frenchPattern) || []).length;
    const germanCount = (text.match(germanPattern) || []).length;
    const spanishCount = (text.match(spanishPattern) || []).length;

    // If significant Arabic characters, it's Arabic
    if (arabicCount > text.length * 0.1) return 'ar';
    
    // Check European languages
    const maxEuropean = Math.max(frenchCount, germanCount, spanishCount);
    if (maxEuropean > 10) {
      if (frenchCount === maxEuropean) return 'fr';
      if (germanCount === maxEuropean) return 'de';
      if (spanishCount === maxEuropean) return 'es';
    }

    // Default to English
    return 'en';
  }

  /**
   * Clean extracted text
   * Removes extra whitespace, normalizes line breaks
   */
  cleanText(text: string): string {
    return text
      // Normalize line breaks
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Remove multiple consecutive line breaks
      .replace(/\n{3,}/g, '\n\n')
      // Remove leading/trailing whitespace from each line
      .split('\n')
      .map(line => line.trim())
      .join('\n')
      // Remove multiple spaces
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  /**
   * Cleanup OCR worker
   */
  async cleanup(): Promise<void> {
    if (this.ocrWorker) {
      await this.ocrWorker.terminate();
      this.ocrWorker = null;
      this.ocrInitialized = false;
    }
  }
}

// Singleton instance
let textExtractorService: TextExtractorService | null = null;

export function getTextExtractorService(): TextExtractorService {
  if (!textExtractorService) {
    textExtractorService = new TextExtractorService();
  }
  return textExtractorService;
}

export { TextExtractorService };