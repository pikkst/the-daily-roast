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
const BROADCAST_FORMAT = (process.env.BROADCAST_FORMAT || 'daily').trim().toLowerCase();
const SUNDAY_DEEP_DIVE = process.env.SUNDAY_DEEP_DIVE === '1';
const ENABLE_EXTERNAL_RESEARCH = (() => {
  const raw = String(process.env.ENABLE_EXTERNAL_RESEARCH || '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  // Default: save API calls on routine runs; enable automatically for Sunday deep-dive episodes.
  return BROADCAST_FORMAT === 'sunday_special' && SUNDAY_DEEP_DIVE;
})();
const SKIP_COVER_IMAGE = process.env.SKIP_COVER_IMAGE === '1';
const REUSE_RECENT_COVER = process.env.REUSE_RECENT_COVER === '1';
const ENFORCE_TALLINN_SLOT_TIME = process.env.ENFORCE_TALLINN_SLOT_TIME === '1';
const FORCE_REPLACE_EDITION = process.env.FORCE_REPLACE_EDITION === '1';
const parsedBgmVolume = Number(process.env.BGM_VOLUME || '0.02');
const BGM_VOLUME = Number.isFinite(parsedBgmVolume)
  ? Math.min(1, Math.max(0, parsedBgmVolume))
  : 0.02;
const BGM_THEMES = ['upbeat', 'chill', 'funky', 'dramatic'];
const DEFAULT_BGM_TRACK = 'sounds/litesaturation-short-rock-488463.mp3';
const DEFAULT_BGM_TRACKS = {
  upbeat: [DEFAULT_BGM_TRACK],
  chill: [DEFAULT_BGM_TRACK],
  funky: [DEFAULT_BGM_TRACK],
  dramatic: [DEFAULT_BGM_TRACK]
};

function normalizeMultilineEnv(value, fallback) {
  const normalized = String(value || '')
    .replace(/\\n/g, '\n')
    .trim();
  return normalized || fallback;
}

const DEFAULT_PLATFORM_PROMO_BRIEF = 'Promote The Daily Roast platform in one short mid-show station break. Mention daily parody radio, fresh satire stories, and weekly top list. Keep it witty, natural, and under 2 lines of dialogue total.';
const DEFAULT_HOST_BIO_JOE = 'Joe is 39, former late-night news producer turned radio anchor. Dry, composed, skeptical, and precise. Loves understated punchlines, policy absurdities, and callback humor.';
const DEFAULT_HOST_BIO_JANE = 'Jane is 34, ex-culture reporter and improv comic. Fast, playful, and bold with tangents. She pushes momentum, throws surprising metaphors, and can make Joe crack.';
const DEFAULT_HOST_SHARED_HISTORY = 'Joe and Jane have hosted this satire format together for years. They trust each other, tease each other without cruelty, and reference past bits like old colleagues, newsroom chaos, and recurring fictional experts.';
const DEFAULT_HOST_MEMORY_BANK = 'Recurring memories: the 2019 coffee-machine meltdown before airtime; the fake economist caller "Dr. Vello Margin"; Joe losing a bet about parliamentary drama timing; Jane comparing every tech launch to a chaotic school play.';
const DEFAULT_TANGENT_STYLE_GUIDE = 'Allow short natural tangents that feel human: quick detours into personal memory, newsroom history, or historical analogy, then return smoothly to the story.';

const PLATFORM_PROMO_BRIEF = normalizeMultilineEnv(process.env.PLATFORM_PROMO_BRIEF, DEFAULT_PLATFORM_PROMO_BRIEF);
const PROMO_MODE = String(process.env.PROMO_MODE || 'platform').trim().toLowerCase();
const PROMO_PARTNER_CHALLENGE = normalizeMultilineEnv(
  process.env.PROMO_PARTNER_CHALLENGE,
  'Partner challenge of the day: listeners complete a playful challenge and use code ROAST for tracking.'
);
const HOST_BIO_JOE = normalizeMultilineEnv(process.env.HOST_BIO_JOE, DEFAULT_HOST_BIO_JOE);
const HOST_BIO_JANE = normalizeMultilineEnv(process.env.HOST_BIO_JANE, DEFAULT_HOST_BIO_JANE);
const HOST_SHARED_HISTORY = normalizeMultilineEnv(process.env.HOST_SHARED_HISTORY, DEFAULT_HOST_SHARED_HISTORY);
const HOST_MEMORY_BANK = normalizeMultilineEnv(process.env.HOST_MEMORY_BANK, DEFAULT_HOST_MEMORY_BANK);
const TANGENT_STYLE_GUIDE = normalizeMultilineEnv(process.env.TANGENT_STYLE_GUIDE, DEFAULT_TANGENT_STYLE_GUIDE);
const parsedTargetTangents = Number(process.env.TARGET_TANGENTS_PER_EPISODE || '3');
const TARGET_TANGENTS_PER_EPISODE = Number.isFinite(parsedTargetTangents)
  ? Math.max(1, Math.min(6, Math.floor(parsedTargetTangents)))
  : 3;
const parsedMemoryLookbackDays = Number(process.env.MEMORY_LOOKBACK_DAYS || '14');
const MEMORY_LOOKBACK_DAYS = Number.isFinite(parsedMemoryLookbackDays)
  ? Math.max(3, Math.min(30, Math.floor(parsedMemoryLookbackDays)))
  : 14;
const parsedMemoryMaxLinks = Number(process.env.MEMORY_MAX_LINKS || '8');
const MEMORY_MAX_LINKS = Number.isFinite(parsedMemoryMaxLinks)
  ? Math.max(3, Math.min(20, Math.floor(parsedMemoryMaxLinks)))
  : 8;
const parsedExternalResearchItems = Number(process.env.EXTERNAL_RESEARCH_MAX_ITEMS || '3');
const EXTERNAL_RESEARCH_MAX_ITEMS = Number.isFinite(parsedExternalResearchItems)
  ? Math.max(1, Math.min(6, Math.floor(parsedExternalResearchItems)))
  : 3;
const ENABLE_LISTENER_PUNCHLINES = process.env.ENABLE_LISTENER_PUNCHLINES !== '0';
const PODBEAN_CLIENT_ID = String(process.env.PODBEAN_CLIENT_ID || '').trim();
const PODBEAN_CLIENT_SECRET = String(process.env.PODBEAN_CLIENT_SECRET || '').trim();
const ENABLE_PODBEAN = process.env.ENABLE_PODBEAN === '1' && !!PODBEAN_CLIENT_ID && !!PODBEAN_CLIENT_SECRET;
const parsedPunchlineLookbackHours = Number(process.env.LISTENER_PUNCHLINE_LOOKBACK_HOURS || '72');
const LISTENER_PUNCHLINE_LOOKBACK_HOURS = Number.isFinite(parsedPunchlineLookbackHours)
  ? Math.max(12, Math.min(336, Math.floor(parsedPunchlineLookbackHours)))
  : 72;
const parsedPunchlineMaxItems = Number(process.env.LISTENER_PUNCHLINE_MAX_ITEMS || '5');
const LISTENER_PUNCHLINE_MAX_ITEMS = Number.isFinite(parsedPunchlineMaxItems)
  ? Math.max(1, Math.min(12, Math.floor(parsedPunchlineMaxItems)))
  : 5;
const parsedScriptMinLines = Number(process.env.SCRIPT_MIN_LINES || '70');
const SCRIPT_TARGET_MIN_LINES = Number.isFinite(parsedScriptMinLines)
  ? Math.max(35, Math.min(160, Math.floor(parsedScriptMinLines)))
  : 70;
const parsedScriptMaxLines = Number(process.env.SCRIPT_MAX_LINES || '100');
const SCRIPT_TARGET_MAX_LINES = Number.isFinite(parsedScriptMaxLines)
  ? Math.max(SCRIPT_TARGET_MIN_LINES + 5, Math.min(220, Math.floor(parsedScriptMaxLines)))
  : 100;
const SCRIPT_MIN_HARD_FLOOR = Math.max(25, SCRIPT_TARGET_MIN_LINES - 20);
const MIN_SCRIPT_LINES = Math.max(30, SCRIPT_TARGET_MIN_LINES - 5);
const PROMO_BUMPER_TRACK = String(process.env.PROMO_BUMPER_TRACK || '').trim();
const PROMO_BUMPER_TRACK_MORNING = String(process.env.PROMO_BUMPER_TRACK_MORNING || '').trim();
const PROMO_BUMPER_TRACK_AFTERNOON = String(process.env.PROMO_BUMPER_TRACK_AFTERNOON || '').trim();
const PROMO_BUMPER_TRACK_EVENING = String(process.env.PROMO_BUMPER_TRACK_EVENING || '').trim();
const parsedPromoBumperSeconds = Number(process.env.PROMO_BUMPER_SECONDS || '1.2');
const PROMO_BUMPER_SECONDS = Number.isFinite(parsedPromoBumperSeconds)
  ? Math.max(0.4, Math.min(4, parsedPromoBumperSeconds))
  : 1.2;
const parsedPromoPauseSeconds = Number(process.env.PROMO_PAUSE_SECONDS || '0.7');
const PROMO_PAUSE_SECONDS = Number.isFinite(parsedPromoPauseSeconds)
  ? Math.max(0.2, Math.min(2.5, parsedPromoPauseSeconds))
  : 0.7;

// ---------- Podbean API Integration ----------
async function podbeanGetToken() {
  const credentials = Buffer.from(`${PODBEAN_CLIENT_ID}:${PODBEAN_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.podbean.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) throw new Error(`Podbean token: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function podbeanAuthorizeUpload(token, filename, filesize, contentType) {
  const params = new URLSearchParams({ access_token: token, filename, filesize: String(filesize), content_type: contentType });
  const res = await fetch(`https://api.podbean.com/v1/medias/podfile?${params}`);
  if (!res.ok) throw new Error(`Podbean upload auth: ${res.status} ${await res.text()}`);
  return await res.json(); // { presigned_url, file_key }
}

async function podbeanPutFile(presignedUrl, buffer, contentType) {
  const res = await fetch(presignedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: buffer
  });
  if (!res.ok) throw new Error(`Podbean S3 PUT: ${res.status}`);
}

async function uploadBroadcastToPodbean(audioBuffer, { title, script, coverImageUrl }) {
  if (!ENABLE_PODBEAN) return null;
  try {
    console.log('\n🎙️  Uploading to Podbean...');
    const token = await podbeanGetToken();

    // Upload audio
    const audioFilename = `${Date.now()}-broadcast.wav`;
    const { presigned_url: audioPresigned, file_key: mediaKey } = await podbeanAuthorizeUpload(
      token, audioFilename, audioBuffer.length, 'audio/wav'
    );
    await podbeanPutFile(audioPresigned, audioBuffer, 'audio/wav');
    console.log(`  ✅ Audio uploaded (${Math.round(audioBuffer.length / 1024)}KB)`);

    // Upload cover image
    let logoKey = null;
    if (coverImageUrl) {
      try {
        const imgRes = await fetch(coverImageUrl);
        if (imgRes.ok) {
          const imgBuf = Buffer.from(await imgRes.arrayBuffer());
          const { presigned_url: imgPresigned, file_key: imgKey } = await podbeanAuthorizeUpload(
            token, `${Date.now()}-cover.jpg`, imgBuf.length, 'image/jpeg'
          );
          await podbeanPutFile(imgPresigned, imgBuf, 'image/jpeg');
          logoKey = imgKey;
          console.log('  🖼️  Cover uploaded');
        }
      } catch (imgErr) {
        console.warn(`  ⚠️  Cover upload skipped: ${imgErr.message}`);
      }
    }

    // Create episode
    const description = script
      ? script.substring(0, 1000).replace(/\n/g, ' ') + '…'
      : 'Daily Roast satirical news broadcast.';
    const epParams = new URLSearchParams({
      access_token: token,
      title,
      content: description,
      status: 'publish',
      type: 'public',
      media_key: mediaKey,
      ...(logoKey ? { logo_key: logoKey } : {})
    });
    const epRes = await fetch('https://api.podbean.com/v1/episodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: epParams.toString()
    });
    if (!epRes.ok) throw new Error(`Podbean create episode: ${epRes.status} ${await epRes.text()}`);
    const epData = await epRes.json();
    console.log(`  📻 Published on Podbean: ${epData.episode?.permalink_url || '(ok)'}`);
    return epData;
  } catch (err) {
    console.warn(`  ⚠️  Podbean upload failed (non-fatal): ${err.message}`);
    return null;
  }
}

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
  if (rawJson) {
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
  }

  for (const theme of BGM_THEMES) {
    if (!Array.isArray(catalog[theme]) || catalog[theme].length === 0) {
      catalog[theme] = [...(DEFAULT_BGM_TRACKS[theme] || [])];
    }
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
  // Intensive day mode: flash-1, flash-2, ... flash-N
  if (BROADCAST_SLOT && BROADCAST_SLOT.startsWith('flash-')) {
    const num = BROADCAST_SLOT.replace('flash-', '');
    const tallinnNow = getTallinnNow(now);
    const hh = String(tallinnNow.getHours()).padStart(2, '0');
    const mm = String(tallinnNow.getMinutes()).padStart(2, '0');
    return {
      key: BROADCAST_SLOT,
      label: `Flash Edition #${num}`,
      nominalTime: `${hh}:${mm}`,
      styleCue: 'urgent breaking-news flash bulletin — fast, punchy, no padding'
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

function extractKeywords(text) {
  const stopwords = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'was', 'were',
    'will', 'into', 'about', 'after', 'before', 'over', 'under', 'than', 'then', 'also',
    'they', 'their', 'them', 'your', 'you', 'our', 'out', 'off', 'new', 'all', 'not',
    'are', 'but', 'his', 'her', 'its', 'who', 'what', 'when', 'where', 'why', 'how'
  ]);

  return Array.from(
    new Set(
      String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .map(t => t.trim())
        .filter(Boolean)
        .filter(t => t.length >= 4)
        .filter(t => !stopwords.has(t))
    )
  );
}

function dateKeyShort(dateInput) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return 'unknown-date';
  return d.toISOString().slice(0, 10);
}

function scoreKeywordOverlap(currentKeywords, pastKeywords) {
  if (!currentKeywords?.length || !pastKeywords?.length) return 0;

  const current = new Set(currentKeywords);
  const past = new Set(pastKeywords);

  let shared = 0;
  for (const token of current) {
    if (past.has(token)) shared += 1;
  }

  if (shared === 0) return 0;
  const union = new Set([...current, ...past]).size;
  return shared / Math.max(1, union);
}

async function fetchTopicalMemoryLinks(db, currentArticles, daysBack = MEMORY_LOOKBACK_DAYS, maxLinks = MEMORY_MAX_LINKS) {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await db
      .from('broadcasts')
      .select('id, title, created_at, category_summary')
      .eq('published', true)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    const rows = data || [];
    const candidates = [];

    for (const row of rows) {
      const summary = row.category_summary || {};
      for (const [category, topicTitle] of Object.entries(summary)) {
        if (!topicTitle) continue;
        candidates.push({
          category,
          topicTitle: String(topicTitle),
          broadcastTitle: String(row.title || ''),
          createdAt: row.created_at,
          keywords: extractKeywords(topicTitle)
        });
      }
    }

    const links = [];

    for (const article of currentArticles || []) {
      const currentText = `${article?.title || ''} ${article?.excerpt || ''}`;
      const currentKeywords = extractKeywords(currentText);
      if (currentKeywords.length === 0) continue;

      let best = null;

      for (const candidate of candidates) {
        if (String(candidate.topicTitle).toLowerCase() === String(article.title || '').toLowerCase()) {
          continue;
        }

        const similarity = scoreKeywordOverlap(currentKeywords, candidate.keywords);
        if (similarity < 0.12) continue;

        const ageDays = Math.max(0, Math.floor((Date.now() - new Date(candidate.createdAt).getTime()) / (24 * 60 * 60 * 1000)));
        const recencyBoost = Math.max(0.15, 1 - ageDays / Math.max(1, daysBack));
        const score = similarity * recencyBoost;

        if (!best || score > best.score) {
          best = {
            score,
            articleCategory: article.category_slug,
            articleTitle: article.title,
            matchedCategory: candidate.category,
            matchedTopic: candidate.topicTitle,
            matchedDate: candidate.createdAt,
            matchedBroadcast: candidate.broadcastTitle
          };
        }
      }

      if (best) links.push(best);
    }

    links.sort((a, b) => b.score - a.score);
    return links.slice(0, maxLinks);
  } catch (err) {
    console.warn(`  ⚠️  Could not build topical memory links: ${err.message}`);
    return [];
  }
}

