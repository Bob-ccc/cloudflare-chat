CREATE TABLE IF NOT EXISTS image_jobs (
  id TEXT PRIMARY KEY,
  response_id TEXT,
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  params_json TEXT,
  result_image_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_image_jobs_created_at
ON image_jobs(created_at);

CREATE INDEX IF NOT EXISTS idx_image_jobs_status
ON image_jobs(status);
