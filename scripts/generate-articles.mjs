// ============================================
// The Daily Roast — AI Article Generator
// 
// This script:
// 1. Fetches trending real news from multiple RSS feeds
// 2. Filters out already-covered topics
// 3. Uses Gemini AI to create satirical articles
// 4. Stores them in Supabase
//
// Run: node scripts/generate-articles.mjs
// Or via GitHub Actions daily cron
// ============================================

import { createClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';
import { GoogleGenAI } from '@google/genai';

// ---------- Configuration ----------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const ARTICLES_TO_GENERATE = parseInt(process.env.ARTICLES_COUNT || '0', 10); // 0 = all found topics
const IMAGE_BUCKET = 'article-images';

// Initialize Google GenAI SDK for image generation
const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// RSS News Sources — reliable, publicly accessible feeds
const RSS_SOURCES = [
  {
    name: 'BBC News - Top',
    url: 'https://feeds.bbci.co.uk/news/rss.xml',
    limit: 12
  },
  {
    name: 'BBC News - World',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    limit: 8
  },
  {
    name: 'BBC News - Technology',
    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    limit: 8
  },
  {
    name: 'BBC News - Business',
    url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    limit: 8
  },
  {
    name: 'BBC News - Entertainment',
    url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',
    limit: 8
  },
  {
    name: 'BBC News - Science',
    url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
    limit: 8
  },
  {
    name: 'NPR News',
    url: 'https://feeds.npr.org/1001/rss.xml',
    limit: 10
  },
  {
    name: 'Reuters - World',
    url: 'https://www.reutersagency.com/feed/?best-topics=world&post_type=best',
    limit: 8
  },
  {
    name: 'The Guardian - World',
    url: 'https://www.theguardian.com/world/rss',
    limit: 8
  },
  {
    name: 'The Guardian - Technology',
    url: 'https://www.theguardian.com/technology/rss',
    limit: 8
  },
  {
    name: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    limit: 8
  }
];

// Category keywords mapping (for auto-categorization fallback)
const CATEGORY_KEYWORDS = {
  politics: ['president', 'congress', 'senate', 'election', 'democrat', 'republican', 'government', 'policy', 'vote', 'law', 'legislation', 'trump', 'biden', 'political', 'party', 'campaign'],
  technology: ['tech', 'ai', 'artificial intelligence', 'software', 'app', 'google', 'apple', 'microsoft', 'startup', 'crypto', 'blockchain', 'robot', 'coding', 'algorithm', 'data', 'cyber', 'hack'],
  business: ['stock', 'market', 'economy', 'ceo', 'company', 'profit', 'revenue', 'billion', 'million', 'invest', 'bank', 'finance', 'trade', 'merger', 'acquisition'],
  science: ['study', 'research', 'scientist', 'discover', 'space', 'nasa', 'climate', 'species', 'medical', 'health', 'disease', 'vaccine', 'dna', 'physics', 'biology'],
  entertainment: ['movie', 'film', 'actor', 'singer', 'album', 'concert', 'netflix', 'disney', 'celebrity', 'oscar', 'grammy', 'streaming', 'tv show', 'music'],
  sports: ['game', 'match', 'score', 'team', 'championship', 'nba', 'nfl', 'soccer', 'football', 'baseball', 'tennis', 'olympic', 'athlete', 'coach', 'league'],
  world: ['country', 'international', 'united nations', 'war', 'peace', 'treaty', 'foreign', 'global', 'crisis', 'refugee', 'diplomacy']
};

// ---------- Initialize Supabase ----------

function getSupabaseClient() {
  if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_SERVICE_KEY is required. Set it as an environment variable.');
    process.exit(1);
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// ---------- RSS Fetching ----------

async function fetchRSS(source) {
  console.log(`  📡 Fetching: ${source.name}...`);
  try {
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TheDailyRoast/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      console.warn(`  ⚠️  ${source.name}: HTTP ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      processEntities: false,    // Don't expand entities (prevents entity limit error)
      htmlEntities: true
    });
    const result = parser.parse(xml);

    // Support both RSS and Atom feeds
    let items = [];
    if (result?.rss?.channel?.item) {
      const raw = result.rss.channel.item;
      items = Array.isArray(raw) ? raw : [raw];
    } else if (result?.feed?.entry) {
      const raw = result.feed.entry;
      items = (Array.isArray(raw) ? raw : [raw]).map(entry => ({
        title: entry.title?.['#text'] || entry.title || '',
        description: entry.summary?.['#text'] || entry.summary || entry.content?.['#text'] || '',
        link: entry.link?.['@_href'] || entry.id || '',
        pubDate: entry.updated || entry.published || ''
      }));
    }

    if (items.length === 0) return [];
    
    return items.slice(0, source.limit).map(item => ({
      title: cleanText(item.title || ''),
      description: cleanText(item.description || ''),
      link: item.link || '',
      pubDate: item.pubDate || '',
      source: source.name
    })).filter(item => item.title.length > 10);
  } catch (err) {
    console.warn(`  ⚠️  ${source.name}: ${err.message}`);
    return [];
  }
}

async function fetchAllNews() {
  console.log('\n📰 Fetching trending news...\n');
  
  // Primary: Use Gemini 2.5 with Search Grounding to find real current news
  console.log('  🔍 Using Gemini Search Grounding for real-time news discovery...\n');
  let unique = [];
  
  const geminiHeadlines = await fetchHeadlinesFromGemini();
  if (geminiHeadlines.length > 0) {
    unique = deduplicateHeadlines(geminiHeadlines);
    console.log(`  ✅ Found ${unique.length} headlines via Google Search Grounding\n`);
  }

  // Fallback: if Gemini search failed, try RSS feeds
  if (unique.length < 5) {
    console.log('  📡 Supplementing with RSS feeds...\n');
    const results = await Promise.allSettled(
      RSS_SOURCES.map(source => fetchRSS(source))
    );

    const rssHeadlines = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    unique = deduplicateHeadlines([...unique, ...rssHeadlines]);
    console.log(`  ✅ Total after RSS: ${unique.length} unique headlines\n`);
  }

  return unique;
}

// Gemini-based news discovery with Search Grounding
// Uses gemini-2.5-flash's Google Search integration to find REAL current headlines
async function fetchHeadlinesFromGemini() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `Search for and list 12 REAL, MAJOR news headlines from today (${today}) or the past 24 hours. Use Google Search to find actual current events that are trending right now.

Cover diverse categories: politics, technology, business, science, entertainment, sports, world affairs.

Return ONLY a JSON array of objects, each with "title" and "description" fields:
[
  {"title": "Actual real headline from today's news", "description": "Brief 1-sentence factual context"},
  ...
]

CRITICAL: Use Google Search to verify these are REAL stories from the past 24 hours. Return ONLY the JSON array.` }]
          }],
        tools: [{
          google_search: {}
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json'
        }
      }),
      signal: AbortSignal.timeout(45000)
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response');

    const headlines = JSON.parse(text);
    console.log(`  📡 Gemini provided ${headlines.length} trending topics`);
    
    return headlines.map(h => ({
      title: h.title || '',
      description: h.description || '',
      link: '',
      pubDate: new Date().toISOString(),
      source: 'Gemini AI - Trending'
    })).filter(h => h.title.length > 10);
  } catch (err) {
    console.warn(`  ⚠️  Gemini headline fallback failed: ${err.message}`);
    return [];
  }
}

function deduplicateHeadlines(headlines) {
  const seen = new Set();
  return headlines.filter(h => {
    const normalized = h.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const words = normalized.split(' ').slice(0, 5).join(' ');
    if (seen.has(words)) return false;
    seen.add(words);
    return true;
  });
}

function cleanText(text) {
  return text
    .replace(/<[^>]*>/g, '')     // Remove HTML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- Filter Already Covered Topics ----------

async function filterNewTopics(db, headlines) {
  console.log('🔍 Checking which topics are new...\n');
  
  try {
    // Get recent source headlines from generation log
    const { data: recentLogs } = await db
      .from('generation_log')
      .select('source_headline')
      .gte('generated_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()) // Last 72 hours
      .order('generated_at', { ascending: false });

    const coveredHeadlines = new Set(
      (recentLogs || []).map(l => l.source_headline.toLowerCase())
    );

    // Also check existing article titles for similarity
    const { data: recentArticles } = await db
      .from('articles')
      .select('title, source_headline')
      .gte('created_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString());

    (recentArticles || []).forEach(a => {
      if (a.source_headline) coveredHeadlines.add(a.source_headline.toLowerCase());
    });

    const newHeadlines = headlines.filter(h => {
      const lower = h.title.toLowerCase();
      for (const covered of coveredHeadlines) {
        if (similarityScore(lower, covered) > 0.6) return false;
      }
      return true;
    });

    console.log(`  ✅ ${newHeadlines.length} new topics found (${headlines.length - newHeadlines.length} already covered)\n`);
    return newHeadlines;
  } catch (err) {
    console.warn('  ⚠️  Could not check existing topics, proceeding with all:', err.message);
    return headlines;
  }
}

function similarityScore(a, b) {
  const wordsA = new Set(a.split(' '));
  const wordsB = new Set(b.split(' '));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  return intersection / Math.max(wordsA.size, wordsB.size);
}

// ---------- Topic Selection (pick the most interesting ones) ----------

async function selectBestTopics(headlines, count) {
  const total = count > 0 ? count : headlines.length;
  console.log(`🎯 Preparing ${total} topics for satirical treatment...\n`);

  // Categorize all headlines
  const categorized = headlines.map(h => ({
    ...h,
    guessedCategory: guessCategory(h.title + ' ' + h.description)
  }));

  // Sort for diversity: interleave categories so the pipeline covers variety
  const byCategory = {};
  for (const h of categorized) {
    if (!byCategory[h.guessedCategory]) byCategory[h.guessedCategory] = [];
    byCategory[h.guessedCategory].push(h);
  }

  const sorted = [];
  const categories = Object.keys(byCategory);
  let round = 0;
  while (sorted.length < total) {
    let added = false;
    for (const cat of categories) {
      if (round < byCategory[cat].length && sorted.length < total) {
        sorted.push(byCategory[cat][round]);
        added = true;
      }
    }
    if (!added) break;
    round++;
  }

  // Log category distribution
  const catCounts = {};
  sorted.forEach(h => { catCounts[h.guessedCategory] = (catCounts[h.guessedCategory] || 0) + 1; });
  console.log('  Category distribution:');
  for (const [cat, cnt] of Object.entries(catCounts)) {
    console.log(`    ${cat}: ${cnt} articles`);
  }
  console.log(`  Total: ${sorted.length} topics queued\n`);

  return sorted;
}

function guessCategory(text) {
  const lower = text.toLowerCase();
  let bestCat = 'world';
  let bestScore = 0;

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.filter(kw => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCat = cat;
    }
  }

  return bestCat;
}

// ---------- JSON Repair Helpers ----------

function repairJSON(text) {
  // Try parsing as-is first
  try {
    return JSON.parse(text);
  } catch (_) {}

  // Strip markdown code fences if present
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  // Try to extract JSON object from the text
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(cleaned);
    } catch (_) {}
  }

  // Field-by-field extraction — most robust for long HTML content strings
  try {
    return extractFieldsManually(cleaned);
  } catch (_) {}

  // Fix common issues: unescaped newlines inside string values
  cleaned = cleaned.replace(/(["']:.*?)\n(.*?["'])/gs, (m, a, b) => a + '\\n' + b);
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  // Last resort: try to fix truncated JSON by closing open strings/objects
  let fixed = cleaned;
  const openBraces = (fixed.match(/{/g) || []).length;
  const closeBraces = (fixed.match(/}/g) || []).length;
  const quoteCount = (fixed.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) fixed += '"';
  for (let i = 0; i < openBraces - closeBraces; i++) fixed += '}';
  try {
    return JSON.parse(fixed);
  } catch (finalErr) {
    throw new Error(`JSON repair failed: ${finalErr.message}`);
  }
}

/**
 * Extract known article fields from malformed JSON by finding each key
 * and pulling its value. This handles unescaped quotes/HTML in content.
 */
function extractFieldsManually(text) {
  const result = {};

  // Simple string fields (short values)
  for (const key of ['title', 'excerpt', 'category', 'meta_description', 'author']) {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    if (match) result[key] = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }

  // Integer fields
  for (const key of ['reading_time']) {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
    if (match) result[key] = parseInt(match[1], 10);
  }

  // Tags array
  const tagsMatch = text.match(/"tags"\s*:\s*\[(.*?)\]/s);
  if (tagsMatch) {
    try {
      result.tags = JSON.parse(`[${tagsMatch[1]}]`);
    } catch (_) {
      result.tags = tagsMatch[1].match(/"([^"]+)"/g)?.map(t => t.replace(/"/g, '')) || [];
    }
  }

  // Content field — the problematic long HTML string
  // Find "content": " then grab everything until the next known key or end
  const contentMatch = text.match(/"content"\s*:\s*"/);
  if (contentMatch) {
    const startIdx = contentMatch.index + contentMatch[0].length;
    // Find the end: look for ",\s*"(next_key)" or "\s*} at the end
    // We search for the pattern: "  ,  "(known_key)" or "  }
    const remaining = text.slice(startIdx);
    // Find last occurrence of a closing pattern
    const endPatterns = [
      /",\s*"category"\s*:/,
      /",\s*"tags"\s*:/,
      /",\s*"meta_description"\s*:/,
      /",\s*"author"\s*:/,
      /",\s*"reading_time"\s*:/,
      /",\s*"excerpt"\s*:/,
      /",\s*"title"\s*:/,
      /"\s*\}\s*$/
    ];

    let endIdx = remaining.length;
    for (const pattern of endPatterns) {
      const m = remaining.match(pattern);
      if (m && m.index < endIdx) {
        endIdx = m.index;
      }
    }

    let contentValue = remaining.slice(0, endIdx);
    // Clean up: ensure valid escaped string
    contentValue = contentValue
      .replace(/\\/g, '\\\\')  // escape backslashes
      .replace(/"/g, '\\"')     // escape quotes
      .replace(/\n/g, '\\n')    // escape newlines
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');

    // Now unescape HTML tags that we double-escaped
    // The original had things like <p> which are fine in JSON strings
    // but we may have double-escaped the original escapes
    try {
      result.content = JSON.parse(`"${contentValue}"`);
    } catch (_) {
      // Use raw cleaned value
      result.content = remaining.slice(0, endIdx)
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"');
    }
  }

  // Validate we got the essential fields
  if (!result.title || !result.content || !result.excerpt) {
    throw new Error('Manual extraction missing required fields');
  }

  return result;
}

// ---------- Gemini AI Article Generation ----------

async function generateSatiricalArticle(headline, retries = 3) {
  console.log(`    🤖 Step 1: Generating article text...`);

  const prompt = buildPrompt(headline);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.92,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 16384,
            responseMimeType: 'application/json',
            thinkingConfig: {
              thinkingBudget: 4096
            }
          }
        }),
        signal: AbortSignal.timeout(120000) // 2 min timeout for long articles
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const result = await response.json();
      
      // With thinking enabled, parts may include thought parts before the text
      const parts = result?.candidates?.[0]?.content?.parts || [];
      const textPart = parts.filter(p => p.text !== undefined && !p.thought).pop();
      const text = textPart?.text;

      if (!text) throw new Error('Empty response from Gemini');

      // Use robust JSON repair instead of raw JSON.parse
      const article = repairJSON(text);
      
      // Validate required fields
      if (!article.title || !article.content || !article.excerpt) {
        throw new Error('Missing required fields in generated article');
      }

      // Estimate word count
      const wordCount = article.content.replace(/<[^>]*>/g, '').split(/\s+/).length;
      console.log(`    ✅ Article text ready: "${article.title}" (~${wordCount} words)`);
      return {
        ...article,
        source_headline: headline.title
      };
    } catch (err) {
      if (attempt < retries) {
        const waitSec = 5 * (attempt + 1);
        console.warn(`    ⚠️  Text attempt ${attempt + 1}/${retries + 1} failed: ${err.message.slice(0, 120)}`);
        console.warn(`    ⏳ Waiting ${waitSec}s before retry...`);
        await sleep(waitSec * 1000);
      } else {
        console.error(`    ❌ Text generation failed after ${retries + 1} attempts: ${err.message.slice(0, 150)}`);
        return null;
      }
    }
  }
  return null;
}

function buildPrompt(headline) {
  return `You are a Pulitzer-worthy satirical journalist for "The Daily Roast" — the internet's sharpest humor news publication, in the tradition of The Onion, The Babylon Bee, Waterford Whispers, and The Daily Mash. Your articles are so well-crafted that readers share them with "IS THIS REAL?!" — and then burst out laughing.

REAL NEWS HEADLINE TO SATIRIZE:
"${headline.title}"
${headline.description ? `Context: ${headline.description}` : ''}

YOUR TASK: Write a FULL-LENGTH, publication-ready satirical news article. Not a summary — a complete, detailed, immersive piece that rewards every second of reading.

ARTICLE STRUCTURE (follow this closely):
1. **HEADLINE** — Punchy, click-worthy, immediately funny. The kind that makes someone stop scrolling.
2. **LEDE PARAGRAPH** — Classic inverted-pyramid news opening that instantly establishes the absurd premise as if completely real.
3. **THE STORY** (3-4 substantial paragraphs) — Develop the satirical narrative with rich details:
   - Use <h2> subheadings to break the article into named sections (e.g., "Experts Weigh In", "A Nation Reacts", "The Fallout Begins")
   - Include specific fictional details: dates, locations, organization names, percentages, dollar figures
   - Describe scenes and reactions — make the reader FEEL like they're watching it unfold
   - Each paragraph should be 60-100 words
4. **EXPERT QUOTES** — Weave in 3-4 fictional quotes throughout (not bunched together):
   - Give experts hilariously specific titles (e.g., "Dr. Margaret Bellsworth, Chair of Applied Disappointment at MIT")
   - Mix earnest-sounding quotes with ones that reveal comic absurdity
   - Use <blockquote> tags for the best/funniest quotes — these become visual pull quotes
5. **THE TWIST / ESCALATION** — The story should get progressively more absurd. What started as plausible should end up gloriously unhinged.
6. **AT PRESS TIME** — End with an italicized "At press time" one-liner that's the cherry on top. Wrap it in: <p class="at-press-time"><em>At press time, ...</em></p>

WRITING RULES:
- 800-1200 words of rich HTML content. This is a FULL article, not a blurb.
- Deadpan, authoritative news tone throughout. The humor comes from treating insanity as routine.
- Use proper HTML formatting: <p>, <h2>, <h3>, <blockquote>, <strong>, <em>
- Reference the REAL underlying topic/issue — readers should recognize what you're satirizing
- Be CLEVER, not crude. Punch UP, never down. No mean-spirited humor toward vulnerable groups.
- Every single paragraph must contain humor — a joke, an absurd detail, a clever turn of phrase
- Include little throwaway jokes in parenthetical asides or subordinate clauses
- Fictional statistics should sound official but be obviously ridiculous on reflection
- Corporate/government doublespeak and euphemisms are comedy gold — use them
- Make it SHAREABLE — the kind of article people screenshot and post on social media

HUMOR TOOLKIT:
- Escalating absurdity (start 80% real, end 20% real)
- Deadpan treatment of the outrageous
- Mundane bureaucratic details about extraordinary events
- Contradictory expert opinions delivered with total confidence
- Hilariously specific fake data ("a 340% increase in ambient bewilderment")
- Self-aware institutional doublespeak
- Callbacks to earlier details in the piece
- The perfect "at press time" kicker

OUTPUT FORMAT — Return ONLY valid JSON:
{
  "title": "Your satirical headline (max 120 chars, punchy and irresistible)",
  "excerpt": "A 1-2 sentence teaser hook that makes someone click immediately (max 250 chars)",
  "content": "Full HTML article. 800-1200 words. Use <p>, <h2>, <blockquote>, <strong>, <em>, and the at-press-time class.",
  "category": "One of: Politics, Technology, Business, Science, Entertainment, Sports, World",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "meta_description": "SEO meta description under 155 characters",
  "author": "A funny fictional byline — combine a real-sounding name with an absurd title (e.g., 'Diana Presswell, Senior Overreaction Correspondent')",
  "reading_time": 5
}

IMPORTANT: Return ONLY the JSON object. No markdown, no code blocks, no explanations. The "content" field must be a single JSON string with properly escaped HTML.`;
}

// ---------- Image Generation (Gemini) ----------

async function ensureStorageBucket(db) {
  try {
    const { data: buckets } = await db.storage.listBuckets();
    const exists = buckets?.some(b => b.name === IMAGE_BUCKET);
    if (!exists) {
      const { error } = await db.storage.createBucket(IMAGE_BUCKET, {
        public: true,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        fileSizeLimit: 5 * 1024 * 1024 // 5MB
      });
      if (error) console.warn(`  ⚠️  Bucket creation: ${error.message}`);
      else console.log(`  📦 Created storage bucket: ${IMAGE_BUCKET}`);
    }
  } catch (err) {
    console.warn(`  ⚠️  Storage bucket check failed: ${err.message}`);
  }
}

async function generateArticleImage(article, retries = 2) {
  const imagePrompt = buildImagePrompt(article);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await genai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: imagePrompt,
        config: {
          responseModalities: ['IMAGE', 'TEXT'],
        }
      });

      // Check if response was blocked by safety filters
      if (!response.candidates || response.candidates.length === 0) {
        throw new Error('Empty response — likely blocked by safety filters');
      }

      const candidate = response.candidates[0];
      if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'BLOCKED') {
        throw new Error(`Image blocked: ${candidate.finishReason}`);
      }

      const parts = candidate?.content?.parts || [];

      // Find the image part
      const imagePart = parts.find(p => p.inlineData);
      if (!imagePart) {
        throw new Error('No image data in response parts');
      }

      const base64Data = imagePart.inlineData.data;
      const mimeType = imagePart.inlineData.mimeType || 'image/png';
      const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';

      console.log(`    ✅ Image generated (${mimeType}, ~${Math.round(base64Data.length * 0.75 / 1024)}KB)`);
      return { base64Data, mimeType, ext };
    } catch (err) {
      const msg = err?.message || String(err);
      if (attempt < retries) {
        const waitSec = 6 * (attempt + 1);
        console.warn(`    ⚠️  Image attempt ${attempt + 1}/${retries + 1} failed: ${msg.slice(0, 120)}`);
        console.warn(`    ⏳ Waiting ${waitSec}s before retry...`);
        await sleep(waitSec * 1000);
      } else {
        console.warn(`    ⚠️  Image generation failed after ${retries + 1} attempts: ${msg.slice(0, 120)}`);
        return null;
      }
    }
  }
  return null;
}

function buildImagePrompt(article) {
  const category = article.category || 'News';
  return `Generate a professional editorial news photograph for a satirical news article.

ARTICLE HEADLINE: "${article.title}"
ARTICLE SUMMARY: ${article.excerpt}
CATEGORY: ${category}

REQUIREMENTS:
- Professional news/editorial photography style
- Photorealistic, high quality, well-lit
- 16:9 landscape aspect ratio composition
- Should visually relate to the headline's theme
- Should look like it belongs on a professional news website
- NO text, NO watermarks, NO logos, NO words overlaid on the image
- Should be slightly absurd or humorous to match the satirical tone
- Vibrant but not garish colors
- Clean composition with clear focal point

Do NOT include any text or lettering in the image.`;
}

async function uploadImageToSupabase(db, imageData, slug) {
  const { base64Data, mimeType, ext } = imageData;
  const fileName = `${slug}-${Date.now()}.${ext}`;
  const filePath = `${new Date().toISOString().slice(0, 7)}/${fileName}`; // e.g. 2026-03/slug-123.png

  try {
    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');

    const { data, error } = await db.storage
      .from(IMAGE_BUCKET)
      .upload(filePath, buffer, {
        contentType: mimeType,
        cacheControl: '31536000', // 1 year cache
        upsert: false
      });

    if (error) throw error;

    // Get public URL
    const { data: urlData } = db.storage
      .from(IMAGE_BUCKET)
      .getPublicUrl(filePath);

    const publicUrl = urlData?.publicUrl;
    console.log(`  📤 Uploaded image: ${publicUrl}`);
    return publicUrl;
  } catch (err) {
    console.warn(`  ⚠️  Image upload failed: ${err.message}`);
    return null;
  }
}

// ---------- Save to Supabase ----------

async function saveArticle(db, article) {
  const slug = createSlug(article.title);
  
  // Get category ID
  const categorySlug = article.category ? article.category.toLowerCase() : 'world';
  const { data: category } = await db
    .from('categories')
    .select('id')
    .eq('slug', categorySlug)
    .single();

  const articleData = {
    title: article.title,
    slug: slug,
    content: article.content,
    excerpt: article.excerpt,
    category_id: category?.id || null,
    author: article.author || 'AI Correspondent',
    meta_description: article.meta_description || article.excerpt,
    tags: article.tags || [],
    source_headline: article.source_headline,
    reading_time: article.reading_time || 3,
    published: true,
    featured: false,
    image_url: article.image_url || null,
    image_alt: article.title
  };

  try {
    const { data, error } = await db
      .from('articles')
      .insert(articleData)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique violation (slug already exists)
        articleData.slug = slug + '-' + Date.now().toString(36);
        const { data: retryData, error: retryError } = await db
          .from('articles')
          .insert(articleData)
          .select()
          .single();
        if (retryError) throw retryError;
        return retryData;
      }
      throw error;
    }

    return data;
  } catch (err) {
    console.error(`  ❌ Failed to save "${article.title}": ${err.message}`);
    return null;
  }
}

async function logGeneration(db, headline, success, errorMessage = null) {
  try {
    await db.from('generation_log').insert({
      source_headline: headline.title,
      source_url: headline.link || null,
      success,
      error_message: errorMessage
    });
  } catch (err) {
    // Silent fail for logging
  }
}

function createSlug(title) {
  return title
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ---------- Feature One Random Article ----------

async function featureRandomArticle(db) {
  try {
    // Unfeature all existing
    await db
      .from('articles')
      .update({ featured: false })
      .eq('featured', true);

    // Feature the most recent article
    const { data } = await db
      .from('articles')
      .select('id')
      .eq('published', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (data) {
      await db
        .from('articles')
        .update({ featured: true })
        .eq('id', data.id);
    }
  } catch (err) {
    console.warn('  ⚠️  Could not feature article:', err.message);
  }
}

// ---------- Utility ----------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------- Main Execution ----------

async function main() {
  console.log('');
  console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
  console.log('🔥  THE DAILY ROAST — Article Generator   🔥');
  console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
  console.log('');
  console.log(`📅 ${new Date().toISOString()}`);
  const targetLabel = ARTICLES_TO_GENERATE > 0 ? `${ARTICLES_TO_GENERATE} articles` : 'ALL found topics';
  console.log(`🎯 Target: ${targetLabel}\n`);

  const db = getSupabaseClient();

  // Step 0: Ensure image storage bucket exists
  await ensureStorageBucket(db);

  // Step 1: Fetch news
  const allHeadlines = await fetchAllNews();
  
  if (allHeadlines.length === 0) {
    console.error('❌ No headlines fetched. Exiting.');
    process.exit(1);
  }

  // Step 2: Filter already covered
  const newHeadlines = await filterNewTopics(db, allHeadlines);

  if (newHeadlines.length === 0) {
    console.log('✨ All current topics already covered! Nothing new to generate.');
    process.exit(0);
  }

  // Step 3: Select best topics
  const selected = await selectBestTopics(newHeadlines, ARTICLES_TO_GENERATE);

  // Step 4: Generate articles — ONE AT A TIME with full pipeline per article
  console.log('✍️  Generating satirical articles (one at a time)...\n');
  
  let successCount = 0;
  let failCount = 0;
  const DELAY_BETWEEN_STEPS = 5000;  // 5s between each API call
  const DELAY_BETWEEN_ARTICLES = 10000; // 10s cooldown between articles

  for (let i = 0; i < selected.length; i++) {
    const headline = selected[i];
    const articleNum = i + 1;
    const total = selected.length;

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📰 ARTICLE ${articleNum}/${total}: "${headline.title}"`);
    console.log(`${'─'.repeat(60)}`);

    // ── Step 1: Generate article text ──
    const article = await generateSatiricalArticle(headline);
    
    if (!article) {
      console.log(`    ❌ Skipping — text generation failed.`);
      await logGeneration(db, headline, false, 'AI text generation failed');
      failCount++;
      if (i < selected.length - 1) {
        console.log(`    ⏳ Cooling down ${DELAY_BETWEEN_ARTICLES / 1000}s before next article...`);
        await sleep(DELAY_BETWEEN_ARTICLES);
      }
      continue;
    }

    // ── Step 2: Wait, then generate image ──
    console.log(`    ⏳ Waiting ${DELAY_BETWEEN_STEPS / 1000}s before image generation...`);
    await sleep(DELAY_BETWEEN_STEPS);

    console.log(`    🎨 Step 2: Generating article image...`);
    const imageData = await generateArticleImage(article);
    if (imageData) {
      const slug = createSlug(article.title);

      // ── Step 3: Wait, then upload image ──
      console.log(`    ⏳ Waiting ${DELAY_BETWEEN_STEPS / 1000}s before upload...`);
      await sleep(DELAY_BETWEEN_STEPS);

      console.log(`    📤 Step 3: Uploading image to Supabase...`);
      const imageUrl = await uploadImageToSupabase(db, imageData, slug);
      if (imageUrl) {
        article.image_url = imageUrl;
        console.log(`    ✅ Image uploaded successfully`);
      } else {
        console.log(`    ⚠️  Image upload failed — article will use fallback`);
      }
    } else {
      console.log(`    ⚠️  No image generated — article will use category fallback`);
    }

    // ── Step 4: Wait, then save to database ──
    console.log(`    ⏳ Waiting ${DELAY_BETWEEN_STEPS / 1000}s before saving...`);
    await sleep(DELAY_BETWEEN_STEPS);

    console.log(`    💾 Step 4: Saving to Supabase...`);
    const saved = await saveArticle(db, article);
    if (saved) {
      await logGeneration(db, headline, true);
      successCount++;
      console.log(`    ✅ DONE — "${saved.title}"`);
      console.log(`       Slug: ${saved.slug}`);
      console.log(`       Image: ${article.image_url ? '✓' : '✗ (fallback)'}`);
    } else {
      await logGeneration(db, headline, false, 'Failed to save to database');
      failCount++;
      console.log(`    ❌ Failed to save article to database`);
    }

    // ── Cooldown before next article ──
    if (i < selected.length - 1) {
      console.log(`\n    ⏳ Cooldown ${DELAY_BETWEEN_ARTICLES / 1000}s before next article...`);
      await sleep(DELAY_BETWEEN_ARTICLES);
    }
  }

  // Step 5: Feature the latest article
  await featureRandomArticle(db);

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 GENERATION SUMMARY');
  console.log('='.repeat(50));
  console.log(`  ✅ Successfully generated: ${successCount}`);
  console.log(`  ❌ Failed: ${failCount}`);
  console.log(`  📝 Total articles attempted: ${selected.length}`);
  console.log('='.repeat(50));
  console.log('');

  if (failCount > 0 && successCount === 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