function buildTopicalMemoryNotes(memoryLinks, daysBack = MEMORY_LOOKBACK_DAYS) {
  if (!Array.isArray(memoryLinks) || memoryLinks.length === 0) {
    return `No strong topical links found in the last ${daysBack} days.`;
  }

  return memoryLinks.map((link, idx) => {
    const when = dateKeyShort(link.matchedDate);
    const confidence = Math.round(link.score * 100);
    return `${idx + 1}. Current [${link.articleCategory}] "${link.articleTitle}" likely follows ${when} [${link.matchedCategory}] "${link.matchedTopic}" (${confidence}% topical overlap). Add a brief callback on what changed since then.`;
  }).join('\n');
}

function buildWeeklySagaTheme(weeklyTopContext) {
  const text = String(weeklyTopContext || '').trim();
  if (!text || text.toLowerCase().includes('unavailable') || text.toLowerCase().includes('no weekly top')) {
    return 'No weekly saga theme available. Keep continuity anchored to topical memory notes only.';
  }

  const match = text.match(/Top weekly headline:\s*(.+)/i);
  const topHeadline = match?.[1]?.trim();
  if (!topHeadline) {
    return 'Weekly context exists, but no clear top headline. Keep callbacks light and broad.';
  }

  return `Nadala Absurd saga anchor: "${topHeadline}". Use at least one callback that frames today as the next chapter of this weekly absurd arc.`;
}

