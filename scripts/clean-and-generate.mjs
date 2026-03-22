// ============================================
// The Daily Roast — Clean & Generate Fresh Articles
//
// This script:
// 1. Removes all seeded/demo articles
// 2. Clears generation log
// 3. Generates fresh satirical articles from real news
// ============================================

import { createClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';

// ---------- Config ----------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyCBcS93oGhtwDfskBakM73ZMMf5UpE-mjw';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pbwswrieljqfshnjulzs.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function cleanAndGenerate() {
  console.log('');
  console.log('🧹🔥 THE DAILY ROAST — Clean & Fresh Start');
  console.log('==========================================\n');

  // ---- Step 1: Delete all existing articles ----
  console.log('🗑️  Removing old/seeded articles...');
  
  // Delete page views first (foreign key)
  const { error: pvErr } = await db.from('page_views').delete().neq('id', 0);
  if (pvErr) console.warn('  ⚠️  page_views:', pvErr.message);
  else console.log('  ✅ Cleared page_views');

  // Delete articles
  const { data: deleted, error: artErr } = await db
    .from('articles')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000') // delete all
    .select('id');
  
  if (artErr) console.warn('  ⚠️  articles:', artErr.message);
  else console.log(`  ✅ Removed ${deleted?.length || 0} articles`);

  // Clear generation log
  const { error: logErr } = await db.from('generation_log').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (logErr) console.warn('  ⚠️  generation_log:', logErr.message);
  else console.log('  ✅ Cleared generation log');

  console.log('\n✨ Clean slate ready!\n');

  // ---- Step 2: Now run the full generation pipeline ----
  console.log('🚀 Starting fresh article generation...\n');
}

cleanAndGenerate()
  .then(async () => {
    // Import and run the main generation script
    const { execSync } = await import('child_process');
    
    const env = {
      ...process.env,
      GEMINI_API_KEY,
      SUPABASE_URL,
      SUPABASE_SERVICE_KEY
    };

    try {
      execSync('node scripts/generate-articles.mjs', {
        stdio: 'inherit',
        env,
        cwd: process.cwd()
      });
    } catch (err) {
      console.error('❌ Generation failed:', err.message);
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('💥 Error:', err);
    process.exit(1);
  });
