// Migration: Add reactions + quiz tables
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const statements = [
  `CREATE TABLE IF NOT EXISTS article_reactions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    reaction_type TEXT NOT NULL CHECK (reaction_type IN ('fire', 'skull', 'laugh', 'shock', 'cap')),
    session_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reactions_article_type ON article_reactions(article_id, reaction_type)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_dedup ON article_reactions(article_id, reaction_type, session_id)`,
  `ALTER TABLE article_reactions ENABLE ROW LEVEL SECURITY`,
  `CREATE TABLE IF NOT EXISTS quiz_scores (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    score INT NOT NULL,
    total INT NOT NULL,
    played_at TIMESTAMPTZ DEFAULT NOW(),
    session_id TEXT NOT NULL
  )`,
  `ALTER TABLE quiz_scores ENABLE ROW LEVEL SECURITY`,
];

for (const sql of statements) {
  const { error } = await db.rpc('exec_sql', { query: sql });
  if (error) {
    console.log(`Note: ${sql.slice(0, 50)}... - ${error.message}`);
  } else {
    console.log(`✅ ${sql.slice(0, 50)}...`);
  }
}

// Test by inserting/selecting
const { error: testErr } = await db.from('article_reactions').select('*').limit(1);
if (testErr) {
  console.log('Table test failed:', testErr.message);
  console.log('\n⚠️  Please run this SQL directly in Supabase SQL Editor:');
  console.log('='.repeat(60));
  console.log(statements.join(';\n\n') + ';');
} else {
  console.log('\n✅ article_reactions table ready!');
}