async function fetchWeeklyTopContext(db) {
  try {
    const { data: summaryRows, error: summaryErr } = await db
      .from('weekly_roast_summaries')
      .select('id, week_key, week_start_date, week_end_date, top_article_title')
      .order('generated_at', { ascending: false })
      .limit(1);

    if (summaryErr) throw summaryErr;
    const summary = (summaryRows || [])[0];
    if (!summary?.id) {
      return 'No weekly Top 10 summary available yet.';
    }

    const { data: itemRows, error: itemsErr } = await db
      .from('weekly_roast_items')
      .select('rank, title, category_slug, views, absurdity_score')
      .eq('summary_id', summary.id)
      .order('rank', { ascending: true })
      .limit(5);

    if (itemsErr) throw itemsErr;

    const lines = (itemRows || []).map((item) => {
      return `#${item.rank} [${item.category_slug}] ${item.title} (views: ${item.views || 0}, absurdity: ${item.absurdity_score || 0})`;
    });

    return [
      `Weekly window: ${summary.week_start_date} to ${summary.week_end_date}`,
      `Top weekly headline: ${summary.top_article_title || 'n/a'}`,
      ...(lines.length > 0 ? lines : ['No weekly items found.'])
    ].join('\n');
  } catch (err) {
    console.warn(`  ⚠️  Could not load weekly top context: ${err.message}`);
    return 'Weekly Top 10 context unavailable.';
  }
}

