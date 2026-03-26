// ============================================
// The Daily Roast — Broadcast Generator
// 
// Generates a comedy radio show from the latest articles.
// Takes 1 article per category (7 total) and creates a
// full-length broadcast with two hosts: Joe & Jane.
//
// Pipeline:
// 1. Fetch latest article per category from Supabase
// 2. Generate comedy radio script via Gemini
// 3. Generate TTS audio via Gemini multi-speaker TTS
// 4. Generate cover image
// 5. Upload audio + image to Supabase Storage
// 6. Save broadcast metadata to broadcasts table
//
// Run: node scripts/generate-broadcast.mjs
// ============================================

import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Modality } from '@google/genai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// ---------- Configuration ----------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const genai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const AUDIO_BUCKET = 'broadcast-audio';
const IMAGE_BUCKET = 'article-images';

const CATEGORIES = ['politics', 'technology', 'business', 'science', 'entertainment', 'sports', 'world'];

const CATEGORY_ICONS = {
  politics: '🏛️',
  technology: '💻',
  business: '💼',
  science: '🔬',
  entertainment: '🎬',
  sports: '⚽',
  world: '🌍'
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const TALLINN_TIMEZONE = 'Europe/Tallinn';
const POLTSAMAA = { name: 'Poltsamaa, Estonia', latitude: 58.6525, longitude: 25.9717 };
const BROADCAST_SLOT = (process.env.BROADCAST_SLOT || '').trim().toLowerCase();
const ENFORCE_TALLINN_SLOT_TIME = process.env.ENFORCE_TALLINN_SLOT_TIME === '1';
const FORCE_REPLACE_EDITION = process.env.FORCE_REPLACE_EDITION === '1';
const parsedBgmVolume = Number(process.env.BGM_VOLUME || '0.10');
const BGM_VOLUME = Number.isFinite(parsedBgmVolume)
  ? Math.min(1, Math.max(0, parsedBgmVolume))
  : 0.10;
const BGM_THEMES = ['upbeat', 'chill', 'funky', 'dramatic'];

function parseListEnv(value) {
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function buildBgmCatalog() {
  const catalog = {
    upbeat: parseListEnv(process.env.BGM_TRACK_UPBEAT),
    chill: parseListEnv(process.env.BGM_TRACK_CHILL),
    funky: parseListEnv(process.env.BGM_TRACK_FUNKY),
    dramatic: parseListEnv(process.env.BGM_TRACK_DRAMATIC)
  };

  const rawJson = String(process.env.BGM_TRACKS_JSON || '').trim();
  if (!rawJson) return catalog;

  try {
    const parsed = JSON.parse(rawJson);
    for (const theme of BGM_THEMES) {
      if (Array.isArray(parsed?.[theme])) {
        catalog[theme] = parsed[theme].map(v => String(v || '').trim()).filter(Boolean);
      }
    }
  } catch (err) {
    console.warn(`  ⚠️  Invalid BGM_TRACKS_JSON: ${err.message}`);
  }

  return catalog;
}

const BGM_CATALOG = buildBgmCatalog();

function normalizeBgmTheme(rawTheme) {
  const theme = String(rawTheme || '').trim().toLowerCase();
  return BGM_THEMES.includes(theme) ? theme : 'upbeat';
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function getTrackExtension(track) {
  try {
    if (isHttpUrl(track)) {
      const url = new URL(track);
      const ext = path.extname(url.pathname || '').toLowerCase();
      return ext || '.mp3';
    }
  } catch {
    // fall through to local-path logic
  }

  const ext = path.extname(String(track || '')).toLowerCase();
  return ext || '.mp3';
}

function pickBgmTrack(theme) {
  const normalized = normalizeBgmTheme(theme);
  const tracks = BGM_CATALOG[normalized] || [];
  if (tracks.length === 0) return null;

  // Deterministic daily rotation to avoid repeating exactly the same track every run.
  const dayBucket = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  const index = dayBucket % tracks.length;
  return tracks[index];
}

function runCommand(cmd, args, stdio = 'pipe') {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio });
    let stderr = '';

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk || '');
      });
    }

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(0, 400)}`));
      }
    });
    child.on('error', reject);
  });
}

async function fetchBinary(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}) from ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function mixBackgroundMusic(speechWavBuffer, bgmTheme) {
  const selectedTheme = normalizeBgmTheme(bgmTheme);
  const selectedTrack = pickBgmTrack(selectedTheme);
  if (!selectedTrack) {
    console.log('  🎵 No BGM tracks configured, keeping voice-only audio.');
    return {
      wavBuffer: speechWavBuffer,
      bgmTheme: selectedTheme,
      bgmTrack: null,
      mixed: false
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-roast-bgm-'));
  const speechPath = path.join(tmpDir, 'speech.wav');
  const bgmPath = path.join(tmpDir, `bgm-source${getTrackExtension(selectedTrack)}`);
  const mixedPath = path.join(tmpDir, 'broadcast-mixed.wav');

  try {
    fs.writeFileSync(speechPath, speechWavBuffer);

    if (isHttpUrl(selectedTrack)) {
      const bgmData = await fetchBinary(selectedTrack);
      fs.writeFileSync(bgmPath, bgmData);
    } else {
      const resolved = path.isAbsolute(selectedTrack)
        ? selectedTrack
        : path.resolve(process.cwd(), selectedTrack);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Configured BGM track not found: ${resolved}`);
      }
      fs.copyFileSync(resolved, bgmPath);
    }

    const safeVolume = BGM_VOLUME.toFixed(3);
    await runCommand('ffmpeg', [
      '-y',
      '-i', speechPath,
      '-stream_loop', '-1',
      '-i', bgmPath,
      '-filter_complex', `[1:a]volume=${safeVolume}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2,alimiter=limit=0.95[aout]`,
      '-map', '[aout]',
      '-ar', '24000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      mixedPath
    ]);

    const mixedBuffer = fs.readFileSync(mixedPath);
    return {
      wavBuffer: mixedBuffer,
      bgmTheme: selectedTheme,
      bgmTrack: selectedTrack,
      mixed: true
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function getTallinnNow(now = new Date()) {
  return new Date(now.toLocaleString('en-US', { timeZone: TALLINN_TIMEZONE }));
}

function shouldRunScheduledBroadcast(now = new Date()) {
  const tallinnNow = getTallinnNow(now);
  const hour = tallinnNow.getHours();
  return hour === 9 || hour === 15 || hour === 21;
}

function getNextEditionTease(editionKey) {
  if (editionKey === 'morning') {
    return 'Sign off by inviting listeners back this afternoon.';
  }
  if (editionKey === 'afternoon') {
    return 'Sign off by inviting listeners back this evening.';
  }
  return 'Sign off by inviting listeners back tomorrow morning.';
}

function getBroadcastEditionContext(now = new Date()) {
  if (BROADCAST_SLOT === 'morning') {
    return {
      key: 'morning',
      label: 'Morning Edition',
      nominalTime: '09:00',
      styleCue: 'energized start-of-day briefing'
    };
  }
  if (BROADCAST_SLOT === 'afternoon') {
    return {
      key: 'afternoon',
      label: 'Afternoon Edition',
      nominalTime: '15:00',
      styleCue: 'midday follow-up and update briefing'
    };
  }
  if (BROADCAST_SLOT === 'evening') {
    return {
      key: 'evening',
      label: 'Evening Edition',
      nominalTime: '21:00',
      styleCue: 'end-of-day wrap-up briefing'
    };
  }

  const tallinnNow = getTallinnNow(now);
  const hour = tallinnNow.getHours();

  if (hour < 12) {
    return {
      key: 'morning',
      label: 'Morning Edition',
      nominalTime: '09:00',
      styleCue: 'energized start-of-day briefing'
    };
  }
  if (hour < 18) {
    return {
      key: 'afternoon',
      label: 'Afternoon Edition',
      nominalTime: '15:00',
      styleCue: 'midday follow-up and update briefing'
    };
  }
  return {
    key: 'evening',
    label: 'Evening Edition',
    nominalTime: '21:00',
    styleCue: 'end-of-day wrap-up briefing'
  };
}

function getWeatherLabel(code) {
  const labels = {
    0: 'clear sky',
    1: 'mainly clear',
    2: 'partly cloudy',
    3: 'overcast',
    45: 'foggy',
    48: 'depositing rime fog',
    51: 'light drizzle',
    53: 'moderate drizzle',
    55: 'dense drizzle',
    56: 'light freezing drizzle',
    57: 'dense freezing drizzle',
    61: 'slight rain',
    63: 'moderate rain',
    65: 'heavy rain',
    66: 'light freezing rain',
    67: 'heavy freezing rain',
    71: 'slight snowfall',
    73: 'moderate snowfall',
    75: 'heavy snowfall',
    77: 'snow grains',
    80: 'slight rain showers',
    81: 'moderate rain showers',
    82: 'violent rain showers',
    85: 'slight snow showers',
    86: 'heavy snow showers',
    95: 'thunderstorm',
    96: 'thunderstorm with slight hail',
    99: 'thunderstorm with heavy hail'
  };
  return labels[code] || 'mixed weather';
}

function getTallinnDateTime(now = new Date()) {
  const localDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: TALLINN_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(now);

  const localTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: TALLINN_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);

  return { localDate, localTime };
}

