// ============================================
// The Daily Roast — Auto-Post to Reddit & X (Twitter)
//
// Posts the latest generated articles to:
//   - Reddit (via OAuth2 API)
//   - X / Twitter (via OAuth 1.0a API)
//
// Environment variables required:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD, REDDIT_SUBREDDIT
//   TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET
//
// Run: node scripts/auto-post.mjs
// ============================================

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import https from 'https';

// ---------- Config ----------

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SITE_URL = process.env.SITE_URL || 'https://thedailyroast.online';

// Reddit
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REDDIT_USERNAME = process.env.REDDIT_USERNAME;
const REDDIT_PASSWORD = process.env.REDDIT_PASSWORD;
const REDDIT_SUBREDDIT = process.env.REDDIT_SUBREDDIT || 'thedailyroast';

// Twitter / X
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;

const MAX_POSTS = parseInt(process.env.MAX_AUTO_POSTS || '3', 10);

// ---------- Supabase ----------

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function getRecentUnpostedArticles() {
  // Get articles from last 24 hours that haven't been auto-posted
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  const { data, error } = await db
    .from('articles')
    .select('id, slug, title, excerpt, tags, category_id')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_POSTS);

  if (error) {
    console.error('❌ Error fetching articles:', error.message);
    return [];
  }

  return data || [];
}

// ---------- Reddit ----------

async function getRedditToken() {
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_USERNAME || !REDDIT_PASSWORD) {
    console.log('⚠️  Reddit credentials not set, skipping Reddit posting');
    return null;
  }

  const auth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
  
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'TheDailyRoast/1.0'
    },
    body: `grant_type=password&username=${encodeURIComponent(REDDIT_USERNAME)}&password=${encodeURIComponent(REDDIT_PASSWORD)}`
  });

  const data = await res.json();
  if (data.access_token) return data.access_token;
  
  console.error('❌ Reddit auth failed:', data);
  return null;
}

async function postToReddit(article, token) {
  if (!token) return false;

  const url = `${SITE_URL}/article?slug=${article.slug}`;
  const flair = article.tags?.[0] ? `[${article.tags[0].toUpperCase()}]` : '[SATIRE]';
  const title = `${flair} ${article.title}`;

  try {
    const res = await fetch('https://oauth.reddit.com/api/submit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'TheDailyRoast/1.0'
      },
      body: new URLSearchParams({
        sr: REDDIT_SUBREDDIT,
        kind: 'link',
        title: title.slice(0, 300),
        url: url,
        resubmit: 'true',
        nsfw: 'false'
      })
    });

    const data = await res.json();
    if (data.success || data.json?.data?.url) {
      console.log(`  ✅ Reddit: Posted "${article.title.slice(0, 50)}..."`);
      return true;
    } else {
      console.error(`  ❌ Reddit post failed:`, JSON.stringify(data.json?.errors || data).slice(0, 200));
      return false;
    }
  } catch (err) {
    console.error(`  ❌ Reddit error:`, err.message);
    return false;
  }
}

// ---------- Twitter / X ----------

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function generateOAuthSignature(method, url, params, consumerSecret, tokenSecret) {
  const sortedParams = Object.keys(params)
    .sort()
    .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');

  const baseString = `${method}&${percentEncode(url)}&${percentEncode(sortedParams)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

async function postToTwitter(article) {
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
    console.log('⚠️  Twitter credentials not set, skipping Twitter posting');
    return false;
  }

  const articleUrl = `${SITE_URL}/article?slug=${article.slug}`;
  const hashtags = (article.tags || []).slice(0, 3).map(t => `#${t.replace(/\s+/g, '')}`).join(' ');
  
  // Compose tweet text (max 280 chars)
  let tweetText = `🔥 ${article.title}\n\n${articleUrl}`;
  if (hashtags && tweetText.length + hashtags.length + 2 <= 280) {
    tweetText += `\n\n${hashtags} #satire`;
  } else {
    tweetText += '\n\n#satire #thedailyroast';
  }
  tweetText = tweetText.slice(0, 280);

  const apiUrl = 'https://api.twitter.com/2/tweets';
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams = {
    oauth_consumer_key: TWITTER_API_KEY,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: TWITTER_ACCESS_TOKEN,
    oauth_version: '1.0'
  };

  const signature = generateOAuthSignature('POST', apiUrl, oauthParams, TWITTER_API_SECRET, TWITTER_ACCESS_SECRET);
  oauthParams.oauth_signature = signature;

  const authHeader = 'OAuth ' + Object.keys(oauthParams)
    .sort()
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(', ');

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: tweetText })
    });

    const data = await res.json();
    if (data.data?.id) {
      console.log(`  ✅ Twitter: Posted tweet ${data.data.id}`);
      return true;
    } else {
      console.error(`  ❌ Twitter post failed:`, JSON.stringify(data).slice(0, 200));
      return false;
    }
  } catch (err) {
    console.error(`  ❌ Twitter error:`, err.message);
    return false;
  }
}

// ---------- Main ----------

async function main() {
  console.log('\n🔥 The Daily Roast — Auto-Poster\n');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  const articles = await getRecentUnpostedArticles();
  console.log(`📰 Found ${articles.length} recent articles to share\n`);

  if (articles.length === 0) {
    console.log('✅ Nothing to post today');
    return;
  }

  // Get Reddit token once
  const redditToken = await getRedditToken();

  let redditCount = 0;
  let twitterCount = 0;

  for (const article of articles) {
    console.log(`📝 "${article.title.slice(0, 60)}..."`);

    // Post to Reddit
    if (redditToken) {
      const ok = await postToReddit(article, redditToken);
      if (ok) redditCount++;
      // Rate limit: wait 2 seconds between Reddit posts
      await new Promise(r => setTimeout(r, 2000));
    }

    // Post to Twitter
    const tOk = await postToTwitter(article);
    if (tOk) twitterCount++;
    // Rate limit: wait 1 second between tweets
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n📊 Summary: Reddit ${redditCount}/${articles.length}, Twitter ${twitterCount}/${articles.length}`);
  console.log('✅ Auto-posting complete\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
