-- ============================================
-- Comments System for The Daily Roast
-- Run this in Supabase SQL Editor
-- ============================================

-- Comments table
CREATE TABLE IF NOT EXISTS article_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES article_comments(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL DEFAULT 'Anonymous Roaster',
  content TEXT NOT NULL,
  session_id TEXT,
  likes INT DEFAULT 0,
  is_approved BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup by article
CREATE INDEX IF NOT EXISTS idx_comments_article ON article_comments(article_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON article_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_created ON article_comments(created_at DESC);

-- Enable RLS
ALTER TABLE article_comments ENABLE ROW LEVEL SECURITY;

-- Anyone can read approved comments
CREATE POLICY "Public can read approved comments"
  ON article_comments FOR SELECT
  USING (is_approved = true);

-- Anyone can insert comments (anonymous posting)
CREATE POLICY "Anyone can insert comments"
  ON article_comments FOR INSERT
  WITH CHECK (true);

-- RPC to get comment count for an article
CREATE OR REPLACE FUNCTION get_comment_count(article_uuid UUID)
RETURNS INT AS $$
  SELECT COUNT(*)::INT FROM article_comments
  WHERE article_id = article_uuid AND is_approved = true;
$$ LANGUAGE sql STABLE;

-- RPC to like a comment
CREATE OR REPLACE FUNCTION like_comment(comment_uuid UUID)
RETURNS void AS $$
  UPDATE article_comments SET likes = likes + 1 WHERE id = comment_uuid;
$$ LANGUAGE sql VOLATILE;
