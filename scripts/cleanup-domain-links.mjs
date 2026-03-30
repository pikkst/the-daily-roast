// ============================================
// The Daily Roast — Domain Link Cleanup
// ============================================
// Rewrites old .dev / pages.dev links in DB text fields
// to the canonical production domain: https://thedailyroast.online
//
// Usage:
//   node scripts/cleanup-domain-links.mjs           (dry run)
//   node scripts/cleanup-domain-links.mjs --apply   (write changes)
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const CANONICAL_ORIGIN = 'https://thedailyroast.online';

const TARGETS = [
  {
    table: 'articles',
    idColumn: 'id',
    columns: ['content', 'excerpt', 'meta_description']
  },
  {
    table: 'broadcasts',
    idColumn: 'id',
    columns: ['script', 'youtube_upload_error', 'title']
  },
  {
    table: 'generation_log',
    idColumn: 'id',
    columns: ['source_url', 'error_message']
  },
  {
    table: 'page_views',
    idColumn: 'id',
    columns: ['referrer']
  }
];

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function rewriteString(input) {
  if (typeof input !== 'string' || input.length === 0) return input;

  let out = input;

  // Exact old production host variants
  out = out.replace(/https?:\/\/(?:www\.)?thedailyroast\.dev/gi, CANONICAL_ORIGIN);

  // Old Cloudflare preview domains for this project name
  out = out.replace(/https?:\/\/[a-z0-9-]*daily[-]?roast[a-z0-9-]*\.pages\.dev/gi, CANONICAL_ORIGIN);

  // Bare host mentions without protocol
  out = out.replace(/\b(?:www\.)?thedailyroast\.dev\b/gi, 'thedailyroast.online');
  out = out.replace(/\b[a-z0-9-]*daily[-]?roast[a-z0-9-]*\.pages\.dev\b/gi, 'thedailyroast.online');

  return out;
}

function rewriteDeep(value) {
  if (typeof value === 'string') {
    return rewriteString(value);
  }
  if (Array.isArray(value)) {
    return value.map(rewriteDeep);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = rewriteDeep(v);
    }
    return out;
  }
  return value;
}

function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function processTarget(target) {
  const { table, idColumn, columns } = target;
  const selectCols = [idColumn, ...columns].join(', ');

  let from = 0;
  const pageSize = 500;
  let scanned = 0;
  let changed = 0;
  let updated = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await db
      .from(table)
      .select(selectCols)
      .order(idColumn, { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`${table}: select failed: ${error.message}`);
    }

    if (!data || data.length === 0) break;

    scanned += data.length;

    for (const row of data) {
      const patch = {};
      for (const col of columns) {
        const original = row[col];
        if (original == null) continue;

        const next = rewriteDeep(original);
        if (!valuesEqual(original, next)) {
          patch[col] = next;
        }
      }

      if (Object.keys(patch).length === 0) continue;
      changed += 1;

      if (VERBOSE || !APPLY) {
        console.log(`- ${table}.${row[idColumn]} changed columns: ${Object.keys(patch).join(', ')}`);
      }

      if (APPLY) {
        const { error: updateError } = await db
          .from(table)
          .update(patch)
          .eq(idColumn, row[idColumn]);

        if (updateError) {
          console.warn(`  ! update failed for ${table}.${row[idColumn]}: ${updateError.message}`);
        } else {
          updated += 1;
        }
      }
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return { table, scanned, changed, updated };
}

async function main() {
  console.log('Domain cleanup mode:', APPLY ? 'APPLY' : 'DRY-RUN');
  console.log('Canonical origin:', CANONICAL_ORIGIN);

  const results = [];
  for (const target of TARGETS) {
    console.log(`\nScanning ${target.table} ...`);
    const result = await processTarget(target);
    results.push(result);
    console.log(`  scanned=${result.scanned}, changed=${result.changed}, updated=${result.updated}`);
  }

  const totalScanned = results.reduce((sum, r) => sum + r.scanned, 0);
  const totalChanged = results.reduce((sum, r) => sum + r.changed, 0);
  const totalUpdated = results.reduce((sum, r) => sum + r.updated, 0);

  console.log('\nSummary');
  console.log(`  scanned rows: ${totalScanned}`);
  console.log(`  changed rows: ${totalChanged}`);
  console.log(`  updated rows: ${totalUpdated}`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write changes.');
  }
}

main().catch((err) => {
  console.error('\nCleanup failed:', err.message);
  process.exit(1);
});
