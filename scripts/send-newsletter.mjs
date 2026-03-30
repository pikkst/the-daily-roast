// ============================================
// The Daily Roast — Weekly Newsletter Sender
// ============================================
// Sends a weekly digest of the best articles to all subscribers.
// Run: node scripts/send-newsletter.mjs
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   RESEND_API_KEY (or SENDGRID_API_KEY)  — for actual email sending
//
// For now: generates the newsletter HTML and logs subscriber count.
// Email sending can be added later with Resend, SendGrid, or AWS SES.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SITE_URL = normalizeSiteUrl(process.env.SITE_URL);

function normalizeSiteUrl(rawValue) {
  const fallback = 'https://thedailyroast.online';
  const raw = String(rawValue || fallback).trim().replace(/\/$/, '');
  if (!raw) return fallback;

  try {
    const url = new URL(raw);
    const host = String(url.hostname || '').toLowerCase();
    if (host.endsWith('.pages.dev') || host.endsWith('.dev')) {
      return fallback;
    }
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return fallback;
  }
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  process.exit(1);
}

// ---------- Supabase helpers ----------

async function supaGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  });
  if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status}`);
  return res.json();
}

// ---------- Get active subscribers ----------

async function getSubscribers() {
  return supaGet('newsletter_subscribers', 'unsubscribed=eq.false&select=id,email,name');
}

// ---------- Get top articles from last 7 days ----------

async function getWeeklyArticles() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return supaGet(
    'articles',
    `published_at=gte.${weekAgo}&order=views.desc&limit=10&select=title,slug,excerpt,category,image_url,views`
  );
}

// ---------- Build newsletter HTML ----------

function buildNewsletterHTML(articles) {
  const articleCards = articles.map((a, i) => `
    <tr>
      <td style="padding: 16px 0; border-bottom: 1px solid #eee;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${a.image_url ? `<td width="120" style="padding-right: 16px; vertical-align: top;">
              <img src="${a.image_url}" alt="" width="120" height="80" style="border-radius: 8px; object-fit: cover; display: block;">
            </td>` : ''}
            <td style="vertical-align: top;">
              <a href="${SITE_URL}/article.html?slug=${a.slug}" style="color: #1a1a2e; text-decoration: none; font-weight: 700; font-size: 16px; line-height: 1.3;">
                ${i + 1}. ${a.title}
              </a>
              <p style="color: #666; font-size: 13px; line-height: 1.4; margin: 6px 0 0;">
                ${a.excerpt ? a.excerpt.substring(0, 120) + '...' : ''}
              </p>
              <span style="color: #999; font-size: 11px; text-transform: uppercase;">${a.category || 'General'} • ${a.views || 0} views</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background: #f5f5f5; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 32px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">🔥 The Daily Roast</h1>
              <p style="color: rgba(255,255,255,0.7); margin: 8px 0 0; font-size: 14px;">Selle nädala parimad roastid</p>
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding: 24px 32px 8px;">
              <p style="color: #333; font-size: 15px; line-height: 1.5; margin: 0;">
                Tere! 👋 Siin on selle nädala kõige tulisemad satiirilised pealkirjad. Naudi lugemist! 🔥
              </p>
            </td>
          </tr>

          <!-- Articles -->
          <tr>
            <td style="padding: 8px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${articleCards}
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 24px 32px; text-align: center;">
              <a href="${SITE_URL}" style="display: inline-block; background: #e63946; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">
                Loe kõiki artikleid →
              </a>
            </td>
          </tr>

          <!-- Support -->
          <tr>
            <td style="padding: 16px 32px; background: #f8f9fa; text-align: center;">
              <p style="color: #666; font-size: 13px; margin: 0 0 8px;">☕ Nauditad The Daily Roasti? Toeta meid!</p>
              <a href="${SITE_URL}/?donation=open" style="color: #e63946; font-weight: 600; font-size: 13px; text-decoration: none;">Toeta alates €2/kuu →</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; border-top: 1px solid #eee; text-align: center;">
              <p style="color: #999; font-size: 11px; line-height: 1.5; margin: 0;">
                Sa said selle meili, sest liitusid The Daily Roast uudiskirjaga.<br>
                <a href="${SITE_URL}/unsubscribe" style="color: #999;">Loobu uudiskirjast</a>
              </p>
              <p style="color: #ccc; font-size: 11px; margin: 8px 0 0;">
                ⚠️ The Daily Roast on satiiriline väljaanne. Kõik artiklid on AI-genereeritud paroodiad.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------- Send via Resend (or log) ----------

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.log(`  📧 [DRY RUN] Would send to: ${to}`);
    return true;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'The Daily Roast <newsletter@thedailyroast.ee>',
        to: [to],
        subject: subject,
        html: html
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`  ❌ Failed to send to ${to}: ${err}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`  ❌ Error sending to ${to}:`, err.message);
    return false;
  }
}

// ---------- Main ----------

async function main() {
  console.log('📬 The Daily Roast — Weekly Newsletter');
  console.log('======================================\n');

  // Get subscribers
  let subscribers;
  try {
    subscribers = await getSubscribers();
  } catch (err) {
    console.log('⚠️  newsletter_subscribers table not found yet.');
    console.log('   Run the SQL in Supabase Dashboard first.');
    console.log('   See: scripts/migrate-newsletter.mjs\n');
    return;
  }

  console.log(`📋 Active subscribers: ${subscribers.length}`);

  if (subscribers.length === 0) {
    console.log('   No subscribers yet. Skipping.\n');
    return;
  }

  // Get articles
  const articles = await getWeeklyArticles();
  console.log(`📰 Articles from last 7 days: ${articles.length}`);

  if (articles.length === 0) {
    console.log('   No articles this week. Skipping.\n');
    return;
  }

  // Build email
  const html = buildNewsletterHTML(articles);
  const weekStr = new Date().toLocaleDateString('et-EE', { day: 'numeric', month: 'long' });
  const subject = `🔥 The Daily Roast — Nädala parimad roastid (${weekStr})`;

  console.log(`\n📤 Sending newsletter to ${subscribers.length} subscribers...`);

  if (!RESEND_API_KEY) {
    console.log('\n⚠️  RESEND_API_KEY not set — running in DRY RUN mode.');
    console.log('   Set RESEND_API_KEY to actually send emails.\n');
  }

  let sent = 0;
  let failed = 0;

  for (const sub of subscribers) {
    const ok = await sendEmail(sub.email, subject, html);
    if (ok) sent++;
    else failed++;
  }

  console.log(`\n✅ Done! Sent: ${sent}, Failed: ${failed}`);
}

main().catch(err => {
  console.error('❌ Newsletter failed:', err);
  process.exit(1);
});
