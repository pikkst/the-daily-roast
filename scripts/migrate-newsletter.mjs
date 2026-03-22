// ============================================
// Migration: Create newsletter_subscribers table
// ============================================
// Run: node scripts/migrate-newsletter.mjs

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pbwswrieljqfshnjulzs.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY is required');
  process.exit(1);
}

async function query(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ query: sql })
  });
  return res;
}

async function migrate() {
  console.log('🗄️  Creating newsletter_subscribers table...');

  // Use raw SQL via Supabase SQL endpoint
  const sql = `
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      email text NOT NULL UNIQUE,
      name text,
      subscribed_at timestamptz DEFAULT now(),
      confirmed boolean DEFAULT false,
      unsubscribed boolean DEFAULT false,
      unsubscribed_at timestamptz,
      source text DEFAULT 'website'
    );

    -- Index for fast lookup
    CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter_subscribers(email);
    CREATE INDEX IF NOT EXISTS idx_newsletter_active ON newsletter_subscribers(unsubscribed, confirmed);
    
    -- Enable RLS
    ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;
    
    -- Policy: anon can INSERT (subscribe)
    CREATE POLICY IF NOT EXISTS "Anyone can subscribe" ON newsletter_subscribers
      FOR INSERT TO anon WITH CHECK (true);
    
    -- Policy: only service role can read/update/delete
    CREATE POLICY IF NOT EXISTS "Service role full access" ON newsletter_subscribers
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  `;

  // Supabase doesn't have a direct SQL endpoint via REST for arbitrary SQL,
  // so we use the management API or psql. Let's use the pg endpoint instead.
  // Actually, let's just use fetch to the SQL editor endpoint:
  
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    },
    body: JSON.stringify({})
  });

  // If RPC doesn't work, try creating via individual REST calls
  // First, check if table exists
  const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/newsletter_subscribers?select=id&limit=1`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  });

  if (checkRes.ok) {
    console.log('✅ Table newsletter_subscribers already exists!');
    return;
  }

  // Table doesn't exist - need to create via Supabase Dashboard SQL Editor
  // or via the management API
  console.log('⚠️  Table does not exist yet.');
  console.log('');
  console.log('Please run this SQL in the Supabase Dashboard SQL Editor:');
  console.log('   https://supabase.com/dashboard/project/pbwswrieljqfshnjulzs/sql');
  console.log('');
  console.log('--- COPY BELOW ---');
  console.log(sql);
  console.log('--- END ---');
  console.log('');
  console.log('After running the SQL, this migration check will pass.');
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