async function fetchPoltsamaaWeather() {
  const { localDate, localTime } = getTallinnDateTime();
  const fallback = {
    location: POLTSAMAA.name,
    localDate,
    localTime,
    summary: 'weather update currently unavailable, but still gloriously dramatic'
  };

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${POLTSAMAA.latitude}&longitude=${POLTSAMAA.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=${encodeURIComponent(TALLINN_TIMEZONE)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);

    const data = await response.json();
    const current = data?.current;
    if (!current) throw new Error('Missing current weather payload');

    const temp = Math.round(Number(current.temperature_2m));
    const feelsLike = Math.round(Number(current.apparent_temperature));
    const wind = Math.round(Number(current.wind_speed_10m));
    const weatherCode = Number(current.weather_code);
    const label = getWeatherLabel(weatherCode);

    return {
      location: POLTSAMAA.name,
      localDate,
      localTime,
      summary: `${label}, ${temp}C (feels like ${feelsLike}C), wind ${wind} km/h`
    };
  } catch (err) {
    console.warn(`  ⚠️  Weather fetch failed: ${err.message}`);
    return fallback;
  }
}

function injectLiveNotice(script, liveNotice) {
  const lowerScript = script
    .map(line => String(line?.text || '').toLowerCase())
    .join(' ');

  // Avoid duplicate live notice if model already included it.
  if (lowerScript.includes('poltsamaa')) {
    return script;
  }

  const styleIndex = new Date().getUTCDay() % 3;
  let noticeLines;

  if (styleIndex === 0) {
    noticeLines = [
      {
        speaker: 'Joe',
        text: `Quick local check before we dive in: it's ${liveNotice.localDate}, about ${liveNotice.localTime}.`
      },
      {
        speaker: 'Jane',
        text: `Outside right now: ${liveNotice.summary}. Basically, dress for drama and keep your coffee close.`
      }
    ];
  } else if (styleIndex === 1) {
    noticeLines = [
      {
        speaker: 'Jane',
        text: `Calendar says ${liveNotice.localDate}, the clock says ${liveNotice.localTime}, and yes, we are very much on the air.`
      },
      {
        speaker: 'Joe',
        text: `Weather desk reports ${liveNotice.summary}. So if your plans involved optimism, maybe reschedule.`
      }
    ];
  } else {
    noticeLines = [
      {
        speaker: 'Joe',
        text: `Time stamp for the roast: ${liveNotice.localDate}, ${liveNotice.localTime}.`
      },
      {
        speaker: 'Jane',
        text: `And the weather outside: ${liveNotice.summary}. Good conditions for headlines, questionable conditions for hairstyles.`
      }
    ];
  }

  const insertAt = Math.min(3, script.length);
  return [
    ...script.slice(0, insertAt),
    ...noticeLines,
    ...script.slice(insertAt)
  ];
}

