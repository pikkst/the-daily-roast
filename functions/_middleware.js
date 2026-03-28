// ============================================
// Cloudflare Pages Middleware
// 1. Dynamic sitemap.xml generation
// 2. OG meta tag injection for article pages
// ============================================

const SUPABASE_URL = 'https://pbwswrieljqfshnjulzs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBid3N3cmllbGpxZnNobmp1bHpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNzg5ODQsImV4cCI6MjA4OTc1NDk4NH0.buK75E84SRp-By6XCsKgMFnl31nNgj5cZV7e3lEkIiI';
const CATEGORIES = ['politics', 'technology', 'business', 'science', 'entertainment', 'sports', 'world'];

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toRfc822(dateStr) {
  const d = new Date(dateStr);
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad = n => String(n).padStart(2, '0');
  return `${days[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

async function handlePodcastFeed(url) {
  const origin = url.origin;
  const SHOW_IMAGE = `${origin}/icons/icon-512.svg`;
  const SHOW_TITLE = 'The Daily Roast';
  const SHOW_DESC = 'AI-powered satirical news podcast. Hosts Joe & Jane roast the day\'s biggest headlines three times daily — sharp, absurd, and unapologetically artificial.';
  const SHOW_AUTHOR = 'The Daily Roast';
  const SHOW_LANG = 'et';

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/broadcasts?select=id,title,script,audio_url,cover_image_url,duration_seconds,created_at,category_summary&published=eq.true&order=created_at.desc&limit=100`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const broadcasts = await res.json();

    // Use the most recent broadcast's cover as the show art if available
    const showImage = (Array.isArray(broadcasts) && broadcasts[0]?.cover_image_url)
      ? broadcasts[0].cover_image_url
      : SHOW_IMAGE;

    const lastBuildDate = (Array.isArray(broadcasts) && broadcasts[0]?.created_at)
      ? toRfc822(broadcasts[0].created_at)
      : toRfc822(new Date().toISOString());

    let items = '';
    if (Array.isArray(broadcasts)) {
      for (const b of broadcasts) {
        if (!b.audio_url) continue;
        const epTitle = escapeXml(b.title || 'Daily Roast Episode');
        const epDesc = escapeXml(
          b.script
            ? b.script.substring(0, 400).replace(/\n/g, ' ') + '…'
            : 'Tune in to today\'s Daily Roast broadcast.'
        );
        const pubDate = toRfc822(b.created_at);
        const guid = `daily-roast-broadcast-${b.id}`;
        const duration = formatDuration(b.duration_seconds);
        const epImage = escapeXml(b.cover_image_url || showImage);
        const audioUrl = escapeXml(b.audio_url);

        items += `
    <item>
      <title>${epTitle}</title>
      <description>${epDesc}</description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="false">${guid}</guid>
      <enclosure url="${audioUrl}" length="0" type="audio/mpeg"/>
      <link>${escapeXml(origin)}/radio</link>
      <itunes:title>${epTitle}</itunes:title>
      <itunes:summary>${epDesc}</itunes:summary>
      <itunes:author>${escapeXml(SHOW_AUTHOR)}</itunes:author>
      <itunes:duration>${duration}</itunes:duration>
      <itunes:image href="${epImage}"/>
      <itunes:explicit>no</itunes:explicit>
    </item>`;
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SHOW_TITLE)}</title>
    <link>${escapeXml(origin)}/radio</link>
    <language>${SHOW_LANG}</language>
    <description>${escapeXml(SHOW_DESC)}</description>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${escapeXml(origin)}/podcast.xml" rel="self" type="application/rss+xml"/>
    <itunes:title>${escapeXml(SHOW_TITLE)}</itunes:title>
    <itunes:author>${escapeXml(SHOW_AUTHOR)}</itunes:author>
    <itunes:summary>${escapeXml(SHOW_DESC)}</itunes:summary>
    <itunes:image href="${escapeXml(showImage)}"/>
    <itunes:category text="Comedy"/>
    <itunes:category text="News">
      <itunes:category text="Daily News"/>
    </itunes:category>
    <itunes:explicit>no</itunes:explicit>
    <itunes:type>episodic</itunes:type>${items}
  </channel>
</rss>`;

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=1800',
        'X-Content-Type-Options': 'nosniff',
      }
    });
  } catch (err) {
    return new Response(`<?xml version="1.0"?><rss version="2.0"><channel><title>The Daily Roast</title></channel></rss>`, {
      status: 200, headers: { 'Content-Type': 'application/rss+xml' }
    });
  }
}

async function handleSitemap(url) {
  const origin = url.origin;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/articles?select=slug,created_at,updated_at&order=created_at.desc&limit=1000`,
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const articles = await res.json();

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${origin}/quiz</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>
  <url><loc>${origin}/radio</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`;

    for (const cat of CATEGORIES) {
      xml += `\n  <url><loc>${origin}/?cat=${cat}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`;
    }

    if (Array.isArray(articles)) {
      for (const a of articles) {
        const lastmod = new Date(a.updated_at || a.created_at).toISOString().split('T')[0];
        xml += `\n  <url><loc>${origin}/article?slug=${a.slug}</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`;
      }
    }
    xml += '\n</urlset>';
    return new Response(xml, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  } catch (err) {
    return new Response('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', {
      status: 200, headers: { 'Content-Type': 'application/xml' }
    });
  }
}

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // --- Dynamic Sitemap ---
  if (url.pathname === '/sitemap.xml' || url.pathname === '/sitemap') {
    return handleSitemap(url);
  }

  // --- Podcast RSS Feed — 301 → Podbean canonical feed ---
  if (url.pathname === '/podcast.xml' || url.pathname === '/feed' || url.pathname === '/rss') {
    return Response.redirect('https://feed.podbean.com/huntersest/feed.xml', 301);
  }

  // --- Radio OG injection ---
  if (url.pathname === '/radio' || url.pathname.endsWith('/radio.html')) {
    const response = await context.next();
    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('text/html')) return response;
    let html = await response.text();
    try {
      const apiRes = await fetch(
        `${SUPABASE_URL}/rest/v1/broadcasts?select=title,cover_image_url,created_at&published=eq.true&order=created_at.desc&limit=1`,
        { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      const broadcasts = await apiRes.json();
      if (broadcasts && broadcasts[0]) {
        const b = broadcasts[0];
        const title = escapeHtml(b.title || 'Daily Roast Radio');
        const desc = 'Tune in to today\'s AI comedy broadcast — hosts Joe \u0026 Jane roast the biggest headlines!';
        const img = b.cover_image_url || 'https://picsum.photos/seed/daily-roast-radio/1200/630';
        html = html.replace(/<title[^>]*>.*?<\/title>/, `<title>${title}</title>`);
        html = html.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${title}">`);
        html = html.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${desc}">`);
        html = html.replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${escapeHtml(img)}">`);
        html = html.replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${title}">`);
        html = html.replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${desc}">`);
      }
    } catch (err) { /* ignore */ }
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // --- Article OG injection ---
  if (!(url.pathname === '/article' || url.pathname.endsWith('/article.html')) || !url.searchParams.get('slug')) {
    return context.next();
  }

  const slug = url.searchParams.get('slug');

  // Fetch the original static HTML
  const response = await context.next();
  const contentType = response.headers.get('Content-Type') || '';

  // Only process HTML responses
  if (!contentType.includes('text/html')) {
    return response;
  }

  let html = await response.text();

  // If HTML is empty, something went wrong — just pass through
  if (!html || html.length < 100) {
    return response;
  }

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
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const article = articles[0];
    const articleUrl = `${url.origin}/article?slug=${encodeURIComponent(slug)}`;
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

    // Inject og:url, og:site_name, and twitter:image after og:image
    const ogImageTag = `<meta property="og:image" content="${escapeHtml(image)}">`;
    html = html.replace(
      ogImageTag,
      `${ogImageTag}\n  <meta property="og:url" content="${escapeHtml(articleUrl)}">\n  <meta property="og:site_name" content="The Daily Roast">\n  <meta name="twitter:image" content="${escapeHtml(image)}">`
    );

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    console.error('OG injection error:', err);
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}
