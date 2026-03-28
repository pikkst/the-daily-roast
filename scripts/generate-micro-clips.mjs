import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CLIP_COUNT = Math.max(1, Math.min(5, Number(process.env.CLIP_COUNT || '3')));
const CLIP_SECONDS = Math.max(20, Math.min(40, Number(process.env.CLIP_SECONDS || '30')));
const CLIP_BUCKET = String(process.env.CLIP_BUCKET || 'broadcast-clips').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
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
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buffer);
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

function selectClipMarkers(scriptLines, clipCount = 3) {
  const markers = [];

  // 1) Best roast moment (early-mid energy)
  markers.push({ type: 'best-roast', index: Math.floor(scriptLines.length * 0.22) });

  // 2) Joe vs Jane debate indicator
  const debateIdx = scriptLines.findIndex((line) => {
    const text = String(line?.text || '').toLowerCase();
    return text.includes('but') || text.includes('hold on') || text.includes('no way') || text.includes('you are') || text.includes('that is wild');
  });
  markers.push({ type: 'joe-vs-jane', index: debateIdx >= 0 ? debateIdx : Math.floor(scriptLines.length * 0.48) });

  // 3) Fake expert / caller quote
  const expertIdx = scriptLines.findIndex((line) => {
    const text = String(line?.text || '').toLowerCase();
    return text.includes('expert') || text.includes('caller') || text.includes('dr.') || text.includes('professor');
  });
  markers.push({ type: 'fake-expert', index: expertIdx >= 0 ? expertIdx : Math.floor(scriptLines.length * 0.72) });

  const deduped = [];
  for (const m of markers) {
    if (!Number.isFinite(m.index) || m.index < 0) continue;
    if (deduped.some((x) => Math.abs(x.index - m.index) < 6)) continue;
    deduped.push(m);
  }

  while (deduped.length < clipCount) {
    const ratio = 0.2 + (deduped.length * 0.25);
    deduped.push({ type: `moment-${deduped.length + 1}`, index: Math.floor(scriptLines.length * ratio) });
  }

  return deduped.slice(0, clipCount);
}

function buildClipPlan(row) {
  const duration = Math.max(60, Number(row.duration_seconds || 0));
  const scriptLines = parseScriptLines(row.script);

  if (scriptLines.length < 8) {
    const starts = [0, Math.floor(duration * 0.35), Math.floor(duration * 0.65)].slice(0, CLIP_COUNT);
    return starts.map((start, i) => ({
      label: `moment-${i + 1}`,
      start: Math.max(0, Math.min(duration - CLIP_SECONDS, start)),
      duration: CLIP_SECONDS
    }));
  }

  const markers = selectClipMarkers(scriptLines, CLIP_COUNT);
  const plans = markers.map((m) => {
    const ratio = m.index / Math.max(1, scriptLines.length - 1);
    const center = Math.floor(ratio * duration);
    const start = Math.max(0, Math.min(duration - CLIP_SECONDS, center - Math.floor(CLIP_SECONDS / 2)));
    return {
      label: m.type,
      start,
      duration: CLIP_SECONDS
    };
  });

  plans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < plans.length; i++) {
    if (plans[i].start - plans[i - 1].start < 12) {
      plans[i].start = Math.min(duration - CLIP_SECONDS, plans[i - 1].start + 12);
    }
  }

  return plans;
}

async function ensureClipBucket() {
  try {
    const { data: buckets, error: listErr } = await db.storage.listBuckets();
    if (listErr) throw new Error(`Cannot list buckets: ${listErr.message}`);

    const exists = (buckets || []).some((b) => b.name === CLIP_BUCKET);
    if (exists) return;

    let { error } = await db.storage.createBucket(CLIP_BUCKET, {
      public: true,
      allowedMimeTypes: ['video/mp4'],
      fileSizeLimit: 500 * 1024 * 1024  // 500MB — paid plan
    });

    // Fallback: retry without size limit
    if (error) {
      console.warn(`  ⚠️  Bucket create with size limit failed (${error.message}), retrying without limit...`);
      ({ error } = await db.storage.createBucket(CLIP_BUCKET, { public: true }));
    }

    if (error) {
      throw new Error(
        `Could not create storage bucket "${CLIP_BUCKET}": ${error.message}\n` +
        `  👉 Fix: Go to Supabase → Storage → New bucket → name: "${CLIP_BUCKET}", Public: on`
      );
    }

    console.log(`  📦 Created storage bucket: ${CLIP_BUCKET}`);
  } catch (err) {
    // Re-throw so main() fails fast with a clear message instead of "Bucket not found" later
    throw err;
  }
}

async function uploadClip(filePath, remotePath) {
  const buffer = fs.readFileSync(filePath);
  const { error } = await db.storage
    .from(CLIP_BUCKET)
    .upload(remotePath, buffer, {
      contentType: 'video/mp4',
      cacheControl: '31536000',
      upsert: true
    });

  if (error) throw error;

  const { data } = db.storage.from(CLIP_BUCKET).getPublicUrl(remotePath);
  return data?.publicUrl;
}

async function selectLatestBroadcast() {
  const { data, error } = await db
    .from('broadcasts')
    .select('*')
    .eq('published', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function renderClipVideo({ coverPath, audioPath, outPath, start, duration }) {
  await runCommand('ffmpeg', [
    '-y',
    '-loop', '1',
    '-i', coverPath,
    '-ss', String(start),
    '-t', String(duration),
    '-i', audioPath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'stillimage',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
    '-shortest',
    outPath
  ]);
}

async function generateFallbackCover(outPath) {
  await runCommand('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=#1b2838:s=1080x1920:d=1',
    '-frames:v', '1',
    outPath
  ]);
}

async function main() {
  const row = await selectLatestBroadcast();
  if (!row || !row.audio_url) {
    console.log('No eligible broadcast with audio found for clip generation.');
    return;
  }

  await ensureClipBucket();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-roast-clips-'));
  const audioPath = path.join(tmpDir, 'episode.wav');
  const coverPath = path.join(tmpDir, 'cover.jpg');

  try {
    console.log(`Generating clips from: ${row.title}`);
    await downloadFile(row.audio_url, audioPath);

    if (row.cover_image_url) {
      await downloadFile(row.cover_image_url, coverPath);
    } else {
      await generateFallbackCover(coverPath);
    }

    const clipPlan = buildClipPlan(row);
    const datePrefix = new Date().toISOString().slice(0, 10);

    const uploaded = [];
    for (let i = 0; i < clipPlan.length; i++) {
      const clip = clipPlan[i];
      const fileName = `clip-${datePrefix}-${i + 1}-${clip.label}.mp4`;
      const outPath = path.join(tmpDir, fileName);

      console.log(`  🎬 Rendering clip ${i + 1}/${clipPlan.length}: ${clip.label} @ ${clip.start}s`);
      await renderClipVideo({
        coverPath,
        audioPath,
        outPath,
        start: clip.start,
        duration: clip.duration
      });

      const remotePath = `${new Date().toISOString().slice(0, 7)}/${fileName}`;
      const publicUrl = await uploadClip(outPath, remotePath);
      uploaded.push({ ...clip, publicUrl, fileName });
    }

    console.log('✅ Micro clips uploaded:');
    uploaded.forEach((u, idx) => {
      console.log(`  ${idx + 1}. [${u.label}] ${u.publicUrl}`);
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Micro clip generation failed:', err.message || err);
  process.exit(1);
});
