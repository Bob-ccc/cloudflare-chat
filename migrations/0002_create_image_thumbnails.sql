CREATE TABLE IF NOT EXISTS image_thumbnails (
  image_id TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL,
  data_base64 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_image_thumbnails_created_at
ON image_thumbnails(created_at);
