import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const YT_CLIENT_ID = process.env.YT_CLIENT_ID;
const YT_CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const YT_REFRESH_TOKEN = process.env.YT_REFRESH_TOKEN;
const YT_PODCAST_PLAYLIST_ID = (process.env.YT_PODCAST_PLAYLIST_ID || '').trim();
const SITE_URL = process.env.SITE_URL || 'https://the-daily-roast-66e.pages.dev';

function resolvePrivacyStatus(rawValue) {
  const allowed = new Set(['public', 'unlisted', 'private']);
  const normalized = String(rawValue || '')
    .trim()
    .toLowerCase()
    .replace(/^"|"$/g, '')
    .replace(/^'|'$/g, '');

  if (allowed.has(normalized)) return normalized;

  console.warn(`Invalid YT_PRIVACY_STATUS value ("${rawValue || ''}"). Falling back to "unlisted".`);
  return 'unlisted';
}

const YT_PRIVACY_STATUS = resolvePrivacyStatus(process.env.YT_PRIVACY_STATUS);

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
  console.error('Missing YouTube OAuth variables: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function downloadFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
}

async function selectLatestBroadcast() {
  const { data, error } = await db
    .from('broadcasts')
    .select('*')
    .eq('published', true)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) return null;

  const hasYoutubeColumn = Object.prototype.hasOwnProperty.call(rows[0], 'youtube_video_id');

  if (hasYoutubeColumn) {
    const pending = rows.find((row) => row.audio_url && !row.youtube_video_id);
    return { row: pending || null, hasYoutubeColumn };
  }

  const latestWithAudio = rows.find((row) => row.audio_url);
  return { row: latestWithAudio || null, hasYoutubeColumn };
}

