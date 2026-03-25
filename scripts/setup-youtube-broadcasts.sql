-- ============================================
-- The Daily Roast - YouTube Broadcast Fields
-- Run this in Supabase SQL Editor
-- ============================================

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS youtube_video_id TEXT,
  ADD COLUMN IF NOT EXISTS youtube_url TEXT,
  ADD COLUMN IF NOT EXISTS youtube_upload_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS youtube_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS youtube_upload_error TEXT;

CREATE INDEX IF NOT EXISTS idx_broadcasts_youtube_status ON broadcasts(youtube_upload_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcasts_youtube_video_id ON broadcasts(youtube_video_id) WHERE youtube_video_id IS NOT NULL;
