-- D1 Schema for ReelBallers Signups
-- Run with: wrangler d1 execute reelballers-signups --file=./schema.sql

CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  source TEXT DEFAULT 'landing'
);

-- Index for quick email lookups
CREATE INDEX IF NOT EXISTS idx_signups_email ON signups(email);
