// ============================================
// Cloudflare Pages Function — article.html
// Injects Open Graph meta tags for social media crawlers
// ============================================

const SUPABASE_URL = 'https://pbwswrieljqfshnjulzs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBid3N3cmllbGpxZnNobmp1bHpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNzg5ODQsImV4cCI6MjA4OTc1NDk4NH0.buK75E84SRp-By6XCsKgMFnl31nNgj5cZV7e3lEkIiI';

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const slug = url.searchParams.get('slug');

  // No slug? Just serve the static page as-is
  if (!slug) {
    return context.next();
  }

  // Fetch the original static HTML
  const response = await context.next();
  let html = await response.text();

  // Build new headers with correct Content-Type
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');

  try {
    // Fetch article data from Supabase REST API
    const apiRes = await fetch(
      `${SUPABASE_URL}/rest/v1/articles?slug=eq.${encodeURIComponent(slug)}&select=title,excerpt,image_url,meta_description,author,created_at&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    const articles = await apiRes.json();

    if (!articles || !articles[0]) {
      return new Response(html, { status: 200, headers });
    }

    const article = articles[0];
    const articleUrl = `${url.origin}/article.html?slug=${encodeURIComponent(slug)}`;
    const title = escapeHtml(article.title);
    const description = escapeHtml(article.meta_description || article.excerpt);
    const image = article.image_url || `https://picsum.photos/seed/${slug}/1200/630`;

    // Replace OG meta tags
    html = html.replace(
      /<meta property="og:title"[^>]*>/,
      `<meta property="og:title" content="${title}">`
    );
    html = html.replace(
      /<meta property="og:description"[^>]*>/,
      `<meta property="og:description" content="${description}">`
    );
    html = html.replace(
      /<meta property="og:image"[^>]*>/,
      `<meta property="og:image" content="${escapeHtml(image)}">`
    );

    // Replace Twitter Card meta tags
    html = html.replace(
      /<meta name="twitter:title"[^>]*>/,
      `<meta name="twitter:title" content="${title}">`
    );
    html = html.replace(
      /<meta name="twitter:description"[^>]*>/,
      `<meta name="twitter:description" content="${description}">`
    );

    // Replace page title
    html = html.replace(
      /<title[^>]*>.*?<\/title>/,
      `<title>${title} — The Daily Roast</title>`
    );

    // Replace meta description
    html = html.replace(
      /<meta name="description"[^>]*>/,
      `<meta name="description" content="${description}">`
    );

    // Inject og:url, og:site_name, and twitter:image right after og:image
    const ogImageTag = `<meta property="og:image" content="${escapeHtml(image)}">`;
    html = html.replace(
      ogImageTag,
      `${ogImageTag}\n  <meta property="og:url" content="${escapeHtml(articleUrl)}">\n  <meta property="og:site_name" content="The Daily Roast">\n  <meta name="twitter:image" content="${escapeHtml(image)}">`
    );

    return new Response(html, { status: 200, headers });
  } catch (err) {
    // On error, return unmodified HTML
    console.error('OG injection error:', err);
    return new Response(html, { status: 200, headers });
  }
}
