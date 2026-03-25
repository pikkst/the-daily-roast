import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function getWeekWindowUTC() {
  const now = new Date();
  const day = now.getUTCDay();
  const offsetToMonday = (day + 6) % 7;

  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  weekStart.setUTCDate(weekStart.getUTCDate() - offsetToMonday);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  const nextWeekStart = new Date(weekStart);
  nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() + 7);

  const weekKey = `${weekStart.toISOString().slice(0, 10)}_to_${weekEnd.toISOString().slice(0, 10)}`;

  return {
    weekKey,
    weekStartDate: weekStart.toISOString().slice(0, 10),
    weekEndDate: weekEnd.toISOString().slice(0, 10),
    fromISO: weekStart.toISOString(),
    toISOExclusive: nextWeekStart.toISOString()
  };
}

function toCountMap(rows, keyName) {
  const map = new Map();
  for (const row of rows || []) {
    const key = row[keyName];
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function computeAbsurdityScore(article, reactionCount, commentCount, maxViews, maxReactions, maxComments) {
  const viewRatio = maxViews > 0 ? (article.views || 0) / maxViews : 0;
  const reactionRatio = maxReactions > 0 ? reactionCount / maxReactions : 0;
  const commentRatio = maxComments > 0 ? commentCount / maxComments : 0;

  const score = (viewRatio * 65) + (reactionRatio * 20) + (commentRatio * 15);
  return Math.max(1, Math.min(100, Math.round(score)));
}

async function main() {
  const window = getWeekWindowUTC();
  console.log(`Generating weekly Top 10 for ${window.weekKey}`);

  const { data: articleRows, error: articleError } = await db
    .from('articles_with_category')
    .select('id, slug, title, excerpt, category_slug, views, created_at')
    .gte('created_at', window.fromISO)
    .lt('created_at', window.toISOExclusive)
    .order('views', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);

  if (articleError) {
    console.error('Failed to fetch weekly articles:', articleError.message);
    process.exit(1);
  }

  const weeklyArticles = articleRows || [];
  if (weeklyArticles.length === 0) {
    console.log('No articles found in this weekly window.');
    return;
  }

  const top = weeklyArticles.slice(0, 10);
  const articleIds = top.map((a) => a.id).filter(Boolean);

  const [{ data: reactionRows, error: reactionError }, { data: commentRows, error: commentError }] = await Promise.all([
    db.from('article_reactions').select('article_id').in('article_id', articleIds),
    db.from('article_comments').select('article_id').eq('is_approved', true).in('article_id', articleIds)
  ]);

  const reactionMap = reactionError ? new Map() : toCountMap(reactionRows, 'article_id');
  const commentMap = commentError ? new Map() : toCountMap(commentRows, 'article_id');

  if (reactionError) {
    console.warn('article_reactions unavailable, using zero counts for reactions.');
  }

  if (commentError) {
    console.warn('article_comments unavailable, using zero counts for comments.');
  }

  const maxViews = Math.max(...top.map((a) => a.views || 0), 0);
  const maxReactions = Math.max(...top.map((a) => reactionMap.get(a.id) || 0), 0);
  const maxComments = Math.max(...top.map((a) => commentMap.get(a.id) || 0), 0);

  const ranked = top.map((article, index) => {
    const reactionCount = reactionMap.get(article.id) || 0;
    const commentCount = commentMap.get(article.id) || 0;

    return {
      rank: index + 1,
      article_id: article.id,
      article_slug: article.slug,
      title: article.title,
      excerpt: article.excerpt,
      category_slug: article.category_slug,
      views: article.views || 0,
      reaction_count: reactionCount,
      comment_count: commentCount,
      absurdity_score: computeAbsurdityScore(article, reactionCount, commentCount, maxViews, maxReactions, maxComments)
    };
  });

  const summaryPayload = {
    week_key: window.weekKey,
    week_start_date: window.weekStartDate,
    week_end_date: window.weekEndDate,
    total_articles: weeklyArticles.length,
    top_article_id: ranked[0].article_id,
    top_article_slug: ranked[0].article_slug,
    top_article_title: ranked[0].title,
    generated_at: new Date().toISOString()
  };

  const { data: summaryRows, error: summaryError } = await db
    .from('weekly_roast_summaries')
    .upsert(summaryPayload, { onConflict: 'week_key' })
    .select('id')
    .limit(1);

  if (summaryError || !summaryRows || summaryRows.length === 0) {
    console.error('Failed to upsert weekly summary:', summaryError?.message || 'Unknown error');
    process.exit(1);
  }

  const summaryId = summaryRows[0].id;

  const { error: deleteError } = await db
    .from('weekly_roast_items')
    .delete()
    .eq('summary_id', summaryId);

  if (deleteError) {
    console.error('Failed to clear old weekly items:', deleteError.message);
    process.exit(1);
  }

  const itemPayload = ranked.map((row) => ({
    summary_id: summaryId,
    ...row
  }));

  const { error: insertError } = await db
    .from('weekly_roast_items')
    .insert(itemPayload);

  if (insertError) {
    console.error('Failed to insert weekly items:', insertError.message);
    process.exit(1);
  }

  console.log(`Weekly Top 10 generated with ${ranked.length} items.`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
