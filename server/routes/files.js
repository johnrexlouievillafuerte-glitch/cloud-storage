import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import mime from 'mime-types';
import { authMiddleware } from '../middleware/auth.js';
import pool from '../db.js';
import { ensureUserDir, getStoragePath, deleteFile } from '../utils/storage.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = ensureUserDir(req.user.id);
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE || '104857600') } // 100MB
});

// GET /api/files — List files in a folder
router.get('/', async (req, res) => {
  try {
    const { parent_id, search, view } = req.query;
    let query, params;

    if (search) {
      query = 'SELECT * FROM files WHERE user_id = ? AND is_trashed = 0 AND name LIKE ? ORDER BY is_folder DESC, name ASC';
      params = [req.user.id, `%${search}%`];
    } else {
      if (parent_id) {
        query = 'SELECT * FROM files WHERE user_id = ? AND parent_id = ? AND is_trashed = 0 ORDER BY is_folder DESC, name ASC';
        params = [req.user.id, parent_id];
      } else {
        query = 'SELECT * FROM files WHERE user_id = ? AND parent_id IS NULL AND is_trashed = 0 ORDER BY is_folder DESC, name ASC';
        params = [req.user.id];
      }
    }

    const [files] = await pool.execute(query, params);

    // Build breadcrumb path
    let breadcrumbs = [];
    if (parent_id) {
      let currentId = parent_id;
      while (currentId) {
        const [rows] = await pool.execute('SELECT id, name, parent_id FROM files WHERE id = ?', [currentId]);
        if (rows.length > 0) {
          breadcrumbs.unshift({ id: rows[0].id, name: rows[0].name });
          currentId = rows[0].parent_id;
        } else {
          break;
        }
      }
    }

    res.json({ files, breadcrumbs });
  } catch (err) {
    console.error('List files error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/starred — List starred files
router.get('/starred', async (req, res) => {
  try {
    const [files] = await pool.execute(
      'SELECT * FROM files WHERE user_id = ? AND is_starred = 1 AND is_trashed = 0 ORDER BY updated_at DESC',
      [req.user.id]
    );
    res.json({ files });
  } catch (err) {
    console.error('Starred files error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/trash — List trashed files
router.get('/trash', async (req, res) => {
  try {
    const [files] = await pool.execute(
      'SELECT * FROM files WHERE user_id = ? AND is_trashed = 1 ORDER BY updated_at DESC',
      [req.user.id]
    );
    res.json({ files });
  } catch (err) {
    console.error('Trash files error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/files/folder — Create folder
router.post('/folder', async (req, res) => {
  try {
    const { name, parent_id } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    // Verify parent exists and belongs to user
    if (parent_id) {
      const [parent] = await pool.execute(
        'SELECT id FROM files WHERE id = ? AND user_id = ? AND is_folder = 1',
        [parent_id, req.user.id]
      );
      if (parent.length === 0) {
        return res.status(404).json({ error: 'Parent folder not found' });
      }
    }

    const [result] = await pool.execute(
      'INSERT INTO files (user_id, parent_id, name, is_folder) VALUES (?, ?, ?, 1)',
      [req.user.id, parent_id || null, name]
    );

    const [rows] = await pool.execute('SELECT * FROM files WHERE id = ?', [result.insertId]);
    res.status(201).json({ file: rows[0] });
  } catch (err) {
    console.error('Create folder error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/files/upload — Upload file(s)
router.post('/upload', upload.array('files', 20), async (req, res) => {
  try {
    const parent_id = req.body.parent_id || null;
    const uploadedFiles = [];

    for (const file of req.files) {
      const storageKey = `${req.user.id}/${file.filename}`;
      const mimeType = file.mimetype || mime.lookup(file.originalname) || 'application/octet-stream';

      const [result] = await pool.execute(
        'INSERT INTO files (user_id, parent_id, name, mime_type, size, storage_key) VALUES (?, ?, ?, ?, ?, ?)',
        [req.user.id, parent_id, file.originalname, mimeType, file.size, storageKey]
      );

      // Update user storage
      await pool.execute(
        'UPDATE users SET storage_used = storage_used + ? WHERE id = ?',
        [file.size, req.user.id]
      );

      const [rows] = await pool.execute('SELECT * FROM files WHERE id = ?', [result.insertId]);
      uploadedFiles.push(rows[0]);
    }

    res.status(201).json({ files: uploadedFiles });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/:id — Get file metadata
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM files WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json({ file: rows[0] });
  } catch (err) {
    console.error('Get file error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/:id/download — Download file
router.get('/:id/download', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM files WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = rows[0];
    if (file.is_folder) {
      return res.status(400).json({ error: 'Cannot download a folder' });
    }

    const filePath = getStoragePath(file.storage_key);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File data not found on disk' });
    }

    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    res.setHeader('Content-Length', file.size);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/:id/preview — Preview file (inline)
router.get('/:id/preview', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM files WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = rows[0];
    if (file.is_folder) {
      return res.status(400).json({ error: 'Cannot preview a folder' });
    }

    const filePath = getStoragePath(file.storage_key);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File data not found on disk' });
    }

    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.error('Preview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/files/:id — Update file (rename, move, star, trash)
router.patch('/:id', async (req, res) => {
  try {
    const { name, parent_id, is_starred, is_trashed } = req.body;

    const [rows] = await pool.execute(
      'SELECT * FROM files WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (parent_id !== undefined) {
      updates.push('parent_id = ?');
      values.push(parent_id === null ? null : parent_id);
    }
    if (is_starred !== undefined) {
      updates.push('is_starred = ?');
      values.push(is_starred ? 1 : 0);
    }
    if (is_trashed !== undefined) {
      updates.push('is_trashed = ?');
      values.push(is_trashed ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    values.push(req.params.id);
    await pool.execute(
      `UPDATE files SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    const [updated] = await pool.execute('SELECT * FROM files WHERE id = ?', [req.params.id]);
    res.json({ file: updated[0] });
  } catch (err) {
    console.error('Update file error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/files/:id — Permanently delete
router.delete('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM files WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = rows[0];

    // If it's a folder, recursively delete contents
    if (file.is_folder) {
      await deleteFolderRecursive(file.id, req.user.id);
    } else {
      // Delete physical file
      if (file.storage_key) {
        deleteFile(file.storage_key);
      }
      // Update storage usage
      await pool.execute(
        'UPDATE users SET storage_used = GREATEST(0, storage_used - ?) WHERE id = ?',
        [file.size, req.user.id]
      );
    }

    await pool.execute('DELETE FROM files WHERE id = ?', [file.id]);
    res.json({ message: 'File deleted successfully' });
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/files/:id/copy — Copy file
router.post('/:id/copy', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM files WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const original = rows[0];

    if (original.is_folder) {
      return res.status(400).json({ error: 'Folder copying not yet supported' });
    }

    // Copy physical file
    let newStorageKey = null;
    if (original.storage_key) {
      const ext = path.extname(original.name);
      const newFilename = `${uuidv4()}${ext}`;
      newStorageKey = `${req.user.id}/${newFilename}`;
      const srcPath = getStoragePath(original.storage_key);
      const destPath = getStoragePath(newStorageKey);
      ensureUserDir(req.user.id);
      fs.copyFileSync(srcPath, destPath);
    }

    const [result] = await pool.execute(
      'INSERT INTO files (user_id, parent_id, name, mime_type, size, storage_key) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, original.parent_id, `Copy of ${original.name}`, original.mime_type, original.size, newStorageKey]
    );

    await pool.execute(
      'UPDATE users SET storage_used = storage_used + ? WHERE id = ?',
      [original.size, req.user.id]
    );

    const [newFile] = await pool.execute('SELECT * FROM files WHERE id = ?', [result.insertId]);
    res.status(201).json({ file: newFile[0] });
  } catch (err) {
    console.error('Copy file error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/files/trash/empty — Empty trash
router.post('/trash/empty', async (req, res) => {
  try {
    const [trashedFiles] = await pool.execute(
      'SELECT * FROM files WHERE user_id = ? AND is_trashed = 1 AND is_folder = 0',
      [req.user.id]
    );

    let freedSpace = 0;
    for (const file of trashedFiles) {
      if (file.storage_key) {
        deleteFile(file.storage_key);
      }
      freedSpace += file.size || 0;
    }

    // Delete trashed folders too
    await pool.execute(
      'DELETE FROM files WHERE user_id = ? AND is_trashed = 1',
      [req.user.id]
    );

    await pool.execute(
      'UPDATE users SET storage_used = GREATEST(0, storage_used - ?) WHERE id = ?',
      [freedSpace, req.user.id]
    );

    res.json({ message: 'Trash emptied', freed: freedSpace });
  } catch (err) {
    console.error('Empty trash error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper: recursively delete folder contents
async function deleteFolderRecursive(folderId, userId) {
  const [children] = await pool.execute(
    'SELECT * FROM files WHERE parent_id = ? AND user_id = ?',
    [folderId, userId]
  );

  for (const child of children) {
    if (child.is_folder) {
      await deleteFolderRecursive(child.id, userId);
    } else {
      if (child.storage_key) {
        deleteFile(child.storage_key);
      }
      await pool.execute(
        'UPDATE users SET storage_used = GREATEST(0, storage_used - ?) WHERE id = ?',
        [child.size, userId]
      );
    }
    await pool.execute('DELETE FROM files WHERE id = ?', [child.id]);
  }
}

export default router;
