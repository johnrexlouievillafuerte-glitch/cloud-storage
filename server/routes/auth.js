import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import pool from '../db.js';
import { generateToken, authMiddleware } from '../middleware/auth.js';

const router = Router();
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// POST /api/auth/google — Google Sign-In
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: 'Google credential is required' });
    }

    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture, email_verified } = payload;

    if (!email_verified) {
      return res.status(403).json({ error: 'Google email is not verified' });
    }

    // Check if user already exists
    const [existing] = await pool.execute(
      'SELECT * FROM users WHERE google_id = ? OR email = ?',
      [googleId, email]
    );

    let user;
    if (existing.length > 0) {
      user = existing[0];
      // Update google_id and avatar if missing
      if (!user.google_id) {
        await pool.execute('UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?', [googleId, picture, user.id]);
      }
    } else {
      // Generate a unique username from the Google name
      let baseUsername = (name || email.split('@')[0]).toLowerCase().replace(/[^a-z0-9]/g, '');
      let username = baseUsername;
      let counter = 1;

      while (true) {
        const [check] = await pool.execute('SELECT id FROM users WHERE username = ?', [username]);
        if (check.length === 0) break;
        username = `${baseUsername}${counter}`;
        counter++;
      }

      // Create new user (no password for Google users)
      const [result] = await pool.execute(
        'INSERT INTO users (email, username, google_id, avatar_url) VALUES (?, ?, ?, ?)',
        [email, username, googleId, picture || null]
      );

      user = {
        id: result.insertId,
        email,
        username,
        google_id: googleId,
        avatar_url: picture,
        status: 'Hey there! I am using CloudVault.',
        storage_used: 0,
        storage_limit: 2199023255552,
      };
    }

    const token = generateToken(user);

    res.json({
      message: existing.length > 0 ? 'Login successful' : 'Account created successfully',
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar_url: user.avatar_url,
        status: user.status || 'Hey there! I am using CloudVault.',
        storage_used: user.storage_used || 0,
        storage_limit: user.storage_limit || 2199023255552,
      }
    });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ error: 'Google authentication failed' });
  }
});

// POST /api/auth/register (kept for backward compatibility)
router.post('/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user exists
    const [existing] = await pool.execute(
      'SELECT id FROM users WHERE email = ? OR username = ?',
      [email, username]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email or username already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO users (email, username, password) VALUES (?, ?, ?)',
      [email, username, hashedPassword]
    );

    const user = { id: result.insertId, email, username };
    const token = generateToken(user);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: { id: user.id, email, username, status: 'Hey there! I am using CloudVault.', storage_used: 0, storage_limit: 2199023255552 }
    });
  } catch (err) {
    console.error('Register error:', err);
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email or username already taken' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login (kept for backward compatibility)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];

    if (!user.password) {
      return res.status(401).json({ error: 'This account uses Google Sign-In. Please sign in with Google.' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id, email: user.email, username: user.username,
        avatar_url: user.avatar_url, status: user.status,
        storage_used: user.storage_used, storage_limit: user.storage_limit
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, email, username, avatar_url, status, storage_used, storage_limit, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: rows[0] });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/auth/me — Update profile
router.patch('/me', authMiddleware, async (req, res) => {
  try {
    const { username, status } = req.body;
    const updates = [];
    const values = [];

    if (username !== undefined) {
      if (!username.trim()) return res.status(400).json({ error: 'Username cannot be empty' });
      // Check uniqueness
      const [check] = await pool.execute('SELECT id FROM users WHERE username = ? AND id != ?', [username.trim(), req.user.id]);
      if (check.length > 0) return res.status(409).json({ error: 'Username already taken' });
      updates.push('username = ?');
      values.push(username.trim());
    }
    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No updates provided' });

    values.push(req.user.id);
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

    const [rows] = await pool.execute(
      'SELECT id, email, username, avatar_url, status, storage_used, storage_limit, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    res.json({ user: rows[0] });
  } catch (err) {
    console.error('Update profile error:', err);
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username already taken' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
