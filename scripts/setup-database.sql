-- ============================================
-- The Daily Roast - Database Setup
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Categories Table
CREATE TABLE IF NOT EXISTS categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#e63946',
  icon TEXT DEFAULT '📰',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Articles Table
CREATE TABLE IF NOT EXISTS articles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  category_id UUID REFERENCES categories(id),
  image_url TEXT,
  image_alt TEXT DEFAULT '',
  author TEXT DEFAULT 'AI Correspondent',
  meta_description TEXT,
  tags TEXT[] DEFAULT '{}',
  source_headline TEXT,
  published BOOLEAN DEFAULT true,
  featured BOOLEAN DEFAULT false,
  views INTEGER DEFAULT 0,
  reading_time INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Site Analytics (simple page view tracking)
CREATE TABLE IF NOT EXISTS page_views (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  referrer TEXT
);

-- 4. Generation Log (track what's been generated)
CREATE TABLE IF NOT EXISTS generation_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_headline TEXT NOT NULL,
  source_url TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  success BOOLEAN DEFAULT true,
  error_message TEXT
);

-- ============================================
-- Indexes for Performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id);
CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_featured ON articles(featured) WHERE featured = true;
CREATE INDEX IF NOT EXISTS idx_articles_tags ON articles USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_page_views_article ON page_views(article_id);
CREATE INDEX IF NOT EXISTS idx_generation_log_headline ON generation_log(source_headline);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_log ENABLE ROW LEVEL SECURITY;

-- Public read-only policies
DROP POLICY IF EXISTS "Anyone can read published articles" ON articles;
CREATE POLICY "Anyone can read published articles" ON articles
  FOR SELECT TO anon, authenticated USING (published = true);

DROP POLICY IF EXISTS "Anyone can read categories" ON categories;
CREATE POLICY "Anyone can read categories" ON categories
  FOR SELECT TO anon, authenticated USING (true);

-- Allow anonymous users to insert page views
DROP POLICY IF EXISTS "Anyone can log page views" ON page_views;
CREATE POLICY "Anyone can log page views" ON page_views
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Service role full access (for generation script)
DROP POLICY IF EXISTS "Service role manages articles" ON articles;
CREATE POLICY "Service role manages articles" ON articles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role manages categories" ON categories;
CREATE POLICY "Service role manages categories" ON categories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role manages generation_log" ON generation_log;
CREATE POLICY "Service role manages generation_log" ON generation_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- Helper Functions
-- ============================================

-- Increment article views (called from frontend)
CREATE OR REPLACE FUNCTION increment_views(article_slug TEXT)
RETURNS void AS $$
BEGIN
  UPDATE articles SET views = views + 1 WHERE slug = article_slug;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get articles with category info (optimized view)
CREATE OR REPLACE VIEW articles_with_category AS
SELECT 
  a.*,
  c.name AS category_name,
  c.slug AS category_slug,
  c.color AS category_color,
  c.icon AS category_icon
FROM articles a
LEFT JOIN categories c ON a.category_id = c.id
WHERE a.published = true
ORDER BY a.created_at DESC;

-- Grant access to the view for anonymous and authenticated users
GRANT SELECT ON articles_with_category TO anon, authenticated;

-- Grant execute on helper function
GRANT EXECUTE ON FUNCTION increment_views(TEXT) TO anon, authenticated;

-- ============================================
-- Seed Categories
-- ============================================
INSERT INTO categories (name, slug, color, icon) VALUES
  ('Politics', 'politics', '#e63946', '🏛️'),
  ('Technology', 'technology', '#457b9d', '💻'),
  ('Business', 'business', '#2a9d8f', '💼'),
  ('Science', 'science', '#e9c46a', '🔬'),
  ('Entertainment', 'entertainment', '#f4a261', '🎬'),
  ('Sports', 'sports', '#264653', '⚽'),
  ('World', 'world', '#6a4c93', '🌍')
ON CONFLICT (slug) DO NOTHING;

