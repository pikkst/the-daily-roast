-- ============================================
-- The Daily Roast — Broadcasts Table
-- Run this in Supabase SQL Editor
-- ============================================

-- Broadcasts table (stores generated radio shows)
CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  script JSONB NOT NULL DEFAULT '[]',           -- [{speaker, text}, ...]
  audio_url TEXT,                                -- Supabase Storage URL
  cover_image_url TEXT,                          -- Generated cover art
  bgm_theme TEXT DEFAULT 'upbeat',
  article_ids UUID[] DEFAULT '{}',               -- Source article IDs
  category_summary JSONB DEFAULT '{}',           -- {politics: "title", tech: "title", ...}
  duration_seconds INTEGER DEFAULT 0,
  published BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcasts_published ON broadcasts(published) WHERE published = true;

-- RLS policies
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;

-- Public: anyone can read published broadcasts
DROP POLICY IF EXISTS "Public can read published broadcasts" ON broadcasts;
CREATE POLICY "Public can read published broadcasts"
  ON broadcasts FOR SELECT TO anon, authenticated
  USING (published = true);

-- Service role: full access (for generation script)
DROP POLICY IF EXISTS "Service role full access to broadcasts" ON broadcasts;
CREATE POLICY "Service role full access to broadcasts"
  ON broadcasts FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Storage bucket for broadcast audio
-- (Run this manually or via the generation script)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('broadcast-audio', 'broadcast-audio', true);
