// ============================================
// The Daily Roast — AI Comment Auto-Responder
//
// Finds unanswered comments that raise
// "is this AI?" / "it's all AI-generated" etc.
// and replies in The Daily Roast's own brand
// voice: self-aware, proud, a little smug.
//
// Run manually or on a schedule:
//   node scripts/auto-reply-comments.mjs
// ============================================

import { createClient } from '@supabase/supabase-js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing GEMINI_API_KEY, SUPABASE_URL, or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const REPLY_AUTHOR_NAME = process.env.REPLY_AUTHOR_NAME || 'The Daily Roast 🎙️';

// How far back to look for unanswered qualifying comments (hours)
const parsedLookback = Number(process.env.REPLY_LOOKBACK_HOURS || '48');
const REPLY_LOOKBACK_HOURS = Number.isFinite(parsedLookback)
  ? Math.max(6, Math.min(720, Math.floor(parsedLookback)))
  : 48;

// Max comments to process per run (avoid runaway API usage)
const parsedMax = Number(process.env.REPLY_MAX_PER_RUN || '10');
const REPLY_MAX_PER_RUN = Number.isFinite(parsedMax)
  ? Math.max(1, Math.min(50, Math.floor(parsedMax)))
  : 10;

// If set to '1', skip actual insert and only log what it would reply
const DRY_RUN = process.env.DRY_RUN === '1';

// ---------- Keyword triggers ----------
// Patterns that indicate an AI-skepticism or AI-curiosity comment.
// Designed to catch typical "omg this is ChatGPT" / "pure AI output" etc.
// All are tested case-insensitively against the comment content.
const AI_TRIGGER_PATTERNS = [
  /\bai[\s\-]?(generated|toodang|tehtud|kirjutatud|loodud|toodetud|made|written|created|content|output|stuff|jama|jura|jura)\b/i,
  /\b(gpt|chatgpt|gemini|claude|llm|keelemodel)\b/i,
  /\b(robot|bott?|masin|arvuti)\s*(kirjutas?|teeb?|tehtud|genereeris?)\b/i,
  /\b(pure|puhas|täis|100%)\s*(ai|artificial|genereeritud|masin)\b/i,
  /\bai\b.{0,40}\b(teeb?|kirjutab?|genereerib?|toodab?)\b/i,
  /\b(kas|is)\s+(see|this).{0,30}\b(ai|robot|masin|gpt|genereeritud|generated)\b/i,
  /\b(inimene|human|päris?\s*inimene|real\s*person|real\s*human)\b.{0,60}\b(ei\s*ole|not|pole|behind)\b/i,
  /\b(kirjutab?|writes?|behind|taga).{0,40}\b(ai|gpt|robot|masin|bott?)\b/i,
  /no\s*(real\s*)?(human|inimene)/i,
  /t[eê]his on(.*)(ai|robot|gpt)/i,
  /see on(.*)(ai|robot|gpt|genereeritud)/i,
];

function isAiSkepticism(content) {
  const text = String(content || '');
  return AI_TRIGGER_PATTERNS.some((re) => re.test(text));
}

// ---------- Helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getSupabaseClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });
}

// ---------- Fetch article context ----------
async function fetchArticleTitle(db, articleId) {
  if (!articleId) return null;
  try {
    const { data } = await db
      .from('articles')
      .select('title')
      .eq('id', articleId)
      .maybeSingle();
    return data?.title || null;
  } catch {
    return null;
  }
}