// ---------- Initialize Supabase ----------

function getSupabaseClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// ---------- Ensure Storage Bucket ----------

async function ensureAudioBucket(db) {
  try {
    const { data: buckets } = await db.storage.listBuckets();
    const exists = buckets?.some(b => b.name === AUDIO_BUCKET);
    if (!exists) {
      const { error } = await db.storage.createBucket(AUDIO_BUCKET, {
        public: true,
        allowedMimeTypes: ['audio/wav', 'audio/mpeg', 'audio/webm', 'audio/ogg'],
        fileSizeLimit: 50 * 1024 * 1024 // 50MB for audio
      });
      if (error) console.warn(`  ⚠️  Bucket creation: ${error.message}`);
      else console.log(`  📦 Created storage bucket: ${AUDIO_BUCKET}`);
    }
  } catch (err) {
    console.warn(`  ⚠️  Storage bucket check failed: ${err.message}`);
  }
}

// ---------- Step 1: Fetch Latest Articles Per Category ----------

async function fetchRecentBroadcastContext(db, hoursBack = 24) {
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await db
      .from('broadcasts')
      .select('id, title, created_at, article_ids, category_summary')
      .eq('published', true)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    const broadcasts = data || [];
    const usedArticleIds = new Set(
      broadcasts.flatMap(b => Array.isArray(b.article_ids) ? b.article_ids : [])
    );

    return { broadcasts, usedArticleIds };
  } catch (err) {
    console.warn(`  ⚠️  Could not load recent broadcast context: ${err.message}`);
    return { broadcasts: [], usedArticleIds: new Set() };
  }
}

function buildContinuityNotes(recentBroadcasts) {
  if (!recentBroadcasts || recentBroadcasts.length === 0) {
    return 'No earlier broadcast context available in the last 24 hours.';
  }

  return recentBroadcasts.slice(0, 5).map((b, idx) => {
    const when = new Date(b.created_at).toISOString().slice(11, 16);
    const topics = Object.values(b.category_summary || {}).slice(0, 3).join(' | ');
    return `${idx + 1}. [${when} UTC] ${b.title} :: ${topics}`;
  }).join('\n');
}

function getTallinnDateKey(dateInput = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TALLINN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(dateInput));
}

async function hasEditionAlreadyPublishedToday(db, editionLabel) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayKey = getTallinnDateKey();

  try {
    const { data, error } = await db
      .from('broadcasts')
      .select('id, title, created_at')
      .eq('published', true)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) throw error;

    const rows = data || [];
    const match = rows.find((row) => {
      const rowTallinnDate = getTallinnDateKey(row.created_at);
      return rowTallinnDate === todayKey && String(row.title || '').includes(`· ${editionLabel}`);
    });

    return match || null;
  } catch (err) {
    console.warn(`  ⚠️  Could not verify existing edition for dedupe: ${err.message}`);
    return null;
  }
}

async function deleteBroadcastById(db, id) {
  try {
    const { error } = await db.from('broadcasts').delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn(`  ⚠️  Could not delete existing edition ${id}: ${err.message}`);
    return false;
  }
}

async function fetchArticlesPerCategory(db, usedArticleIds = new Set()) {
  console.log('\n📰 Fetching latest article per category...\n');

  const articles = [];

  for (const category of CATEGORIES) {
    try {
      const { data, error } = await db
        .from('articles_with_category')
        .select('id, title, excerpt, category_slug, category_name, created_at')
        .eq('category_slug', category)
        .eq('published', true)
        .order('created_at', { ascending: false })
        .limit(6);

      if (error) throw error;

      if (data && data.length > 0) {
        const freshPick = data.find(a => !usedArticleIds.has(a.id));
        const selected = freshPick || data[0];
        articles.push(selected);
        if (freshPick) {
          console.log(`  ${CATEGORY_ICONS[category]} ${category}: "${selected.title}"`);
        } else {
          console.log(`  ${CATEGORY_ICONS[category]} ${category}: "${selected.title}" (repeat: no fresh item found)`);
        }
      } else {
        console.log(`  ${CATEGORY_ICONS[category]} ${category}: (no articles found)`);
      }
    } catch (err) {
      console.warn(`  ⚠️  Error fetching ${category}: ${err.message}`);
    }
  }

  console.log(`\n  ✅ Found ${articles.length}/${CATEGORIES.length} articles\n`);
  return articles;
}