async function fetchExternalResearchNotes(articles, maxItems = 3) {
  const picked = (articles || []).slice(0, maxItems);
  if (picked.length === 0) return 'No external research notes.';

  const notes = [];

  for (const article of picked) {
    try {
      const query = String(article?.title || '').split(' ').slice(0, 8).join(' ');
      if (!query) continue;

      const searchRes = await fetch(`https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(query)}&limit=1`, {
        signal: AbortSignal.timeout(8000)
      });
      if (!searchRes.ok) continue;

      const searchJson = await searchRes.json();
      const first = searchJson?.pages?.[0];
      if (!first?.key) continue;

      const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(first.key)}`, {
        signal: AbortSignal.timeout(8000)
      });
      if (!summaryRes.ok) continue;

      const summaryJson = await summaryRes.json();
      const extract = String(summaryJson?.extract || '').replace(/\s+/g, ' ').trim();
      if (!extract) continue;

      notes.push(`For "${article.title}": ${extract.slice(0, 240)}...`);
    } catch {
      // Keep best-effort behavior; external lookups are optional.
    }
  }

  if (notes.length === 0) {
    return 'No external research notes (fallback to article context only).';
  }
  return notes.join('\n');
}

async function fetchListenerPunchlineNotes(db, lookbackHours = LISTENER_PUNCHLINE_LOOKBACK_HOURS, maxItems = LISTENER_PUNCHLINE_MAX_ITEMS) {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  try {
    const { data: commentRows, error: commentErr } = await db
      .from('article_comments')
      .select('article_id, author_name, content, likes, created_at, is_approved')
      .eq('is_approved', true)
      .gte('created_at', since)
      .order('likes', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(120);

    if (commentErr) throw commentErr;

    const comments = (commentRows || [])
      .filter((row) => String(row?.content || '').trim().length >= 12)
      .slice(0, 60);

    if (comments.length === 0) {
      return 'No standout listener punchlines in the recent window.';
    }

    const articleIds = Array.from(new Set(comments.map((c) => c.article_id).filter(Boolean)));
    let articleTitleMap = new Map();

    if (articleIds.length > 0) {
      const { data: articleRows, error: articleErr } = await db
        .from('articles')
        .select('id, title')
        .in('id', articleIds);

      if (!articleErr) {
        articleTitleMap = new Map((articleRows || []).map((a) => [a.id, a.title]));
      }
    }

    const picked = comments.slice(0, maxItems).map((row, idx) => {
      const author = String(row.author_name || 'Anonymous Roaster').trim().slice(0, 40);
      const text = String(row.content || '').replace(/\s+/g, ' ').trim().slice(0, 180);
      const likes = Number(row.likes || 0);
      const headline = articleTitleMap.get(row.article_id) || 'unknown headline';
      return `${idx + 1}. ${author} (${likes} likes) on "${headline}": "${text}"`;
    });

    return picked.join('\n');
  } catch (err) {
    console.warn(`  ⚠️  Could not load listener punchlines: ${err.message}`);
    return 'Listener punchline context unavailable.';
  }
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
        .select('id, title, excerpt, content, category_slug, category_name, created_at')
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
Expand it to ${SCRIPT_TARGET_MIN_LINES}-${SCRIPT_TARGET_MAX_LINES} lines while preserving story order, clarity, and humor.

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

async function generateScript(
  articles,
  liveNotice,
  continuityNotes,
  topicalMemoryNotes,
  weeklyTopContext,
  externalResearchNotes,
  listenerPunchlineNotes,
  edition,
  retries = 2
) {
  console.log('🎙️  Generating comedy radio script...\n');

  const articleSummaries = articles.map(a => {
    // Strip HTML tags from content (it's stored with HTML blocks from article generation)
    const rawContent = String(a.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    // Use content body up to 600 chars, falling back to excerpt
    const bodySnippet = rawContent.length > 80
      ? rawContent.slice(0, 600) + (rawContent.length > 600 ? '…' : '')
      : (a.excerpt || '');
    return `- [${CATEGORY_ICONS[a.category_slug]} ${a.category_name}] "${a.title}"\n  Summary: ${bodySnippet}`;
  }).join('\n\n');

  const hostPersonaBrief = [
    `Joe bio: ${HOST_BIO_JOE}`,
    `Jane bio: ${HOST_BIO_JANE}`,
    `Shared history: ${HOST_SHARED_HISTORY}`,
    `Shared memory bank: ${HOST_MEMORY_BANK}`,
    `Tangent style guide: ${TANGENT_STYLE_GUIDE}`,
    `Target tangent count this episode: ${TARGET_TANGENTS_PER_EPISODE}`
  ].join('\n');

  const weeklySagaTheme = buildWeeklySagaTheme(weeklyTopContext);
  const promoBrief = PROMO_MODE === 'partner_challenge'
    ? `PROMO MODE: partner_challenge\n${PROMO_PARTNER_CHALLENGE}`
    : `PROMO MODE: platform\n${PLATFORM_PROMO_BRIEF}`;

  const isSundaySpecial = BROADCAST_FORMAT === 'sunday_special';
  const formatBlock = isSundaySpecial
    ? `SUNDAY SPECIAL MODE:
- This episode is part of a Sunday multi-episode marathon.
- Keep pacing tighter than weekday episodes and prioritize high-information comedy.
- Weave in weekly callbacks from the WEEKLY TOP CONTEXT section.
${SUNDAY_DEEP_DIVE ? '- Deep-dive required: include one "REALITY CHECK" comparison where hosts contrast the real-world context vs the parody angle for a top story.' : ''}`
    : 'STANDARD DAILY MODE: Use normal daily edition pacing and structure.';

  const prompt = `You are the head writer for "The Daily Roast Radio" — a sharp, story-first comedy news podcast hosted by two anchors:

**Joe** — The dry, sarcastic anchor. Deadpan delivery, world-weary cynicism, loves a good pun. Think a mix of Jon Stewart's wit and Ron Burgundy's unearned confidence.
**Jane** — The energetic, sharp co-host. Quick-witted, slightly chaotic energy, prone to tangential jokes. She's the one who makes Joe break character.

TODAY'S STORIES TO COVER (one from each category):
${articleSummaries}

EARLIER BROADCAST CONTEXT (last 24h):
${continuityNotes}

TOPICAL MEMORY LINKS (last ${MEMORY_LOOKBACK_DAYS} days):
${topicalMemoryNotes}

WEEKLY TOP CONTEXT:
${weeklyTopContext}

EXTERNAL RESEARCH NOTES (best effort web context):
${externalResearchNotes}

LISTENER PUNCHLINE PICKS (community signal):
${listenerPunchlineNotes}

FORMAT MODE:
${formatBlock}

HOST PERSONALITY + BACKSTORY (MANDATORY CONTINUITY INPUT):
${hostPersonaBrief}

PLATFORM PROMO BRIEF (MANDATORY MID-SHOW SLOT):
${promoBrief}

WEEKLY SAGA THEME (SERIAL CONTINUITY):
${weeklySagaTheme}

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
4. **MID-SHOW STATION BREAK** — Exactly one short promo break in the middle of the episode.
  - Keep it to 2-4 lines total.
  - Use the PLATFORM PROMO BRIEF above.
  - Make it sound naturally in-character for Joe and Jane.
  - The handoff OUT of the promo must be a natural closing like "back to the news" or "alright, where were we" — NOT a reference to silence, pauses, audio, or sound effects.
  - The handoff INTO the promo must be a natural phrase like "a word from our sponsor", "quick word from The Daily Roast", "time for a sponsor break", or "now a message from..." — the audio bumper plays automatically; hosts must NOT describe or announce it.
5. **WRAP-UP** — Final banter, use the edition-specific signoff instruction above

${SUNDAY_DEEP_DIVE ? '6. **REALITY CHECK MOMENT** — Include one concise compare/contrast beat for a top story:\n   - what happened in real reporting context\n   - what absurd exaggeration the roast adds\n   - why the contrast is funny and revealing' : ''}

${PROMO_MODE === 'partner_challenge' ? 'PROMO CTA RULE: in station break, include a measurable partner CTA (challenge name or short code).' : ''}

LENGTH BUDGET (MANDATORY):
- Cold open: 4-6 lines
- Intro: 8-10 lines
- Each story segment: 8-10 lines
- Wrap-up: 6-8 lines
- Total: ${SCRIPT_TARGET_MIN_LINES}-${SCRIPT_TARGET_MAX_LINES} lines
- If first draft is shorter than ${SCRIPT_TARGET_MIN_LINES}, continue adding lines until it reaches at least ${SCRIPT_TARGET_MIN_LINES}.

CONTENT QUALITY RULES (VERY IMPORTANT):
- Be specific to each provided story; avoid generic commentary that could fit any headline.
- Every story segment must contain at least 2 concrete details from the headline/excerpt context (names, places, numbers, policy/action, timeline, consequence).
- Treat each segment like mini-editorial satire: first clarity, then absurdity.
- Use one perspective shift per story (citizen angle, business angle, policy angle, culture angle, or global angle).
- Vary pacing: quick jab -> analysis beat -> callback -> stronger punchline.
- If a topical memory link is provided for a story, include one explicit continuity callback (what changed since earlier coverage).
- If weekly context is provided, include at least one callback to a weekly top story.
- If LISTENER PUNCHLINE PICKS contains numbered entries (for example line starts with "1."), include one short listener shout-out/callback naturally in the episode.
- Treat each episode as part of an ongoing weekly narrative arc, not a disconnected standalone.

COMEDY STYLE:
- Deadpan absurdity (treat insane things as normal)
- Quick back-and-forth banter (not monologues)
- Specific, vivid jokes (not generic "isn't that crazy")
- Pop culture references and callbacks
- Running jokes that recur through the show
- Each line should be ~1-3 sentences (natural speech pacing)
- Keep hosts distinct: Joe = dry and surgical; Jane = energetic and surprising.
- Prefer clever comparisons/metaphors over random nonsense.
- Reflect host backstory subtly in tone, references, and chemistry (do not read bios out loud directly).

EMOTIONAL DELIVERY CUES (MANDATORY — use inline in text, not as stage directions):
- Embed emotion cues directly inside the spoken text using square brackets: [laughing], [sarcastically], [sighing], [gasping], [whispering], [excitedly], [deadpan].
- Use them sparingly but meaningfully — 2–4 cues per story segment, not every line.
- Joe favors [sarcastically], [sighing], [deadpan]. Reserve his [laughing] for moments that genuinely break him.
- Jane favors [laughing], [excitedly], [gasping]. Her [sarcastically] should feel like a mock-Joe impression.
- Example: {"speaker": "Jane", "text": "[gasping] Wait, they actually said that out loud? In a press release?"}  
- Example: {"speaker": "Joe", "text": "[sarcastically] Groundbreaking stuff. Truly a historic moment for democracy."}  
- Example: {"speaker": "Jane", "text": "[laughing] I can't — okay, I'm sorry, I just can't with this one."}

CONTROLLED HUMAN TANGENTS (MANDATORY):
- Include approximately ${TARGET_TANGENTS_PER_EPISODE} short tangent moments across the whole episode.
- A tangent can be: a quick personal memory, a newsroom memory, or a historical comparison.
- Each tangent should last 1-2 lines max, then return to the story with a bridge line.
- Do not let tangents derail story clarity or consume a full segment.
- Reuse items from the shared memory bank when natural, but vary wording so it feels spontaneous.

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
- Keep the promo section clearly marked by a natural radio handoff phrase such as "a word from our sponsor", "quick sponsor break", "now a message from", or "time for our sponsor" — do NOT use bracketed production cues and do NOT mention pauses, silence, sound effects, or audio in the promo handoff lines.
- Whenever a tangent appears, ensure the next 1-2 lines reconnect cleanly to the current headline.

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

The script should have ${SCRIPT_TARGET_MIN_LINES}-${SCRIPT_TARGET_MAX_LINES} lines total (~15 minutes of audio).
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

      if (data.script.length < SCRIPT_MIN_HARD_FLOOR) {
        throw new Error(`Script too short after expansion: ${data.script.length} lines (hard floor ${SCRIPT_MIN_HARD_FLOOR})`);
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

  function getPromoBumperTrackForRun() {
    if (BROADCAST_SLOT === 'morning' && PROMO_BUMPER_TRACK_MORNING) return PROMO_BUMPER_TRACK_MORNING;
    if (BROADCAST_SLOT === 'afternoon' && PROMO_BUMPER_TRACK_AFTERNOON) return PROMO_BUMPER_TRACK_AFTERNOON;
    if (BROADCAST_SLOT === 'evening' && PROMO_BUMPER_TRACK_EVENING) return PROMO_BUMPER_TRACK_EVENING;
    return PROMO_BUMPER_TRACK;
  }

  const ttsPrompt = `Read aloud this satirical radio conversation between two hosts, Joe and Jane.
` +
    `Delivery style:
` +
    `- Joe: dry, deadpan, slightly tired baritone. Lets sarcasm drip slowly. Rare genuine laugh makes it land harder.
` +
    `- Jane: energetic, warm, quick. Laughs easily and genuinely. Sarcasm is bright and fast.
` +
    `- Follow any inline emotion cues like [laughing], [sarcastically], [sighing], [gasping] embedded in the text.
` +
    `- Natural conversation rhythm: interruptions feel real, pauses are human, not robotic.
\n` +
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

  function findPromoSegment(lines) {
    if (!Array.isArray(lines) || lines.length < 6) return null;

    const promoStartKeywords = [
      'a word from our sponsor', 'quick sponsor break', 'time for our sponsor',
      'now a message from', 'word from our sponsor', 'sponsor break',
      'commercial break', 'ad break', 'station break', 'brought to you by'
    ];
    const promoEndKeywords = [
      'back to the news', 'back to headlines', 'back to the headlines',
      'back to our stories', 'where were we', 'and we are back',
      "and we're back", 'all right, where were we', 'alright, where were we'
    ];

    const normalized = lines.map((line) => String(line?.text || '').toLowerCase());
    const startCandidates = normalized
      .map((text, idx) => ({ text, idx }))
      .filter(({ text }) => promoStartKeywords.some((kw) => text.includes(kw)))
      .map(({ idx }) => idx);

    if (startCandidates.length === 0) return null;

    // Prefer a promo handoff near the middle of the script, not the first random match.
    const target = Math.floor(lines.length * 0.5);
    const promoStart = startCandidates
      .slice()
      .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];

    let promoEnd = Math.min(lines.length - 1, promoStart + 3);
    const maxScan = Math.min(lines.length - 1, promoStart + 7);
    for (let i = promoStart + 1; i <= maxScan; i++) {
      if (promoEndKeywords.some((kw) => normalized[i].includes(kw))) {
        promoEnd = i;
        break;
      }
    }

    if (promoStart <= 0 || promoEnd >= lines.length - 1) return null;
    return { promoStart, promoEnd };
  }

  function createSilenceWavBuffer(seconds, sampleRate = 24000) {
    const clamped = Math.max(0, Number(seconds) || 0);
    const sampleCount = Math.floor(sampleRate * clamped);
    const pcmData = Buffer.alloc(sampleCount * 2, 0);

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
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return Buffer.concat([header, pcmData]);
  }

  async function loadPromoBumperWavBuffer() {
    const selectedTrack = getPromoBumperTrackForRun();
    if (!selectedTrack) return null;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-roast-bumper-'));
    const inputPath = path.join(tmpDir, `bumper-src${getTrackExtension(selectedTrack)}`);
    const outputPath = path.join(tmpDir, 'bumper.wav');

    try {
      if (isHttpUrl(selectedTrack)) {
        const data = await fetchBinary(selectedTrack);
        fs.writeFileSync(inputPath, data);
      } else {
        const resolved = path.isAbsolute(selectedTrack)
          ? selectedTrack
          : path.resolve(process.cwd(), selectedTrack);
        if (!fs.existsSync(resolved)) {
          throw new Error(`PROMO_BUMPER_TRACK not found: ${resolved}`);
        }
        fs.copyFileSync(resolved, inputPath);
      }

      await runCommand('ffmpeg', [
        '-y',
        '-i', inputPath,
        '-t', String(PROMO_BUMPER_SECONDS),
        '-ar', '24000',
        '-ac', '1',
        '-c:a', 'pcm_s16le',
        outputPath
      ]);

      return fs.readFileSync(outputPath);
    } catch (err) {
      console.warn(`  ⚠️  Promo bumper load failed: ${err.message}`);
      return null;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  async function generateAudioWithPromoBreaks() {
    const promoSegment = findPromoSegment(script);
    if (!promoSegment) return null;

    const before = script.slice(0, promoSegment.promoStart);
    const promo = script.slice(promoSegment.promoStart, promoSegment.promoEnd + 1);
    const after = script.slice(promoSegment.promoEnd + 1);

    if (before.length === 0 || promo.length === 0 || after.length === 0) {
      return null;
    }

    console.log(`  🎚️  Promo segment detected at lines ${promoSegment.promoStart + 1}-${promoSegment.promoEnd + 1}; generating pre/promo/post with pauses.`);

    const beforeWav = await generateChunkAudio(before);
    await sleep(800);
    const promoWav = await generateChunkAudio(promo);
    await sleep(800);
    const afterWav = await generateChunkAudio(after);

    const pauseWav = createSilenceWavBuffer(PROMO_PAUSE_SECONDS, 24000);
    const bumperWav = await loadPromoBumperWavBuffer();

    const blocks = [beforeWav, pauseWav];
    if (bumperWav) blocks.push(bumperWav, pauseWav);
    blocks.push(promoWav, pauseWav);
    if (bumperWav) blocks.push(bumperWav, pauseWav);
    blocks.push(afterWav);

    const merged = mergeWavBuffers(blocks, 24000);
    const durationSeconds = Math.round(merged.length / (24000 * 2));

    console.log('  ✅ Promo pauses inserted (script -> pause -> promo -> pause -> script).');
    return { wavBuffer: merged, durationSeconds };
  }

  async function generateChunkAudio(chunkLines) {
    const chunkPrompt = `Read aloud this satirical radio conversation between two hosts, Joe and Jane.\n` +
      `Delivery style:\n` +
      `- Joe: dry, deadpan, slightly tired baritone. Lets sarcasm drip slowly. Rare genuine laugh makes it land harder.\n` +
      `- Jane: energetic, warm, quick. Laughs easily and genuinely. Sarcasm is bright and fast.\n` +
      `- Follow any inline emotion cues like [laughing], [sarcastically], [sighing], [gasping] embedded in the text.\n` +
      `- Natural conversation rhythm: interruptions feel real, pauses are human, not robotic.\n\n` +
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
      const promoStructured = await generateAudioWithPromoBreaks();
      if (promoStructured) {
        return promoStructured;
      }

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

async function convertWavToMp3(wavBuffer) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roast-mp3-'));
  const wavPath = path.join(tmpDir, 'input.wav');
  const mp3Path = path.join(tmpDir, 'output.mp3');
  try {
    fs.writeFileSync(wavPath, wavBuffer);
    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-y', '-i', wavPath,
        '-codec:a', 'libmp3lame', '-q:a', '4',  // VBR ~165kbps — good quality, small size
        '-ar', '44100',
        mp3Path
      ]);
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg mp3 exit ${code}`)));
      proc.on('error', reject);
    });
    return fs.readFileSync(mp3Path);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function uploadAudio(db, wavBuffer) {
  const date = new Date().toISOString().slice(0, 10);

  // Convert to MP3 for podcast compatibility (Spotify, Apple Podcasts)
  let uploadBuffer = wavBuffer;
  let ext = 'wav';
  let contentType = 'audio/wav';
  try {
    console.log('  🎵 Converting WAV → MP3...');
    uploadBuffer = await convertWavToMp3(wavBuffer);
    ext = 'mp3';
    contentType = 'audio/mpeg';
    console.log(`  ✅ MP3 ready (${Math.round(uploadBuffer.length / 1024 / 1024 * 10) / 10}MB)`);
  } catch (convErr) {
    console.warn(`  ⚠️  MP3 conversion failed, uploading WAV: ${convErr.message}`);
  }

  const fileName = `broadcast-${date}-${Date.now()}.${ext}`;
  const filePath = `${new Date().toISOString().slice(0, 7)}/${fileName}`;

  try {
    const { data, error } = await db.storage
      .from(AUDIO_BUCKET)
      .upload(filePath, uploadBuffer, {
        contentType,
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

async function fetchLatestCoverImageUrl(db) {
  try {
    const { data, error } = await db
      .from('broadcasts')
      .select('cover_image_url, created_at')
      .eq('published', true)
      .not('cover_image_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data?.cover_image_url || null;
  } catch (err) {
    console.warn(`  ⚠️  Could not reuse recent cover image: ${err.message}`);
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
  console.log(`🎛️  Format: ${BROADCAST_FORMAT}${SUNDAY_DEEP_DIVE ? ' (deep-dive)' : ''}`);
  console.log(`🧮 Script budget: ${SCRIPT_TARGET_MIN_LINES}-${SCRIPT_TARGET_MAX_LINES} lines`);
  console.log(`🔎 External research: ${ENABLE_EXTERNAL_RESEARCH ? 'enabled' : 'disabled'}`);

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
  const topicalMemoryLinks = await fetchTopicalMemoryLinks(db, articles, MEMORY_LOOKBACK_DAYS, MEMORY_MAX_LINKS);
  const topicalMemoryNotes = buildTopicalMemoryNotes(topicalMemoryLinks, MEMORY_LOOKBACK_DAYS);
  const weeklyTopContext = BROADCAST_FORMAT === 'sunday_special'
    ? await fetchWeeklyTopContext(db)
    : 'Weekly Top context skipped for daily mode (optimization).';
  const externalResearchNotes = ENABLE_EXTERNAL_RESEARCH
    ? await fetchExternalResearchNotes(articles, EXTERNAL_RESEARCH_MAX_ITEMS)
    : 'External research disabled for this run (API optimization mode).';
  const listenerPunchlineNotes = ENABLE_LISTENER_PUNCHLINES
    ? await fetchListenerPunchlineNotes(db)
    : 'Listener punchline context disabled for this run.';

  if (articles.length < 3) {
    console.error(`❌ Not enough articles (${articles.length}). Need at least 3 categories. Exiting.`);
    process.exit(1);
  }

  // Step 2: Generate comedy script
  console.log(`\n${'─'.repeat(60)}`);
  const liveNotice = await fetchPoltsamaaWeather();
  console.log(`🌦️  Live notice: ${liveNotice.localDate}, ${liveNotice.localTime} (${TALLINN_TIMEZONE}) — ${liveNotice.summary}`);
  console.log(`🕒 Edition: ${edition.label} (${edition.nominalTime} Tallinn)`);
  const scriptData = await generateScript(
    articles,
    liveNotice,
    continuityNotes,
    topicalMemoryNotes,
    weeklyTopContext,
    externalResearchNotes,
    listenerPunchlineNotes,
    edition
  );

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
  let finalAudioBuffer = null;
  if (audioResult) {
    finalAudioBuffer = audioResult.wavBuffer;

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
  if (SKIP_COVER_IMAGE) {
    console.log('🖼️  Cover generation skipped (SKIP_COVER_IMAGE=1).');
    if (REUSE_RECENT_COVER) {
      coverImageUrl = await fetchLatestCoverImageUrl(db);
      if (coverImageUrl) {
        console.log('  ♻️  Reusing latest cover image URL.');
      }
    }
  } else {
    const imageData = await generateCoverImage(articles);
    if (imageData) {
      coverImageUrl = await uploadCoverImage(db, imageData);
    }
    if (!coverImageUrl && REUSE_RECENT_COVER) {
      coverImageUrl = await fetchLatestCoverImageUrl(db);
      if (coverImageUrl) {
        console.log('  ♻️  Cover generation fallback: reused latest cover image URL.');
      }
    }
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
  const titlePrefix = BROADCAST_FORMAT === 'sunday_special'
    ? 'The Daily Roast Sunday Special'
    : BROADCAST_FORMAT === 'flash'
      ? '⚡ Daily Roast Flash'
      : 'The Daily Roast Radio';
  const title = `${titlePrefix} — ${today.format(new Date())} · ${edition.label}`;

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
  console.log(`  🎙️  Podbean: ${ENABLE_PODBEAN ? 'enabled' : 'disabled'}`);
  console.log('='.repeat(50));

  // Step 6: Auto-publish to Podbean
  if (ENABLE_PODBEAN && finalAudioBuffer && broadcast) {
    await uploadBroadcastToPodbean(finalAudioBuffer, {
      title,
      script: scriptData.script,
      coverImageUrl
    });
  }
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
