// ============================================
// Migration helper: newsletter_subscribers
// ============================================
// Run: node scripts/migrate-newsletter.mjs

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  process.exit(1);
}

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

CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_newsletter_active ON newsletter_subscribers(unsubscribed, confirmed);

ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can subscribe" ON newsletter_subscribers;
CREATE POLICY "Anyone can subscribe" ON newsletter_subscribers
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON newsletter_subscribers;
CREATE POLICY "Service role full access" ON newsletter_subscribers
  FOR ALL TO service_role USING (true) WITH CHECK (true);
`;

async function migrate() {
  console.log('🗄️ Checking newsletter_subscribers table...');

  const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/newsletter_subscribers?select=id&limit=1`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  });

  if (checkRes.ok) {
    console.log('✅ Table newsletter_subscribers already exists.');
    return;
  }

  console.log('⚠️ Table missing or inaccessible via REST.');
  console.log('Run the SQL below in Supabase SQL Editor:');
  console.log('https://supabase.com/dashboard/project/pbwswrieljqfshnjulzs/sql');
  console.log('--- COPY BELOW ---');
  console.log(sql);
  console.log('--- END ---');
}

migrate().catch(err => {
  console.error('❌ Migration check failed:', err);
  process.exit(1);
});