const MIN_SCRIPT_LINES = 65;
const TARGET_SCRIPT_MIN_LINES = 70;
const TARGET_SCRIPT_MAX_LINES = 100;
const MIN_SCRIPT_LINES_HARD_FLOOR = 45;

function normalizeSpeakerName(rawSpeaker) {
  const normalized = String(rawSpeaker || '')
    .trim()
    .toLowerCase()
    .replace(/[:.]+$/g, '');

  if (normalized === 'jane' || normalized === 'host jane' || normalized === 'co-host jane') {
    return 'Jane';
  }
  if (normalized === 'joe' || normalized === 'host joe' || normalized === 'anchor joe') {
    return 'Joe';
  }
  return null;
}

function stripSpeakerPrefix(text) {
  return String(text || '').replace(/^\s*(joe|jane)\s*[:\-]\s*/i, '').trim();
}

function parseGeneratedScriptJson(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    throw new Error('Empty model output');
  }

  const candidates = [];
  candidates.push(text);

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  const unfenced = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  if (unfenced && unfenced !== text) {
    candidates.push(unfenced);
  }

  const sanitized = unfenced
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
  if (sanitized && !candidates.includes(sanitized)) {
    candidates.push(sanitized);
  }

  let lastErr = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('Could not parse model JSON output');
}

