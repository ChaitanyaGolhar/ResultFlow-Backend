import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request } from 'express';

const storageDir = process.env.STORAGE_LOCAL_PATH || './storage';

// Ensure directories exist
const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const storage = multer.diskStorage({
  destination: (req: Request, file, cb) => {
    const userId = (req as any).user?.id || 'anonymous';
    
    let destPath = '';
    if (file.fieldname === 'file' && (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/'))) {
      destPath = path.join(storageDir, 'templates', userId);
    } else if (file.fieldname === 'file' && (file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
      destPath = path.join(storageDir, 'data', userId);
    } else {
      destPath = path.join(storageDir, 'misc');
    }

    ensureDir(destPath);
    cb(null, destPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + ext);
  }
});

export const uploadTemplate = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_TEMPLATE_SIZE_MB || '20') * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['application/pdf', 'image/png', 'image/jpeg'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  }
});

export const uploadDataFile = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB for excel/csv
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  }
});
