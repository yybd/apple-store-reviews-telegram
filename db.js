const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR);
}

const db = new sqlite3.Database(path.join(DB_DIR, 'reviews.sqlite'), (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      app_id TEXT,
      author_name TEXT,
      author_uri TEXT,
      version TEXT,
      rating INTEGER,
      title TEXT,
      content TEXT,
      updated_at TEXT,
      country TEXT
    )`, (err) => {
        if (!err) {
            // Attempt to add country column to existing tables (fails silently if already exists)
            db.run(`ALTER TABLE reviews ADD COLUMN country TEXT`, () => {});
        }
    });
    db.run(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);
  }
});

db.getSetting = (key) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.value : null);
    });
  });
};

db.setSetting = (key, value) => {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
      [key, value, value],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
};

module.exports = db;
