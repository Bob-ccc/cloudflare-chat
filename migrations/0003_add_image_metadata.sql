ALTER TABLE image_thumbnails ADD COLUMN original_bytes INTEGER DEFAULT 0;
ALTER TABLE image_thumbnails ADD COLUMN original_width INTEGER DEFAULT 0;
ALTER TABLE image_thumbnails ADD COLUMN original_height INTEGER DEFAULT 0;
ALTER TABLE image_thumbnails ADD COLUMN compression_ratio REAL DEFAULT 0;
ALTER TABLE image_thumbnails ADD COLUMN encoder_quality REAL DEFAULT 0;
