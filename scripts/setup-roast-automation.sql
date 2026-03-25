-- ============================================
-- The Daily Roast - Roast Automation Tables
-- Run this in Supabase SQL Editor
-- ============================================

-- Daily lock snapshot for "Roast of the Day"
CREATE TABLE IF NOT EXISTS daily_roast_lock (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lock_date DATE NOT NULL UNIQUE,
  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  article_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  image_url TEXT,
  image_alt TEXT,
  category_slug TEXT,
  category_name TEXT,
  category_color TEXT,
  views_snapshot INTEGER DEFAULT 0,
  source_created_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_roast_lock_date ON daily_roast_lock(lock_date DESC);

ALTER TABLE daily_roast_lock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read daily roast lock" ON daily_roast_lock;
DROP POLICY IF EXISTS "Service role manages daily roast lock" ON daily_roast_lock;

CREATE POLICY "Anyone can read daily roast lock" ON daily_roast_lock
  FOR SELECT USING (true);

CREATE POLICY "Service role manages daily roast lock" ON daily_roast_lock
  FOR ALL USING (true) WITH CHECK (true);

-- Weekly Top 10 summary header
CREATE TABLE IF NOT EXISTS weekly_roast_summaries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  week_key TEXT NOT NULL UNIQUE,
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  total_articles INTEGER DEFAULT 0,
  top_article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  top_article_slug TEXT,
  top_article_title TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weekly_roast_summaries_start ON weekly_roast_summaries(week_start_date DESC);

ALTER TABLE weekly_roast_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read weekly roast summaries" ON weekly_roast_summaries;
DROP POLICY IF EXISTS "Service role manages weekly roast summaries" ON weekly_roast_summaries;

CREATE POLICY "Anyone can read weekly roast summaries" ON weekly_roast_summaries
  FOR SELECT USING (true);

CREATE POLICY "Service role manages weekly roast summaries" ON weekly_roast_summaries
  FOR ALL USING (true) WITH CHECK (true);

-- Weekly Top 10 item list
CREATE TABLE IF NOT EXISTS weekly_roast_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  summary_id BIGINT NOT NULL REFERENCES weekly_roast_summaries(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank >= 1 AND rank <= 10),
  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  article_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  category_slug TEXT,
  views INTEGER DEFAULT 0,
  reaction_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  absurdity_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weekly_roast_items_summary ON weekly_roast_items(summary_id, rank);
CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_roast_items_rank_unique ON weekly_roast_items(summary_id, rank);

ALTER TABLE weekly_roast_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read weekly roast items" ON weekly_roast_items;
DROP POLICY IF EXISTS "Service role manages weekly roast items" ON weekly_roast_items;

CREATE POLICY "Anyone can read weekly roast items" ON weekly_roast_items
  FOR SELECT USING (true);

CREATE POLICY "Service role manages weekly roast items" ON weekly_roast_items
  FOR ALL USING (true) WITH CHECK (true);
