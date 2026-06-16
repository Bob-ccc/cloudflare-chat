ALTER TABLE image_thumbnails ADD COLUMN preview_mime_type TEXT;
ALTER TABLE image_thumbnails ADD COLUMN preview_data_base64 TEXT;
ALTER TABLE image_thumbnails ADD COLUMN preview_bytes INTEGER DEFAULT 0;
ALTER TABLE image_thumbnails ADD COLUMN preview_width INTEGER DEFAULT 0;
ALTER TABLE image_thumbnails ADD COLUMN preview_height INTEGER DEFAULT 0;
