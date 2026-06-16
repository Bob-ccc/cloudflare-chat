CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  r2_key TEXT,
  public_url TEXT,
  prompt TEXT NOT NULL,
  model TEXT,
  api_mode TEXT,
  size TEXT,
  quality TEXT,
  format TEXT,
  streamed INTEGER DEFAULT 0,
  reference_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at);
