import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function getUTCDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function getTodayBoundsUTC() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function getCandidateArticle() {
  const { start, end } = getTodayBoundsUTC();

  let { data, error } = await db
    .from('articles_with_category')
    .select('*')
    .gte('created_at', start)
    .lt('created_at', end)
    .order('views', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  if (data && data.length > 0) return data[0];

  const { data: fallbackData, error: fallbackError } = await db
    .from('articles_with_category')
    .select('*')
    .order('views', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);

  if (fallbackError) throw fallbackError;
  return (fallbackData && fallbackData.length > 0) ? fallbackData[0] : null;
}

async function main() {
  const lockDate = getUTCDateKey();
  console.log(`Lock date: ${lockDate}`);

  const { data: existing, error: existingError } = await db
    .from('daily_roast_lock')
    .select('id, article_slug, title')
    .eq('lock_date', lockDate)
    .limit(1);

  if (existingError) {
    console.error('Could not read daily_roast_lock:', existingError.message);
    process.exit(1);
  }

  if (existing && existing.length > 0) {
    console.log(`Already locked: ${existing[0].article_slug}`);
    return;
  }

  const candidate = await getCandidateArticle();
  if (!candidate) {
    console.log('No article available for lock.');
    return;
  }

  const row = {
    lock_date: lockDate,
    article_id: candidate.id,
    article_slug: candidate.slug,
    title: candidate.title,
    excerpt: candidate.excerpt,
    image_url: candidate.image_url,
    image_alt: candidate.image_alt,
    category_slug: candidate.category_slug,
    category_name: candidate.category_name,
    category_color: candidate.category_color,
    views_snapshot: candidate.views || 0,
    source_created_at: candidate.created_at
  };

  const { error: insertError } = await db
    .from('daily_roast_lock')
    .insert(row);

  if (insertError) {
    console.error('Failed to create daily lock:', insertError.message);
    process.exit(1);
  }

  console.log(`Locked Roast of the Day: ${candidate.title}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