function parseScriptLines(scriptValue) {
  if (Array.isArray(scriptValue)) return scriptValue;
  if (typeof scriptValue === 'string') {
    try {
      const parsed = JSON.parse(scriptValue);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function formatChapterTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function detectChapterEvents(scriptLines) {
  const events = [];
  const pushEvent = (index, label) => {
    if (index < 0) return;
    events.push({ index, label });
  };

  pushEvent(0, 'Cold Open');

  for (let i = 0; i < scriptLines.length; i++) {
    const text = String(scriptLines[i]?.text || '').toLowerCase();

    if (text.includes('station break') || text.includes('sponsor')) {
      pushEvent(i, 'Station Break');
    } else if (text.includes('reality check')) {
      pushEvent(i, 'Reality Check');
    } else if (text.includes('moving on') || text.includes('next up') || text.includes('from the world of')) {
      pushEvent(i, 'Story Shift');
    } else if (text.includes('wrap-up') || text.includes('sign off') || text.includes('see you')) {
      pushEvent(i, 'Wrap Up');
    }
  }

  const deduped = [];
  let lastIndex = -999;
  for (const ev of events.sort((a, b) => a.index - b.index)) {
    if (ev.index - lastIndex < 4) continue;
    deduped.push(ev);
    lastIndex = ev.index;
  }

  return deduped.slice(0, 8);
}

function buildChapterLines(row) {
  const scriptLines = parseScriptLines(row?.script);
  if (scriptLines.length < 8) return [];

  const totalSeconds = Math.max(1, Number(row?.duration_seconds || 0));
  const events = detectChapterEvents(scriptLines);
  if (events.length === 0) return [];

  const lines = [];
  let lastSecond = -999;
  for (const ev of events) {
    const second = Math.max(0, Math.floor((ev.index / Math.max(1, scriptLines.length - 1)) * totalSeconds));
    if (second - lastSecond < 10) continue;
    lines.push(`${formatChapterTime(second)} ${ev.label}`);
    lastSecond = second;
  }

  return lines;
}

function buildDescription(row) {
  const categorySummary = row.category_summary || {};
  const lines = Object.entries(categorySummary)
    .map(([cat, title]) => `- ${cat}: ${title}`)
    .join('\n');

  const chapterLines = buildChapterLines(row);

  return [
    'The Daily Roast Radio - satire broadcast.',
    '',
    'All content is fictional parody inspired by real headlines.',
    '',
    'Stories in this episode:',
    lines || '- mixed headlines',
    ...(chapterLines.length > 0
      ? [
        '',
        'Chapters:',
        ...chapterLines
      ]
      : []),
    '',
    `Read more: ${SITE_URL}`,
    '',
    '#satire #parody #news'
  ].join('\n');
}

async function renderMp4(row) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-roast-yt-'));
  const audioPath = path.join(tmpDir, 'broadcast-audio.wav');
  const imagePath = path.join(tmpDir, 'broadcast-cover.jpg');
  const videoPath = path.join(tmpDir, 'broadcast.mp4');

  await downloadFile(row.audio_url, audioPath);

  if (row.cover_image_url) {
    await downloadFile(row.cover_image_url, imagePath);
  } else {
    await runCommand('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=#1b2838:s=1280x720:d=1',
      '-frames:v', '1',
      imagePath
    ]);
  }

  await runCommand('ffmpeg', [
    '-y',
    '-loop', '1',
    '-i', imagePath,
    '-i', audioPath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'stillimage',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    '-shortest',
    videoPath
  ]);

  return { tmpDir, videoPath };
}

async function uploadToYouTube(youtube, row, videoPath) {

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: row.title,
        description: buildDescription(row),
        tags: ['satire', 'parody', 'news', 'ai'],
        categoryId: '24'
      },
      status: {
        privacyStatus: YT_PRIVACY_STATUS,
        selfDeclaredMadeForKids: false
      }
    },
    media: {
      body: fs.createReadStream(videoPath)
    }
  });

  const videoId = response?.data?.id;
  if (!videoId) throw new Error('YouTube upload succeeded but no video id returned');

  return {
    videoId,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`
  };
}

async function addVideoToPlaylist(youtube, videoId, playlistId) {
  await youtube.playlistItems.insert({
    part: ['snippet'],
    requestBody: {
      snippet: {
        playlistId,
        resourceId: {
          kind: 'youtube#video',
          videoId
        }
      }
    }
  });
}

async function markStatus(rowId, hasYoutubeColumn, status, extra = {}) {
  if (!hasYoutubeColumn) return;

  const payload = {
    youtube_upload_status: status,
    ...extra
  };

  const { error } = await db.from('broadcasts').update(payload).eq('id', rowId);
  if (error) {
    console.warn(`Could not update broadcast youtube status: ${error.message}`);
  }
}

async function main() {
  const selected = await selectLatestBroadcast();
  if (!selected || !selected.row) {
    console.log('No broadcast pending for YouTube upload.');
    return;
  }

  const { row, hasYoutubeColumn } = selected;

  if (!row.audio_url) {
    console.log('Latest broadcast has no audio_url, skipping upload.');
    return;
  }

  console.log(`Preparing YouTube upload for broadcast: ${row.title}`);
  await markStatus(row.id, hasYoutubeColumn, 'rendering', { youtube_upload_error: null });

  let tmpDir = null;
  try {
    const rendered = await renderMp4(row);
    tmpDir = rendered.tmpDir;

    await markStatus(row.id, hasYoutubeColumn, 'uploading');
    const oauth2Client = new google.auth.OAuth2(YT_CLIENT_ID, YT_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: YT_REFRESH_TOKEN });
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const uploaded = await uploadToYouTube(youtube, row, rendered.videoPath);

    if (YT_PODCAST_PLAYLIST_ID) {
      try {
        await addVideoToPlaylist(youtube, uploaded.videoId, YT_PODCAST_PLAYLIST_ID);
        console.log(`Podcast playlist add complete: ${YT_PODCAST_PLAYLIST_ID}`);
      } catch (playlistErr) {
        console.warn(`Podcast playlist add failed: ${playlistErr.message || playlistErr}`);
      }
    }

    await markStatus(row.id, hasYoutubeColumn, 'uploaded', {
      youtube_video_id: uploaded.videoId,
      youtube_url: uploaded.youtubeUrl,
      youtube_uploaded_at: new Date().toISOString(),
      youtube_upload_error: null
    });

    console.log(`YouTube upload complete: ${uploaded.youtubeUrl}`);
  } catch (err) {
    await markStatus(row.id, hasYoutubeColumn, 'failed', {
      youtube_upload_error: String(err.message || err).slice(0, 1000)
    });
    console.error(`YouTube upload failed: ${err.message || err}`);
    process.exit(1);
  } finally {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