async function expandScriptToMinimum(script, edition, retries = 1) {
  const currentLines = Array.isArray(script) ? script.length : 0;
  if (currentLines >= MIN_SCRIPT_LINES) {
    return script;
  }

  const serialized = (script || [])
    .map(line => `${line.speaker}: ${line.text}`)
    .join('\n');

  const prompt = `You are revising a two-host comedy radio script.

Current script has ${currentLines} lines, but it must be at least ${MIN_SCRIPT_LINES} lines.
Expand it to 70-95 lines while preserving story order, clarity, and humor.

Rules:
- Keep only two speakers: Joe and Jane.
- Keep existing lines, but enrich with extra back-and-forth, stronger transitions, and sharper callbacks.
- Add substance before punchlines (what happened + why it matters) in each story segment.
- Do not add stage directions or narrator text.
- Return ONLY valid JSON in this exact format:
{
  "script": [
    {"speaker": "Joe", "text": "..."},
    {"speaker": "Jane", "text": "..."}
  ],
  "line_count": 78
}

SCRIPT TO EXPAND:
${serialized}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.85,
            topP: 0.95,
            maxOutputTokens: 16384,
            responseMimeType: 'application/json'
          }
        }),
        signal: AbortSignal.timeout(120000)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Expansion API error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const result = await response.json();
      const parts = result?.candidates?.[0]?.content?.parts || [];
      const textPart = parts.filter(p => p.text !== undefined && !p.thought).pop();
      const text = textPart?.text;
      if (!text) throw new Error('Expansion response was empty');

      const data = parseGeneratedScriptJson(text);
      if (!Array.isArray(data?.script)) {
        throw new Error('Expansion output missing script array');
      }

      const expanded = data.script.map((line, idx) => {
        const normalizedSpeaker = normalizeSpeakerName(line?.speaker);
        return {
          speaker: normalizedSpeaker || (idx % 2 === 0 ? 'Joe' : 'Jane'),
          text: stripSpeakerPrefix(line?.text)
        };
      }).filter(line => line.text.length > 0);

      if (expanded.length >= MIN_SCRIPT_LINES) {
        console.log(`  🔧 Expansion pass succeeded: ${expanded.length} lines`);
        return expanded;
      }

      if (attempt < retries) {
        console.warn(`  ⚠️  Expansion attempt ${attempt + 1} still short (${expanded.length} lines), retrying...`);
        await sleep(5000);
      }
    } catch (err) {
      if (attempt < retries) {
        console.warn(`  ⚠️  Expansion attempt ${attempt + 1} failed: ${err.message.slice(0, 120)}`);
        await sleep(5000);
      }
    }
  }

  return script;
}

// ---------- Step 2: Generate Comedy Script ----------

async function generateScript(articles, liveNotice, continuityNotes, edition, retries = 2) {
  console.log('🎙️  Generating comedy radio script...\n');

  const articleSummaries = articles.map(a =>
    `- [${CATEGORY_ICONS[a.category_slug]} ${a.category_name}] "${a.title}" — ${a.excerpt}`
  ).join('\n');

  const prompt = `You are the head writer for "The Daily Roast Radio" — a sharp, story-first comedy news podcast hosted by two anchors:

**Joe** — The dry, sarcastic anchor. Deadpan delivery, world-weary cynicism, loves a good pun. Think a mix of Jon Stewart's wit and Ron Burgundy's unearned confidence.
**Jane** — The energetic, sharp co-host. Quick-witted, slightly chaotic energy, prone to tangential jokes. She's the one who makes Joe break character.

TODAY'S STORIES TO COVER (one from each category):
${articleSummaries}

EARLIER BROADCAST CONTEXT (last 24h):
${continuityNotes}

CURRENT EDITION:
- ${edition.label} (${edition.nominalTime} Tallinn time)
- Tone guide: ${edition.styleCue}
- End signoff instruction: ${getNextEditionTease(edition.key)}

WRITE A COMPLETE RADIO SHOW SCRIPT covering ALL ${articles.length} stories. The show should:

1. **COLD OPEN** — Joe or Jane with a quick one-liner hook that pulls listeners in
2. **INTRO** — Brief banter between Joe and Jane (who we are, what day it is)
3. **STORY SEGMENTS** — For each of the ${articles.length} stories:
   - Quick transition/jingle reference (e.g., "Moving on to..." or "And now, from the world of...")
  - Host reads the headline, then both react and riff on it
  - Include a concise "what happened" recap and a clear "why this matters" angle before the biggest joke run
  - 6-10 lines of dialogue per story with genuine comedy
   - Include at least one fictional "expert quote" or "listener call-in" per story
4. **WRAP-UP** — Final banter, use the edition-specific signoff instruction above

LENGTH BUDGET (MANDATORY):
- Cold open: 4-6 lines
- Intro: 8-10 lines
- Each story segment: 8-10 lines
- Wrap-up: 6-8 lines
- Total: ${TARGET_SCRIPT_MIN_LINES}-${TARGET_SCRIPT_MAX_LINES} lines
- If first draft is shorter than ${TARGET_SCRIPT_MIN_LINES}, continue adding lines until it reaches at least ${TARGET_SCRIPT_MIN_LINES}.

CONTENT QUALITY RULES (VERY IMPORTANT):
- Be specific to each provided story; avoid generic commentary that could fit any headline.
- Every story segment must contain at least 2 concrete details from the headline/excerpt context (names, places, numbers, policy/action, timeline, consequence).
- Treat each segment like mini-editorial satire: first clarity, then absurdity.
- Use one perspective shift per story (citizen angle, business angle, policy angle, culture angle, or global angle).
- Vary pacing: quick jab -> analysis beat -> callback -> stronger punchline.

COMEDY STYLE:
- Deadpan absurdity (treat insane things as normal)
- Quick back-and-forth banter (not monologues)
- Specific, vivid jokes (not generic "isn't that crazy")
- Pop culture references and callbacks
- Running jokes that recur through the show
- Each line should be ~1-3 sentences (natural speech pacing)
- Keep hosts distinct: Joe = dry and surgical; Jane = energetic and surprising.
- Prefer clever comparisons/metaphors over random nonsense.

HOST AUTHENTICITY MODE (MANDATORY):
- Joe and Jane must sound like real radio personalities talking to humans, not AI assistants explaining themselves.
- Do not over-explain the writing process, model behavior, or generation mechanics.
- If referencing AI at all, keep it subtle and playful: maximum 1-2 short meta mentions across the entire show.
- Never let AI/meta jokes dominate a segment; story satire always comes first.
- Prioritize conversational chemistry, imperfect human rhythm, and believable reactions.

HUMOR GUARDRAILS:
- No repeated punchline structure across segments.
- No lazy filler lines like "wow that's wild" without adding substance.
- Keep satire punchy but coherent; listener should always understand the underlying story.
- Avoid punching down at vulnerable groups; target power, systems, hypocrisy, and public absurdity.

IMPORTANT:
- Do NOT include date/time/weather bulletin lines. They are inserted automatically after generation.
- If a headline was already covered earlier today, treat it as a follow-up with a clearly new angle.
- Avoid reusing the same punchline or setup from earlier broadcasts listed in context.
- Output only spoken script lines (no stage directions, no SFX markers, no narrator labels).
- Avoid robotic wording like "as an AI" or "as a language model".

Also choose a background music theme from: upbeat, chill, funky, dramatic

Return ONLY valid JSON:
{
  "script": [
    {"speaker": "Joe", "text": "..."},
    {"speaker": "Jane", "text": "..."}
  ],
  "bgmTheme": "upbeat",
  "line_count": 78
}

The script should have ${TARGET_SCRIPT_MIN_LINES}-${TARGET_SCRIPT_MAX_LINES} lines total (~15 minutes of audio).
Target ratio: ~65% meaningful story substance, ~35% humor and punchlines.
Every line must either add information, escalate a joke, or move the segment forward. No filler, no dead air.`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.85,
            topP: 0.95,
            maxOutputTokens: 16384,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 4096 }
          }
        }),
        signal: AbortSignal.timeout(120000)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const result = await response.json();
      const parts = result?.candidates?.[0]?.content?.parts || [];
      const textPart = parts.filter(p => p.text !== undefined && !p.thought).pop();
      const text = textPart?.text;

      if (!text) throw new Error('Empty response from Gemini');

      const data = parseGeneratedScriptJson(text);

      if (!data.script || !Array.isArray(data.script)) {
        throw new Error('Model output missing script array');
      }

      // Normalize speaker names robustly to avoid collapsing both voices to one speaker.
      data.script = data.script.map((line, idx) => {
        const normalizedSpeaker = normalizeSpeakerName(line?.speaker);
        return {
          speaker: normalizedSpeaker || (idx % 2 === 0 ? 'Joe' : 'Jane'),
          text: stripSpeakerPrefix(line?.text)
        };
      }).filter(line => line.text.length > 0);

      data.script = injectLiveNotice(data.script, liveNotice);

      const declaredLineCount = Number(data.line_count);
      if (Number.isFinite(declaredLineCount) && Math.abs(declaredLineCount - data.script.length) > 5) {
        console.warn(`  ⚠️  Declared line_count (${declaredLineCount}) differs from normalized lines (${data.script.length}).`);
      }

      if (data.script.length < MIN_SCRIPT_LINES) {
        console.warn(`  ⚠️  Script below target (${data.script.length}/${MIN_SCRIPT_LINES}). Running expansion pass...`);
        data.script = await expandScriptToMinimum(data.script, edition);
      }

      if (data.script.length < MIN_SCRIPT_LINES_HARD_FLOOR) {
        throw new Error(`Script too short after expansion: ${data.script.length} lines (hard floor ${MIN_SCRIPT_LINES_HARD_FLOOR})`);
      }

      if (data.script.length < MIN_SCRIPT_LINES) {
        console.warn(`  ⚠️  Script below target after expansion (${data.script.length}/${MIN_SCRIPT_LINES}), continuing with fallback length.`);
      }

      const speakerSet = new Set(data.script.map(line => line.speaker));
      if (!speakerSet.has('Joe') || !speakerSet.has('Jane')) {
        throw new Error('Script normalization lost one speaker voice (Joe/Jane). Retrying generation.');
      }

      console.log(`  ✅ Script generated: ${data.script.length} lines`);
      console.log(`  🎵 BGM theme: ${data.bgmTheme || 'upbeat'}`);
      return data;

    } catch (err) {
      if (attempt < retries) {
        console.warn(`  ⚠️  Script attempt ${attempt + 1} failed: ${err.message.slice(0, 120)}`);
        console.warn(`  ⏳ Waiting 10s before retry...`);
        await sleep(10000);
      } else {
        console.error(`  ❌ Script generation failed after ${retries + 1} attempts: ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

// ---------- Step 3: Generate TTS Audio ----------

async function generateAudio(script, retries = 2) {
  console.log('\n🔊 Generating TTS audio...\n');

  const ttsPrompt = `TTS the following conversation between Joe and Jane:\n` +
    script.map(line => `${line.speaker}: ${line.text}`).join('\n');

  const wordCount = script
    .map(line => String(line.text || ''))
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;

  // 2.7 words/sec is a conservative long-form speech pace.
  const expectedSeconds = Math.max(60, Math.round(wordCount / 2.7));
  const suspiciousMinSeconds = Math.max(120, Math.floor(expectedSeconds * 0.55));

  function parsePcmAudioBase64(response) {
    return response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  }

  async function generateChunkAudio(chunkLines) {
    const chunkPrompt = `TTS the following conversation between Joe and Jane:\n` +
      chunkLines.map(line => `${line.speaker}: ${line.text}`).join('\n');

    const response = await genai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text: chunkPrompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              {
                speaker: 'Joe',
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
              },
              {
                speaker: 'Jane',
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
              }
            ]
          }
        }
      }
    });

    const audioBase64 = parsePcmAudioBase64(response);
    if (!audioBase64 || audioBase64.length < 100) {
      throw new Error('Chunk TTS returned invalid audio data');
    }
    return pcmToWavBuffer(audioBase64, 24000);
  }

  async function generateAudioChunked() {
    const maxLinesPerChunk = 16;
    const chunks = [];
    for (let i = 0; i < script.length; i += maxLinesPerChunk) {
      chunks.push(script.slice(i, i + maxLinesPerChunk));
    }

    const wavChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`  🔁 Chunked TTS ${i + 1}/${chunks.length}...`);
      const chunkWav = await generateChunkAudio(chunks[i]);
      wavChunks.push(chunkWav);
      await sleep(1200);
    }

    const mergedWav = mergeWavBuffers(wavChunks, 24000);
    const durationSeconds = Math.round(mergedWav.length / (24000 * 2));
    return { wavBuffer: mergedWav, durationSeconds, chunked: true };
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await genai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text: ttsPrompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                {
                  speaker: 'Joe',
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
                },
                {
                  speaker: 'Jane',
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
                }
              ]
            }
          }
        }
      });

      const audioBase64 = parsePcmAudioBase64(response);

      if (!audioBase64 || audioBase64.length < 100) {
        throw new Error('Invalid or empty audio data from TTS');
      }

      // Convert PCM to WAV
      const wavBuffer = pcmToWavBuffer(audioBase64, 24000);
      const durationSeconds = Math.round(wavBuffer.length / (24000 * 2)); // 16-bit mono

      if (durationSeconds < suspiciousMinSeconds) {
        console.warn(`  ⚠️  Full-pass TTS likely truncated (${durationSeconds}s, expected around ${expectedSeconds}s). Switching to chunked TTS...`);
        const chunked = await generateAudioChunked();
        console.log(`  ✅ Audio generated (chunked): ~${Math.round(chunked.durationSeconds / 60)} minutes`);
        return { wavBuffer: chunked.wavBuffer, durationSeconds: chunked.durationSeconds };
      }

      console.log(`  ✅ Audio generated: ~${Math.round(durationSeconds / 60)} minutes`);
      return { wavBuffer, durationSeconds };

    } catch (err) {
      if (attempt < retries) {
        console.warn(`  ⚠️  TTS attempt ${attempt + 1} failed: ${err.message.slice(0, 120)}`);
        console.warn(`  ⏳ Waiting 15s before retry...`);
        await sleep(15000);
      } else {
        console.error(`  ❌ TTS generation failed after ${retries + 1} attempts: ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

// PCM base64 → WAV Buffer (server-side with Node.js Buffer)
function pcmToWavBuffer(pcmBase64, sampleRate) {
  const pcmData = Buffer.from(pcmBase64, 'base64');

  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const chunkSize = 36 + dataSize;

  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(chunkSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);     // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

function mergeWavBuffers(wavBuffers, sampleRate) {
  const valid = (wavBuffers || []).filter(Boolean);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  const pcmParts = valid.map((wav) => Buffer.from(wav).slice(44));
  const mergedPcm = Buffer.concat(pcmParts);

  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = mergedPcm.length;
  const chunkSize = 36 + dataSize;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(chunkSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, mergedPcm]);
}

// ---------- Step 4: Generate Cover Image ----------

async function generateCoverImage(articles, retries = 2) {
  console.log('\n🎨 Generating broadcast cover image...\n');

  const topics = articles.slice(0, 4).map(a => a.title).join(', ');
  const imagePrompt = `Create a vibrant, professional radio show cover art for "The Daily Roast Radio". 
Style: Modern, dark background with orange/red accent colors, radio/broadcast aesthetic.
Include visual elements suggesting: a professional radio studio, microphone, sound waves.
The image should feel energetic and comedic, like a late-night comedy show poster.
Topics discussed today: ${topics}
Aspect ratio: 16:9 landscape. High contrast, bold typography style.`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await genai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [{ text: imagePrompt }],
        config: { responseModalities: ['IMAGE', 'TEXT'] }
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const mimeType = part.inlineData.mimeType || 'image/png';
          const ext = mimeType.includes('jpeg') ? 'jpg' : 'png';
          console.log(`  ✅ Cover image generated`);
          return { base64Data: part.inlineData.data, mimeType, ext };
        }
      }
      throw new Error('No image data in response');
    } catch (err) {
      if (attempt < retries) {
        console.warn(`  ⚠️  Image attempt ${attempt + 1} failed: ${err.message.slice(0, 120)}`);
        await sleep(10000);
      } else {
        console.error(`  ❌ Cover image generation failed: ${err.message}`);
        return null;
      }
    }
  }
  return null;
}

// ---------- Step 5: Upload to Supabase Storage ----------

async function uploadAudio(db, wavBuffer) {
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `broadcast-${date}-${Date.now()}.wav`;
  const filePath = `${new Date().toISOString().slice(0, 7)}/${fileName}`;

  try {
    const { data, error } = await db.storage
      .from(AUDIO_BUCKET)
      .upload(filePath, wavBuffer, {
        contentType: 'audio/wav',
        cacheControl: '31536000',
        upsert: false
      });

    if (error) throw error;

    const { data: urlData } = db.storage
      .from(AUDIO_BUCKET)
      .getPublicUrl(filePath);

    console.log(`  📤 Audio uploaded: ${urlData?.publicUrl}`);
    return urlData?.publicUrl;
  } catch (err) {
    console.warn(`  ⚠️  Audio upload failed: ${err.message}`);
    return null;
  }
}

async function uploadCoverImage(db, imageData) {
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `broadcast-cover-${date}-${Date.now()}.${imageData.ext}`;
  const filePath = `${new Date().toISOString().slice(0, 7)}/${fileName}`;

  try {
    const buffer = Buffer.from(imageData.base64Data, 'base64');

    const { data, error } = await db.storage
      .from(IMAGE_BUCKET)
      .upload(filePath, buffer, {
        contentType: imageData.mimeType,
        cacheControl: '31536000',
        upsert: false
      });

    if (error) throw error;

    const { data: urlData } = db.storage
      .from(IMAGE_BUCKET)
      .getPublicUrl(filePath);

    console.log(`  📤 Cover image uploaded: ${urlData?.publicUrl}`);
    return urlData?.publicUrl;
  } catch (err) {
    console.warn(`  ⚠️  Cover image upload failed: ${err.message}`);
    return null;
  }
}

// ---------- Step 6: Save Broadcast to Database ----------

async function saveBroadcast(db, { title, script, audioUrl, coverImageUrl, bgmTheme, articles, durationSeconds }) {
  try {
    const categorySummary = {};
    articles.forEach(a => {
      categorySummary[a.category_slug] = a.title;
    });

    const { data, error } = await db
      .from('broadcasts')
      .insert({
        title,
        script,
        audio_url: audioUrl,
        cover_image_url: coverImageUrl,
        bgm_theme: bgmTheme,
        article_ids: articles.map(a => a.id),
        category_summary: categorySummary,
        duration_seconds: durationSeconds,
        published: true
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`  💾 Broadcast saved: ${data.id}`);
    return data;
  } catch (err) {
    console.error(`  ❌ Failed to save broadcast: ${err.message}`);
    return null;
  }
}

// ============================================
// MAIN PIPELINE
// ============================================

async function main() {
  console.log('');
  console.log('📻📻📻📻📻📻📻📻📻📻📻📻📻📻📻📻📻📻📻📻');
  console.log('  THE DAILY ROAST RADIO — Broadcast Generator');
  console.log('📻📻📻📻📻📻📻📻📻📻📻📻📻📻📻📻📻📻📻📻');
  console.log(`\n📅 ${new Date().toISOString()}\n`);

  if (ENFORCE_TALLINN_SLOT_TIME && !BROADCAST_SLOT && !shouldRunScheduledBroadcast()) {
    const tallinnNow = getTallinnNow();
    const hh = String(tallinnNow.getHours()).padStart(2, '0');
    const mm = String(tallinnNow.getMinutes()).padStart(2, '0');
    console.log(`⏭️  Skipping run at ${hh}:${mm} Tallinn time (target hours: 09, 15, 21).`);
    process.exit(0);
  }

  const db = getSupabaseClient();
  const edition = getBroadcastEditionContext();

  const existingEdition = await hasEditionAlreadyPublishedToday(db, edition.label);
  if (existingEdition) {
    if (FORCE_REPLACE_EDITION) {
      const alreadyAt = new Date(existingEdition.created_at).toISOString();
      console.log(`♻️  Replacing existing ${edition.label} from ${alreadyAt} (id: ${existingEdition.id})`);
      const deleted = await deleteBroadcastById(db, existingEdition.id);
      if (!deleted) {
        console.log('⏭️  Replacement requested but existing edition could not be removed. Skipping to avoid duplicates.');
        process.exit(0);
      }
      console.log('✅ Existing edition removed, generating replacement...');
    } else {
      const alreadyAt = new Date(existingEdition.created_at).toISOString();
      console.log(`⏭️  ${edition.label} already published for Tallinn today (${alreadyAt}, id: ${existingEdition.id}). Skipping duplicate run.`);
      process.exit(0);
    }
  }

  // Step 0: Ensure audio storage bucket exists
  await ensureAudioBucket(db);

  // Step 1: Fetch 1 article per category
  const recentContext = await fetchRecentBroadcastContext(db, 24);
  const continuityNotes = buildContinuityNotes(recentContext.broadcasts);
  const articles = await fetchArticlesPerCategory(db, recentContext.usedArticleIds);

  if (articles.length < 3) {
    console.error(`❌ Not enough articles (${articles.length}). Need at least 3 categories. Exiting.`);
    process.exit(1);
  }

  // Step 2: Generate comedy script
  console.log(`\n${'─'.repeat(60)}`);
  const liveNotice = await fetchPoltsamaaWeather();
  console.log(`🌦️  Live notice: ${liveNotice.localDate}, ${liveNotice.localTime} (${TALLINN_TIMEZONE}) — ${liveNotice.summary}`);
  console.log(`🕒 Edition: ${edition.label} (${edition.nominalTime} Tallinn)`);
  const scriptData = await generateScript(articles, liveNotice, continuityNotes, edition);

  if (!scriptData) {
    console.error('❌ Script generation failed. Exiting.');
    process.exit(1);
  }

  // Step 3: Generate TTS audio
  console.log(`${'─'.repeat(60)}`);
  await sleep(5000); // cooldown

  const audioResult = await generateAudio(scriptData.script);

  let audioUrl = null;
  let finalBgmTheme = normalizeBgmTheme(scriptData.bgmTheme);
  let selectedBgmTrack = null;
  if (audioResult) {
    let finalAudioBuffer = audioResult.wavBuffer;

    try {
      const mixed = await mixBackgroundMusic(audioResult.wavBuffer, scriptData.bgmTheme);
      finalAudioBuffer = mixed.wavBuffer;
      finalBgmTheme = mixed.bgmTheme;
      selectedBgmTrack = mixed.bgmTrack;
      if (mixed.mixed) {
        console.log(`  🎚️  BGM mixed at ${Math.round(BGM_VOLUME * 100)}% volume`);
      }
    } catch (mixErr) {
      console.warn(`  ⚠️  BGM mix failed, using voice-only audio: ${mixErr.message}`);
    }

    // Upload audio
    console.log('\n📤 Uploading audio to Supabase Storage...');
    audioUrl = await uploadAudio(db, finalAudioBuffer);
  } else {
    console.warn('⚠️  Audio generation failed — broadcast will have script only');
  }

  // Step 4: Generate cover image
  console.log(`${'─'.repeat(60)}`);
  await sleep(5000);

  const imageData = await generateCoverImage(articles);
  let coverImageUrl = null;
  if (imageData) {
    coverImageUrl = await uploadCoverImage(db, imageData);
  }

  // Step 5: Save broadcast
  console.log(`\n${'─'.repeat(60)}`);
  console.log('💾 Saving broadcast to database...\n');

  const today = new Intl.DateTimeFormat('en-US', {
    timeZone: TALLINN_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
  const title = `The Daily Roast Radio — ${today.format(new Date())} · ${edition.label}`;

  const broadcast = await saveBroadcast(db, {
    title,
    script: scriptData.script,
    audioUrl,
    coverImageUrl,
    bgmTheme: finalBgmTheme,
    articles,
    durationSeconds: audioResult?.durationSeconds || 0
  });

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 BROADCAST SUMMARY');
  console.log('='.repeat(50));
  console.log(`  📻 Title: ${title}`);
  console.log(`  📝 Script: ${scriptData.script.length} lines`);
  console.log(`  🔊 Audio: ${audioUrl ? '✅' : '❌ (script only)'}`);
  console.log(`  🎨 Cover: ${coverImageUrl ? '✅' : '❌ (no cover)'}`);
  console.log(`  🎵 BGM theme: ${finalBgmTheme}`);
  console.log(`  🎼 BGM track: ${selectedBgmTrack || 'none configured (voice-only)'}`);
  console.log(`  📰 Articles: ${articles.length} categories`);
  console.log(`  ⏱️  Duration: ~${Math.round((audioResult?.durationSeconds || 0) / 60)} min`);
  console.log(`  💾 Saved: ${broadcast ? '✅' : '❌'}`);
  console.log('='.repeat(50));
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
