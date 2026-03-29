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

-- Track comment likes per session to prevent repeated likes
CREATE TABLE IF NOT EXISTS comment_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  comment_id UUID NOT NULL REFERENCES article_comments(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(comment_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes(comment_id);

-- Enable RLS
ALTER TABLE article_comments ENABLE ROW LEVEL SECURITY;

-- Server-side anti-spam helper
CREATE OR REPLACE FUNCTION can_post_comment(sid TEXT)
RETURNS BOOLEAN AS $$
  SELECT (
    SELECT COUNT(*)
    FROM article_comments
    WHERE session_id = sid
      AND created_at > NOW() - INTERVAL '10 seconds'
  ) = 0;
$$ LANGUAGE sql STABLE;

-- Anyone can read approved comments
DROP POLICY IF EXISTS "Public can read approved comments" ON article_comments;
CREATE POLICY "Public can read approved comments"
  ON article_comments FOR SELECT TO anon, authenticated
  USING (is_approved = true);

-- Anyone can insert comments (anonymous posting)
DROP POLICY IF EXISTS "Anyone can insert comments" ON article_comments;
CREATE POLICY "Anyone can insert comments"
  ON article_comments FOR INSERT TO anon, authenticated
  WITH CHECK (
    is_approved = true
    AND session_id IS NOT NULL
    AND char_length(session_id) BETWEEN 10 AND 120
    AND char_length(author_name) BETWEEN 1 AND 80
    AND char_length(content) BETWEEN 2 AND 1000
    AND can_post_comment(session_id)
  );

-- RPC to get comment count for an article
CREATE OR REPLACE FUNCTION get_comment_count(article_uuid UUID)
RETURNS INT AS $$
  SELECT COUNT(*)::INT FROM article_comments
  WHERE article_id = article_uuid AND is_approved = true;
$$ LANGUAGE sql STABLE;

-- RPC to like a comment
CREATE OR REPLACE FUNCTION like_comment(comment_uuid UUID, sid TEXT)
RETURNS void AS $$
DECLARE
  inserted_rows INT;
BEGIN
  INSERT INTO comment_likes (comment_id, session_id)
  VALUES (comment_uuid, sid)
  ON CONFLICT (comment_id, session_id) DO NOTHING;

  GET DIAGNOSTICS inserted_rows = ROW_COUNT;

  IF inserted_rows > 0 THEN
    UPDATE article_comments
    SET likes = likes + 1
    WHERE id = comment_uuid;
  END IF;
END;
$$ LANGUAGE plpgsql VOLATILE;
