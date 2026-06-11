-- P2-7: article thumbnails (RSS media at insert, og:image after extraction)
-- and an archive that hides items without deleting them.
ALTER TABLE news_items ADD COLUMN image_url TEXT;
ALTER TABLE news_items ADD COLUMN archived_at INTEGER;
CREATE INDEX idx_news_items_archived ON news_items(archived_at);
