import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { authMiddleware } from '../middleware/auth.js';
import pool from '../db.js';
import { getStoragePath } from '../utils/storage.js';

const router = Router();

// POST /api/share/:fileId — Create share link (requires auth)
router.post('/:fileId', authMiddleware, async (req, res) => {
  try {
    const { permission, expires_in_hours } = req.body;

    // Verify file belongs to user
    const [files] = await pool.execute(
      'SELECT * FROM files WHERE id = ? AND user_id = ?',
      [req.params.fileId, req.user.id]
    );

    if (files.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const token = uuidv4();
    let expiresAt = null;

    if (expires_in_hours) {
      const expiry = new Date();
      expiry.setHours(expiry.getHours() + parseInt(expires_in_hours));
      expiresAt = expiry.toISOString().slice(0, 19).replace('T', ' ');
    }

    const [result] = await pool.execute(
      'INSERT INTO shares (file_id, token, permission, expires_at) VALUES (?, ?, ?, ?)',
      [req.params.fileId, token, permission || 'view', expiresAt]
    );

    const [shares] = await pool.execute('SELECT * FROM shares WHERE id = ?', [result.insertId]);

    res.status(201).json({
      share: shares[0],
      link: `/shared/${token}`
    });
  } catch (err) {
    console.error('Create share error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/share/:token — Access shared file (public, no auth)
router.get('/:token', async (req, res) => {
  try {
    const [shares] = await pool.execute(
      'SELECT s.*, f.name, f.mime_type, f.size, f.storage_key, f.is_folder FROM shares s JOIN files f ON s.file_id = f.id WHERE s.token = ?',
      [req.params.token]
    );

    if (shares.length === 0) {
      return res.status(404).json({ error: 'Share link not found or has been revoked' });
    }

    const share = shares[0];

    // Check expiry
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    res.json({
      file: {
        name: share.name,
        mime_type: share.mime_type,
        size: share.size,
        is_folder: share.is_folder,
        permission: share.permission
      }
    });
  } catch (err) {
    console.error('Access share error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/share/:token/download — Download shared file (public)
router.get('/:token/download', async (req, res) => {
  try {
    const [shares] = await pool.execute(
      'SELECT s.*, f.name, f.mime_type, f.size, f.storage_key, f.is_folder FROM shares s JOIN files f ON s.file_id = f.id WHERE s.token = ?',
      [req.params.token]
    );

    if (shares.length === 0) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    const share = shares[0];

    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    if (share.permission !== 'download' && share.permission !== 'view') {
      return res.status(403).json({ error: 'Download not permitted' });
    }

    const filePath = getStoragePath(share.storage_key);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    res.setHeader('Content-Type', share.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(share.name)}"`);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.error('Download shared error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/share/:token/preview — Preview shared file (public)
router.get('/:token/preview', async (req, res) => {
  try {
    const [shares] = await pool.execute(
      'SELECT s.*, f.name, f.mime_type, f.size, f.storage_key FROM shares s JOIN files f ON s.file_id = f.id WHERE s.token = ?',
      [req.params.token]
    );

    if (shares.length === 0) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    const share = shares[0];

    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    const filePath = getStoragePath(share.storage_key);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    res.setHeader('Content-Type', share.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(share.name)}"`);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.error('Preview shared error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/share/:shareId — Revoke share link (requires auth)
router.delete('/:shareId', authMiddleware, async (req, res) => {
  try {
    const [shares] = await pool.execute(
      `SELECT s.* FROM shares s JOIN files f ON s.file_id = f.id WHERE s.id = ? AND f.user_id = ?`,
      [req.params.shareId, req.user.id]
    );

    if (shares.length === 0) {
      return res.status(404).json({ error: 'Share not found' });
    }

    await pool.execute('DELETE FROM shares WHERE id = ?', [req.params.shareId]);
    res.json({ message: 'Share link revoked' });
  } catch (err) {
    console.error('Delete share error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/share/file/:fileId/links — Get all share links for a file
router.get('/file/:fileId/links', authMiddleware, async (req, res) => {
  try {
    const [shares] = await pool.execute(
      `SELECT s.* FROM shares s JOIN files f ON s.file_id = f.id WHERE s.file_id = ? AND f.user_id = ?`,
      [req.params.fileId, req.user.id]
    );
    res.json({ shares });
  } catch (err) {
    console.error('Get shares error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
