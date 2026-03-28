import { spawn } from 'node:child_process';

const SUNDAY_UPLOAD_YOUTUBE = process.env.SUNDAY_UPLOAD_YOUTUBE === '1';
const FORCE_REPLACE_EDITION = process.env.FORCE_REPLACE_EDITION === '1';
const RUN_WEEKLY_TOP10_BEFORE_MARATHON = process.env.RUN_WEEKLY_TOP10_BEFORE_MARATHON !== '0';
const DEFAULT_SUNDAY_BUMPER = 'sounds/dragon-studio-whoosh-cinematic-376875.mp3';
const SUNDAY_PROMO_BUMPER_TRACK = (process.env.SUNDAY_PROMO_BUMPER_TRACK || DEFAULT_SUNDAY_BUMPER).trim();

function runNodeScript(scriptPath, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...extraEnv
      }
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptPath} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

const episodes = [
  {
    slot: 'morning',
    label: 'Weekly Recap Sprint',
    minLines: 42,
    maxLines: 58,
    deepDive: '0',
    enableResearch: '0',
    skipCoverImage: '1'
  },
  {
    slot: 'afternoon',
    label: 'Top Story Deep Dive',
    minLines: 50,
    maxLines: 70,
    deepDive: '1',
    enableResearch: '1',
    skipCoverImage: '0'
  },
  {
    slot: 'evening',
    label: 'Weekly Wrap & What Next',
    minLines: 42,
    maxLines: 58,
    deepDive: '0',
    enableResearch: '0',
    skipCoverImage: '1'
  }
];

async function main() {
  console.log('');
  console.log('🎙️ Sunday Marathon Orchestrator');
  console.log('================================');
  console.log(`Episodes planned: ${episodes.length}`);
  console.log(`YouTube upload after each episode: ${SUNDAY_UPLOAD_YOUTUBE ? 'yes' : 'no'}`);
  console.log(`Refresh weekly-top10 first: ${RUN_WEEKLY_TOP10_BEFORE_MARATHON ? 'yes' : 'no'}`);
  console.log('');

  if (RUN_WEEKLY_TOP10_BEFORE_MARATHON) {
    console.log('📊 Refreshing weekly Top 10 context before marathon...');
    await runNodeScript('scripts/generate-weekly-top10.mjs');
  }

  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i];
    console.log(`\n▶ Episode ${i + 1}/${episodes.length}: ${ep.label} (${ep.slot})`);

    await runNodeScript('scripts/generate-broadcast.mjs', {
      BROADCAST_FORMAT: 'sunday_special',
      BROADCAST_SLOT: ep.slot,
      SUNDAY_DEEP_DIVE: ep.deepDive,
      ENABLE_EXTERNAL_RESEARCH: ep.enableResearch,
      SKIP_COVER_IMAGE: ep.skipCoverImage,
      REUSE_RECENT_COVER: '1',
      SCRIPT_MIN_LINES: String(ep.minLines),
      SCRIPT_MAX_LINES: String(ep.maxLines),
      PROMO_BUMPER_TRACK: SUNDAY_PROMO_BUMPER_TRACK,
      PROMO_BUMPER_SECONDS: process.env.PROMO_BUMPER_SECONDS || '1.0',
      PROMO_PAUSE_SECONDS: process.env.PROMO_PAUSE_SECONDS || '0.8',
      FORCE_REPLACE_EDITION: FORCE_REPLACE_EDITION ? '1' : '0'
    });

    if (SUNDAY_UPLOAD_YOUTUBE) {
      console.log('🎬 Uploading latest generated episode to YouTube...');
      await runNodeScript('scripts/upload-latest-broadcast-youtube.mjs');
    }

    if (i < episodes.length - 1) {
      console.log('⏳ Cooling down 15 seconds before next episode...');
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  }

  console.log('\n✅ Sunday marathon complete.');
}

main().catch((err) => {
  console.error(`❌ Sunday marathon failed: ${err.message || err}`);
  process.exit(1);
});
