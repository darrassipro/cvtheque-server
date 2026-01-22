import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { ValidationError } from './errorHandler.js';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure upload directory exists
const uploadDir = path.resolve(__dirname, '../../uploads/temp');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

// File filter for CV uploads
const cvFileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const allowedTypes = config.upload.allowedFileTypes;
  
  if (!allowedTypes.includes(file.mimetype)) {
    cb(new ValidationError(
      `Invalid file type: ${file.mimetype}. Allowed types: PDF, DOCX, JPEG, PNG`
    ));
    return;
  }
  
  cb(null, true);
};

// Image filter for profile photos
const imageFileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  
  if (!allowedTypes.includes(file.mimetype)) {
    cb(new ValidationError(
      `Invalid image type: ${file.mimetype}. Allowed: JPEG, PNG, GIF, WebP`
    ));
    return;
  }
  
  cb(null, true);
};

// CV upload middleware (single file)
export const uploadCV = multer({
  storage,
  fileFilter: cvFileFilter,
  limits: {
    fileSize: config.upload.maxFileSizeMb * 1024 * 1024,
    files: 1,
  },
}).single('cv');

// Multiple CVs upload middleware
export const uploadMultipleCVs = multer({
  storage,
  fileFilter: cvFileFilter,
  limits: {
    fileSize: config.upload.maxFileSizeMb * 1024 * 1024,
    files: 10,
  },
}).array('cvs', 10);

// Avatar upload middleware
export const uploadAvatar = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max for avatars
    files: 1,
  },
}).single('avatar');

// Utility to clean up uploaded file
export async function cleanupUploadedFile(filePath: string): Promise<void> {
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  } catch (error) {
    console.error('Error cleaning up uploaded file:', error);
  }
}

// Get document type from mime type
export function getDocumentType(mimeType: string): 'PDF' | 'DOCX' | 'IMAGE' {
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'DOCX';
  return 'IMAGE';
}