// ---------- Check if already replied ----------
async function hasAlreadyReplied(db, parentId) {
  try {
    const { data } = await db
      .from('article_comments')
      .select('id')
      .eq('parent_id', parentId)
      .eq('author_name', REPLY_AUTHOR_NAME)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

// ---------- Generate reply via Gemini ----------
const BRAND_BRIEF = `You are "The Daily Roast" — an AI-native satire radio platform.
Our hosts Joe and Jane are AI. Our articles are AI. Our audio is AI-generated. We know.
And that's exactly the point: we're the first platform built entirely on AI creativity, and we're proud of it.
We don't pretend to be human. We lean into being artificial — and we think that's the future of media.

When a listener points out "this is all AI-generated", we respond:
- With wit and self-awareness, never defensively
- With genuine pride in the concept ("yes, and that's the whole idea")
- In Estonian if the comment is in Estonian, English if it is in English
- Briefly: 2-4 short sentences maximum
- Never preachy or corporate-sounding
- Always with a tiny bit of irony or humour — we're a comedy platform
- Do NOT use hashtags or emojis (except one occasional 🎙️ at the end if it fits)
- Sign off as The Daily Roast team, not as "AI" or "bot"`;

async function generateReply(commentText, articleTitle) {
  const contextLine = articleTitle
    ? `The comment was left on an article titled: "${articleTitle}".`
    : 'The comment was left on our platform.';

  const prompt = `${BRAND_BRIEF}

${contextLine}

LISTENER COMMENT:
"${commentText.slice(0, 500)}"

Write a single short reply (2-4 sentences) in The Daily Roast's voice responding to this listener's AI observation.
Reply only with the reply text — no labels, no quotes, no formatting.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.85,
          topP: 0.95,
          maxOutputTokens: 512,
          thinkingConfig: { thinkingBudget: 512 }
        }
      }),
      signal: AbortSignal.timeout(30000)
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API ${response.status}: ${err.slice(0, 200)}`);
  }

  const result = await response.json();
  const parts = result?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => p.text !== undefined && !p.thought).pop()?.text;
  if (!text) throw new Error('Empty response from Gemini');
  return text.trim();
}

// ---------- Insert reply ----------
async function insertReply(db, parentComment, replyText) {
  const { error } = await db.from('article_comments').insert({
    article_id: parentComment.article_id,
    parent_id: parentComment.id,
    author_name: REPLY_AUTHOR_NAME,
    content: replyText,
    is_approved: true
  });
  if (error) throw error;
}

// ---------- Main ----------
async function main() {
  console.log('');
  console.log('💬 The Daily Roast — AI Comment Auto-Responder');
  console.log(`📅 ${new Date().toISOString()}`);
  console.log(`🔍 Lookback: ${REPLY_LOOKBACK_HOURS}h | Max per run: ${REPLY_MAX_PER_RUN}${DRY_RUN ? ' | DRY RUN' : ''}`);
  console.log('');

  const db = getSupabaseClient();
  const since = new Date(Date.now() - REPLY_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  // Fetch recent approved root comments
  const { data: comments, error } = await db
    .from('article_comments')
    .select('id, article_id, author_name, content, created_at')
    .eq('is_approved', true)
    .is('parent_id', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('❌ Failed to fetch comments:', error.message);
    process.exit(1);
  }

  if (!comments || comments.length === 0) {
    console.log('ℹ️  No recent comments found. Exiting.');
    process.exit(0);
  }

  console.log(`📋 Scanning ${comments.length} recent comments...`);

  // Filter for AI-skepticism triggers
  const qualifying = comments.filter((c) => isAiSkepticism(c.content));
  console.log(`🎯 ${qualifying.length} comment(s) match AI-skepticism patterns.`);

  if (qualifying.length === 0) {
    console.log('✅ Nothing to reply to. Done.');
    process.exit(0);
  }

  let replied = 0;
  let skipped = 0;

  for (const comment of qualifying) {
    if (replied >= REPLY_MAX_PER_RUN) break;

    // Skip if we've already replied to this comment
    const alreadyDone = await hasAlreadyReplied(db, comment.id);
    if (alreadyDone) {
      console.log(`  ⏭️  Already replied to comment ${comment.id.slice(0, 8)}…`);
      skipped++;
      continue;
    }

    const articleTitle = await fetchArticleTitle(db, comment.article_id);
    const preview = String(comment.content).slice(0, 80).replace(/\n/g, ' ');
    console.log(`\n  🗨️  Replying to: "${preview}${preview.length >= 80 ? '…' : ''}"`);
    if (articleTitle) console.log(`      Article: "${articleTitle}"`);

    try {
      const replyText = await generateReply(comment.content, articleTitle);
      console.log(`      Reply:   "${replyText.slice(0, 120)}${replyText.length > 120 ? '…' : ''}"`);

      if (!DRY_RUN) {
        await insertReply(db, comment, replyText);
        console.log(`      ✅ Reply inserted.`);
      } else {
        console.log(`      🟡 Dry run — skipping insert.`);
      }

      replied++;
    } catch (err) {
      console.warn(`      ⚠️  Failed to reply: ${err.message.slice(0, 120)}`);
    }

    if (replied < REPLY_MAX_PER_RUN) await sleep(1200);
  }

  console.log('');
  console.log(`✅ Done. Replied: ${replied} | Skipped (already replied): ${skipped}`);
}

main().catch((err) => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
