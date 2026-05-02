-- Add image_url to markets for hero card images
ALTER TABLE markets ADD COLUMN image_url TEXT DEFAULT NULL;
