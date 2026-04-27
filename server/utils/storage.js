import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || './storage');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

export function getStoragePath(storageKey) {
  return path.join(STORAGE_DIR, storageKey);
}

export function deleteFile(storageKey) {
  const filePath = getStoragePath(storageKey);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function getStorageDir() {
  return STORAGE_DIR;
}

export function ensureUserDir(userId) {
  const userDir = path.join(STORAGE_DIR, String(userId));
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  return userDir;
}
