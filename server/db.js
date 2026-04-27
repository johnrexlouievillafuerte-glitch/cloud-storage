import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'cloud_storage',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

export async function initDatabase() {
  const conn = await pool.getConnection();
  try {
    // Create users table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        email         VARCHAR(255) UNIQUE NOT NULL,
        username      VARCHAR(100) UNIQUE NOT NULL,
        password      VARCHAR(255) NOT NULL,
        avatar_url    VARCHAR(500),
        status        VARCHAR(255) DEFAULT 'Hey there! I am using CloudVault.',
        storage_used  BIGINT DEFAULT 0,
        storage_limit BIGINT DEFAULT 2199023255552,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create files table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS files (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        user_id       INT NOT NULL,
        parent_id     INT DEFAULT NULL,
        name          VARCHAR(255) NOT NULL,
        is_folder     TINYINT(1) DEFAULT 0,
        mime_type     VARCHAR(255),
        size          BIGINT DEFAULT 0,
        storage_key   VARCHAR(500),
        is_starred    TINYINT(1) DEFAULT 0,
        is_trashed    TINYINT(1) DEFAULT 0,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES files(id) ON DELETE SET NULL,
        INDEX idx_user_parent (user_id, parent_id),
        INDEX idx_user_trashed (user_id, is_trashed),
        INDEX idx_user_starred (user_id, is_starred)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create shares table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS shares (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        file_id       INT NOT NULL,
        token         VARCHAR(255) UNIQUE NOT NULL,
        permission    VARCHAR(20) DEFAULT 'view',
        expires_at    TIMESTAMP NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
        INDEX idx_token (token)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Add status column if missing (migration for existing DBs)
    try {
      await conn.execute(`ALTER TABLE users ADD COLUMN status VARCHAR(255) DEFAULT 'Hey there! I am using CloudVault.' AFTER avatar_url`);
    } catch (e) { /* column already exists */ }

    console.log('✅ Database tables initialized successfully');
  } finally {
    conn.release();
  }
}

export default pool;