-- ============================================
-- Seed Sample Articles (for initial demo)
-- ============================================
INSERT INTO articles (title, slug, content, excerpt, category_id, meta_description, tags, author, featured, reading_time) VALUES
(
  'Local Man Discovers WiFi Has Been Free This Whole Time, Questions Everything',
  'local-man-discovers-wifi-free',
  '<p>In what experts are calling "the most predictable revelation of the decade," 34-year-old Kevin Mitchell of suburban Ohio discovered yesterday that the coffee shop he''s been paying $4.99 monthly "premium WiFi access" for has actually been offering free WiFi since 2019.</p>
  <p>"I just assumed the password ''CoffeeShop123'' was some kind of elite access code," Mitchell told reporters, visibly shaken while clutching his laptop at the establishment in question, Bean There Done That.</p>
  <p>Dr. Patricia Knowles, a digital literacy professor at the University of Obvious Studies, weighed in on the situation. "This is more common than people think. Our research shows that approximately 12% of Americans are currently paying for something that''s free. Most of them are also still renting a modem from their ISP."</p>
  <p>The coffee shop owner, Maria Santos, expressed sympathy. "He''s been Venmo-ing us $4.99 every month with the memo ''WiFi dues.'' We thought it was a tip. We even named a drink after him — The Generous Regular."</p>
  <p>Mitchell says he plans to audit all his subscriptions this weekend, starting with the $2.99 he''s been paying for "premium air" at a local gas station. "I just want to make sure I''m not funding someone''s vacation home with my ignorance," he said.</p>
  <p>At press time, Mitchell was seen asking a barista if the bathroom was also free or if that was a separate tier.</p>',
  'Ohio man realizes the premium WiFi he''s been paying for was free all along. Experts say he''s not alone.',
  (SELECT id FROM categories WHERE slug = 'technology'),
  'Local Ohio man discovers coffee shop WiFi was free, questions all life decisions. A satirical take on digital literacy.',
  ARRAY['wifi', 'technology', 'funny', 'digital literacy', 'coffee shop'],
  'Staff Writer',
  true,
  3
),
(
  'CEO Announces Company Will "Circle Back" — Employees Fear Circular Time Loop',
  'ceo-circle-back-time-loop',
  '<p>Employees at Synergex Global Solutions were plunged into existential dread Monday after CEO Bradley Worthington III announced during an all-hands meeting that the company would be "circling back" on several key initiatives.</p>
  <p>"At first, we thought it was just corporate speak," said Sarah Chen, a senior project manager who has worked at Synergex for seven years. "But then we checked the calendar and realized we''ve been circling back to the same Q3 strategy meeting since 2022. We never actually moved forward."</p>
  <p>Theoretical physicist Dr. Ramesh Patel, who was consulted by the increasingly panicked workforce, confirmed their worst fears. "Based on my analysis of their meeting minutes, Synergex employees are indeed trapped in a corporate temporal loop. Every initiative is tabled, revisited, workshopped, and then tabled again. They haven''t shipped a product since the Obama administration."</p>
  <p>HR Director Linda McMahon attempted to address employee concerns by scheduling a meeting to discuss the meetings about the meetings. "We believe in transparent communication," she said, while forwarding a calendar invite titled ''Re: Re: Re: Re: Follow-up on Action Items from Previous Follow-up.''</p>
  <p>The stock market appeared unfazed by the news, with analysts noting that "most Fortune 500 companies have been in similar loops since the invention of PowerPoint."</p>
  <p>At press time, Worthington was last seen drafting a memo about "leveraging synergies to optimize the circle-back pipeline," which sources say is just a circle he drew on a whiteboard.</p>',
  'Synergex employees fear temporal paradox after CEO uses phrase "circle back" for the 47th consecutive meeting.',
  (SELECT id FROM categories WHERE slug = 'business'),
  'CEO announces another circle-back, employees suspect time loop. Satirical business news that hits too close to home.',
  ARRAY['corporate', 'business', 'meetings', 'CEO', 'office humor'],
  'Corporate Correspondent',
  false,
  4
),
(
  'Scientists Confirm What We All Suspected: Mondays Are Scientifically Worse',
  'scientists-confirm-mondays-worse',
  '<p>In a groundbreaking study published today in the Journal of Things Everyone Already Knew, researchers at MIT have officially confirmed that Mondays are, in fact, scientifically worse than all other days of the week.</p>
  <p>The 12-year longitudinal study, which cost taxpayers an estimated $4.7 million, tracked 10,000 participants across 15 countries and measured everything from cortisol levels to the frequency of heavy sighs.</p>
  <p>"Our data is unequivocal," said lead researcher Dr. Amanda Grumfeld, presenting her findings at a conference that was, ironically, held on a Monday. "Mondays produce 340% more audible groans, 200% more coffee consumption, and a 500% increase in people saying ''I can''t even'' compared to the weekly average."</p>
  <p>The study also found that Wednesdays, despite being called "hump day," provide no measurable humps of any kind, and that Friday afternoons see a 99.7% decrease in actual productivity, though email-sending increases by 400%.</p>
  <p>Critics have called the study "the most expensive confirmation of common sense in academic history," but Dr. Grumfeld remains undeterred. "Next, we plan to investigate whether water is wet and if pizza tastes good. We''ve already secured $6 million in funding."</p>
  <p>The only silver lining from the research: Tuesday was found to be "surprisingly tolerable," a finding that has already been optioned for a Netflix documentary series.</p>',
  'MIT''s $4.7 million study finally proves what your alarm clock has been telling you every single week.',
  (SELECT id FROM categories WHERE slug = 'science'),
  'MIT study confirms Mondays are scientifically the worst day. $4.7 million well spent on confirming the obvious.',
  ARRAY['science', 'mondays', 'research', 'funny study', 'MIT'],
  'Science Desk',
  true,
  3
);

-- ============================================
-- Storage: Create bucket for article images
-- NOTE: Also run this in Supabase SQL Editor
-- ============================================

-- Create the article-images storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'article-images',
  'article-images',
  true,
  5242880, -- 5MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to article images
CREATE POLICY "Public read access for article images"
ON storage.objects FOR SELECT
USING (bucket_id = 'article-images');

-- Allow service role to upload images
CREATE POLICY "Service role can upload article images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'article-images');

-- Allow service role to delete images
CREATE POLICY "Service role can delete article images"
ON storage.objects FOR DELETE
USING (bucket_id = 'article-images');
