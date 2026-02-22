import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(process.cwd(), 'database.sqlite');
const db = new Database(dbPath);

export function initDb() {
  // Channels table
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      rss_url TEXT NOT NULL,
      last_checked DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Videos table (to track what we've seen)
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER,
      video_id TEXT UNIQUE NOT NULL,
      title TEXT,
      link TEXT,
      published_at DATETIME,
      summary TEXT,
      video_type TEXT DEFAULT 'longform',
      notified BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE
    )
  `);

  // Migration: Add video_type column if it doesn't exist
  try {
    db.exec("ALTER TABLE videos ADD COLUMN video_type TEXT DEFAULT 'longform'");
  } catch (e) {
    // Column likely already exists
  }

  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
}

export { db };
