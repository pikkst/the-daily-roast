// ============================================
// The Daily Roast — Homepage Logic
// ============================================

(function() {
  let currentPage = 0;
  let currentCategory = null;
  let allLoaded = false;

  // Wait for Supabase to be ready
  window.addEventListener('supabase-ready', init);
  // Also try on DOMContentLoaded in case Supabase loaded first
  document.addEventListener('DOMContentLoaded', () => {
    if (getSupabase()) init();
    setupNav();
    setHeaderDate();
  });

  let initialized = false;
  function init() {
    if (initialized) return;
    initialized = true;
    
    // Parse URL params for category filter
    const params = new URLSearchParams(window.location.search);
    currentCategory = params.get('cat');
    
    // Highlight active nav
    highlightNav(currentCategory);
    
    // Update section title
    updateSectionTitle(currentCategory);
    
    // Load content
    loadFeatured();
    loadRoastOfTheDay();
    loadWeeklyTeaser();
    loadArticles();
    loadTrending();
    setupReturningSupportPrompt();
    setupLoadMore();
    setupArticleClickTracking();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function safeSlug(slug) {
    return encodeURIComponent(String(slug || ''));
  }

  function safeImageUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^javascript:/i.test(raw)) return '';
    return raw;
  }

  function setupReturningSupportPrompt() {
    const section = document.getElementById('returning-support');
    const dismissBtn = document.getElementById('returning-support-dismiss');
    if (!section) return;

    const now = Date.now();
    const MS_IN_DAY = 24 * 60 * 60 * 1000;
    const stateKey = 'tdr_visit_state';
    const dismissedUntilKey = 'tdr_support_dismissed_until';

    let state = { count: 0, firstSeen: now, lastSeen: now };
    try {
      const raw = localStorage.getItem(stateKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          state = {
            count: Number(parsed.count) || 0,
            firstSeen: Number(parsed.firstSeen) || now,
            lastSeen: Number(parsed.lastSeen) || now
          };
        }
      }
    } catch (err) {
      console.warn('Unable to read visit state:', err);
    }

    state.count += 1;
    state.lastSeen = now;

    try {
      localStorage.setItem(stateKey, JSON.stringify(state));
    } catch (err) {
      console.warn('Unable to save visit state:', err);
    }

    const dismissedUntil = Number(localStorage.getItem(dismissedUntilKey) || 0);
    const isDismissed = dismissedUntil > now;

    const shouldShow = state.count >= 3 && !isDismissed;
    if (!shouldShow) return;

    // Delay a bit so the banner appears after first content paint.
    setTimeout(() => {
      section.style.display = 'block';
    }, 1200);

    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        section.style.display = 'none';
        const nextTime = now + 7 * MS_IN_DAY;
        localStorage.setItem(dismissedUntilKey, String(nextTime));
      });
    }
  }

  function setHeaderDate() {
    const dateEl = document.getElementById('header-date');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
    }
  }

  function setupNav() {
    // Mobile nav toggle
    const toggle = document.getElementById('nav-toggle');
    const navList = document.getElementById('nav-list');
    if (toggle && navList) {
      toggle.addEventListener('click', () => {
        navList.classList.toggle('open');
      });
    }
  }

  function highlightNav(category) {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.remove('active');
      const linkCat = link.dataset.category;
      if ((!category && linkCat === 'all') || linkCat === category) {
        link.classList.add('active');
      }
    });
  }

  function updateSectionTitle(category) {
    const titleEl = document.getElementById('section-title');
    if (!titleEl) return;
    if (category) {
      const name = category.charAt(0).toUpperCase() + category.slice(1);
      titleEl.textContent = `${getCategoryIcon(category)} ${name} Roasts`;
    } else {
      titleEl.textContent = 'Latest Roasts';
    }
  }

  async function loadFeatured() {
    const section = document.getElementById('featured-section');
    if (!section) return;

    const db = getSupabase();
    if (!db) return;

    try {
      let query = db
        .from('articles_with_category')
        .select('*')
        .eq('featured', true)
        .order('created_at', { ascending: false })
        .limit(1);

      if (currentCategory) {
        query = query.eq('category_slug', currentCategory);
      }

      const { data, error } = await query;

      if (error) throw error;

      if (data && data.length > 0) {
        section.innerHTML = renderFeatured(data[0]);
      } else {
        // If no featured, try to get the latest article
        let fallbackQuery = db
          .from('articles_with_category')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1);

        if (currentCategory) {
          fallbackQuery = fallbackQuery.eq('category_slug', currentCategory);
        }

        const { data: fallbackData } = await fallbackQuery;
        if (fallbackData && fallbackData.length > 0) {
          section.innerHTML = renderFeatured(fallbackData[0]);
        } else {
          section.innerHTML = '';
        }
      }

      // Update ticker with recent headlines
      updateTicker();
    } catch (err) {
      console.error('Error loading featured:', err);
      section.innerHTML = '';
    }
  }

  async function loadArticles(append = false) {
    const grid = document.getElementById('articles-grid');
    const loadMoreWrap = document.getElementById('load-more-wrap');
    const emptyState = document.getElementById('empty-state');
    if (!grid) return;

    const db = getSupabase();
    if (!db) return;

    const from = currentPage * CONFIG.ARTICLES_PER_PAGE;
    const to = from + CONFIG.ARTICLES_PER_PAGE - 1;

    try {
      let query = db
        .from('articles_with_category')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (currentCategory) {
        query = query.eq('category_slug', currentCategory);
      }

      const { data, error } = await query;

      if (error) throw error;

      if (!append) {
        grid.innerHTML = '';
      }

      if (data && data.length > 0) {
        // Skip the featured article on first page
        const featured = document.querySelector('.featured-article');
        const featuredSlug = featured ? featured.dataset.slug : null;
        
        const articles = data.filter(a => a.slug !== featuredSlug);
        
        articles.forEach(article => {
          grid.innerHTML += renderCard(article);
        });

        // Show/hide load more
        if (data.length < CONFIG.ARTICLES_PER_PAGE) {
          allLoaded = true;
          if (loadMoreWrap) loadMoreWrap.style.display = 'none';
        } else {
          if (loadMoreWrap) loadMoreWrap.style.display = 'block';
        }

        if (emptyState) emptyState.style.display = 'none';
      } else if (!append && currentPage === 0) {
        if (emptyState) emptyState.style.display = 'block';
        if (loadMoreWrap) loadMoreWrap.style.display = 'none';
      }
    } catch (err) {
      console.error('Error loading articles:', err);
      if (currentPage === 0 && !append) {
        grid.innerHTML = '<p style="text-align:center; color: var(--text-secondary); grid-column: 1/-1; padding: 40px;">Unable to load articles. Please try again later.</p>';
      }
    }
  }

  function setupLoadMore() {
    const btn = document.getElementById('load-more-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        if (!allLoaded) {
          currentPage++;
          loadArticles(true);
        }
      });
    }
  }

  function setupArticleClickTracking() {
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[href^="/article/"]');
      if (!link) return;
      trackEvent('article_click', {
        link_path: link.getAttribute('href') || '',
        page_path: window.location.pathname
      });
    });
  }

  async function updateTicker() {
    const tickerEl = document.getElementById('ticker-content');
    if (!tickerEl) return;

    const db = getSupabase();
    if (!db) return;

    try {
      const { data } = await db
        .from('articles_with_category')
        .select('title, slug')
        .order('created_at', { ascending: false })
        .limit(5);

      if (data && data.length > 0) {
        const headlines = data.map(a => 
          `<a href="${getArticlePath(a.slug)}" style="color:white;text-decoration:none;">${escapeHtml(a.title)}</a>`
        ).join(' &nbsp;&nbsp;🔥&nbsp;&nbsp; ');
        tickerEl.innerHTML = `<span>${headlines}</span>`;
      }
    } catch (err) {
      console.error('Error updating ticker:', err);
    }
  }

  // ---------- Trending / Most Roasted ----------

  async function loadRoastOfTheDay() {
    const section = document.getElementById('roast-day-section');
    const cardWrap = document.getElementById('roast-day-card');
    if (!section || !cardWrap) return;

    const db = getSupabase();
    if (!db) return;

    const todayKey = getUTCDateKey();

    try {
      const { data: lockRows, error: lockError } = await db
        .from('daily_roast_lock')
        .select('*')
        .eq('lock_date', todayKey)
        .limit(1);

      if (!lockError && lockRows && lockRows.length > 0) {
        const locked = lockRows[0];
        if (!currentCategory || locked.category_slug === currentCategory) {
          cardWrap.innerHTML = renderRoastOfTheDay({
            slug: locked.article_slug,
            title: locked.title,
            excerpt: locked.excerpt,
            image_url: locked.image_url,
            image_alt: locked.image_alt,
            category_slug: locked.category_slug,
            category_name: locked.category_name,
            category_color: locked.category_color,
            views: locked.views_snapshot,
            created_at: locked.source_created_at || locked.locked_at
          });
          section.style.display = 'block';
          return;
        }
      }

      const data = await fetchDynamicRoastCandidate(db);

      if (data) {
        cardWrap.innerHTML = renderRoastOfTheDay(data);
        section.style.display = 'block';
      }
    } catch (err) {
      console.error('Error loading roast of the day:', err);
    }
  }

  async function fetchDynamicRoastCandidate(db) {
    const now = new Date();
    const todayStartUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const tomorrowStartUTC = new Date(todayStartUTC);
    tomorrowStartUTC.setUTCDate(tomorrowStartUTC.getUTCDate() + 1);

    let query = db
      .from('articles_with_category')
      .select('*')
      .gte('created_at', todayStartUTC.toISOString())
      .lt('created_at', tomorrowStartUTC.toISOString())
      .order('views', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);

    if (currentCategory) {
      query = query.eq('category_slug', currentCategory);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (data && data.length > 0) return data[0];

    let fallbackQuery = db
      .from('articles_with_category')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (currentCategory) {
      fallbackQuery = fallbackQuery.eq('category_slug', currentCategory);
    }

    const { data: fallbackData, error: fallbackError } = await fallbackQuery;
    if (fallbackError) throw fallbackError;
    return (fallbackData && fallbackData.length > 0) ? fallbackData[0] : null;
  }

  function getUTCDateKey() {
    return new Date().toISOString().slice(0, 10);
  }

  async function loadTrending() {
    const section = document.getElementById('trending-section');
    const bar = document.getElementById('trending-bar');
    if (!section || !bar) return;

    const db = getSupabase();
    if (!db) return;

    try {
      const { data, error } = await db
        .from('articles_with_category')
        .select('*')
        .order('views', { ascending: false })
        .limit(5);

      if (error) throw error;

      if (data && data.length > 0) {
        bar.innerHTML = data.map((article, i) => {
          const imageUrl = safeImageUrl(article.image_url);
          const safeTitle = escapeHtml(article.title);
          const safeCategoryName = escapeHtml(article.category_name || 'News');
          const catColor = article.category_color || '#e63946';
          return `
            <a href="${getArticlePath(article.slug)}" class="trending-item">
              <span class="trending-rank">#${i + 1}</span>
              <div class="trending-info">
                <span class="trending-category" style="color: ${escapeAttr(catColor)};">${getCategoryIcon(article.category_slug)} ${safeCategoryName}</span>
                <h4 class="trending-title">${safeTitle}</h4>
                <span class="trending-fiction-tag">Parody / Fiction</span>
                <span class="trending-views">${(article.views || 0).toLocaleString()} views · ${timeAgo(article.created_at)}</span>
              </div>
              ${imageUrl ? `<img class="trending-thumb" src="${escapeAttr(imageUrl)}" alt="">` : ''}
            </a>
          `;
        }).join('');
        section.style.display = 'block';
      }
    } catch (err) {
      console.error('Error loading trending:', err);
    }
  }

  async function loadWeeklyTeaser() {
    const section = document.getElementById('weekly-teaser-section');
    const grid = document.getElementById('weekly-teaser-grid');
    if (!section || !grid) return;

    const db = getSupabase();
    if (!db) return;

    try {
      const { data: summaries, error: summaryError } = await db
        .from('weekly_roast_summaries')
        .select('id, week_start_date, week_end_date')
        .order('generated_at', { ascending: false })
        .limit(1);

      if (summaryError || !summaries || summaries.length === 0) return;

      const summary = summaries[0];

      const { data: items, error: itemsError } = await db
        .from('weekly_roast_items')
        .select('rank, article_slug, title, category_slug, views, absurdity_score')
        .eq('summary_id', summary.id)
        .order('rank', { ascending: true })
        .limit(3);

      if (itemsError || !items || items.length === 0) return;

      grid.innerHTML = items.map((item) => `
        <a href="${getArticlePath(item.article_slug)}" class="weekly-teaser-item">
          <div class="weekly-teaser-rank">#${item.rank}</div>
          <div class="weekly-teaser-info">
            <span class="weekly-teaser-cat">${getCategoryIcon(item.category_slug)} ${(item.category_slug || 'news').toUpperCase()}</span>
            <h3 class="weekly-teaser-title">${escapeHtml(item.title)}</h3>
            <div class="weekly-teaser-meta">
              <span>${(item.views || 0).toLocaleString()} views</span>
              <span>·</span>
              <span>Absurdity ${item.absurdity_score || 0}</span>
            </div>
          </div>
        </a>
      `).join('');

      section.style.display = 'block';
    } catch (err) {
      console.error('Error loading weekly teaser:', err);
    }
  }

  // ---------- Render Functions ----------

  function renderFeatured(article) {
    const catSlug = article.category_slug || 'default';
    const catColor = article.category_color || '#e63946';
    const catIcon = getCategoryIcon(catSlug);
    const imageUrl = getImageUrl(article);
    const gradient = getCategoryColor(catSlug);
    const safeTitle = escapeHtml(article.title);
    const safeExcerpt = escapeHtml(article.excerpt);
    const safeAuthor = escapeHtml(article.author || 'AI Correspondent');
    const safeCategory = escapeHtml(article.category_name || 'News');
    const safeImage = safeImageUrl(imageUrl);
    const safeAlt = escapeAttr(article.image_alt || article.title);

    return `
      <a href="${getArticlePath(article.slug)}" class="featured-article" data-slug="${safeSlug(article.slug)}">
        <div class="featured-image">
          ${safeImage
            ? `<img src="${escapeAttr(safeImage)}" alt="${safeAlt}" loading="lazy">`
            : `<div class="featured-image-gradient" style="background: ${gradient};">${catIcon}</div>`
          }
        </div>
        <div class="featured-content">
          <div class="featured-badge">
            <span style="color: ${escapeAttr(catColor)};">${catIcon} ${safeCategory}</span>
            <span style="color: var(--color-accent);">★ FEATURED</span>
          </div>
          <h2 class="featured-title">${safeTitle}</h2>
          <p class="featured-excerpt">${safeExcerpt}</p>
          <div class="featured-meta">
            <span class="featured-category-tag" style="background: ${escapeAttr(catColor)};">${safeCategory}</span>
            <span class="featured-fiction-tag">Parody / Fiction</span>
            <span>${timeAgo(article.created_at)}</span>
            <span>·</span>
            <span>${article.reading_time || 3} min read</span>
            <span>·</span>
            <span>By ${safeAuthor}</span>
          </div>
        </div>
      </a>
    `;
  }

  function renderRoastOfTheDay(article) {
    const catSlug = article.category_slug || 'default';
    const catColor = article.category_color || '#e63946';
    const catIcon = getCategoryIcon(catSlug);
    const imageUrl = getImageUrl(article);
    const safeTitle = escapeHtml(article.title);
    const safeExcerpt = escapeHtml(article.excerpt || 'Today\'s strongest roast, selected from the latest absurd headlines.');
    const safeCategory = escapeHtml(article.category_name || 'News');
    const safeImage = safeImageUrl(imageUrl);
    const safeAlt = escapeAttr(article.image_alt || article.title);

    return `
      <a href="${getArticlePath(article.slug)}" class="roast-day-card">
        <div class="roast-day-image">
          ${safeImage
            ? `<img src="${escapeAttr(safeImage)}" alt="${safeAlt}" loading="lazy">`
            : `<div class="roast-day-image-gradient" style="background: ${getCategoryColor(catSlug)};">${catIcon}</div>`
          }
        </div>
        <div class="roast-day-content">
          <div class="roast-day-topline">
            <span class="roast-day-label">${catIcon} Daily Winner</span>
            <span class="roast-day-views">${(article.views || 0).toLocaleString()} views</span>
          </div>
          <h3 class="roast-day-title">${safeTitle}</h3>
          <p class="roast-day-excerpt">${safeExcerpt}</p>
          <div class="roast-day-meta">
            <span class="featured-category-tag" style="background: ${escapeAttr(catColor)};">${safeCategory}</span>
            <span class="featured-fiction-tag">Parody / Fiction</span>
            <span>${timeAgo(article.created_at)}</span>
          </div>
        </div>
      </a>
    `;
  }

  function renderCard(article) {
    const catSlug = article.category_slug || 'default';
    const catColor = article.category_color || '#e63946';
    const catIcon = getCategoryIcon(catSlug);
    const gradient = getCategoryColor(catSlug);
    const safeTitle = escapeHtml(article.title);
    const safeExcerpt = escapeHtml(article.excerpt);
    const safeCategory = escapeHtml(article.category_name || 'News');
    const safeImage = safeImageUrl(article.image_url);
    const safeAlt = escapeAttr(article.image_alt || article.title);

    return `
      <div class="article-card">
        <a href="${getArticlePath(article.slug)}">
          <div class="card-image">
            <span class="card-category" style="background: ${escapeAttr(catColor)};">${safeCategory}</span>
            <span class="card-fiction-tag">Parody / Fiction</span>
            ${safeImage
              ? `<img src="${escapeAttr(safeImage)}" alt="${safeAlt}" loading="lazy">`
              : `<div class="card-image-gradient" style="background: ${gradient};">${catIcon}</div>`
            }
          </div>
          <div class="card-content">
            <h3 class="card-title">${safeTitle}</h3>
            <p class="card-excerpt">${safeExcerpt}</p>
            <div class="card-meta">
              <div class="card-meta-left">
                <span>${timeAgo(article.created_at)}</span>
                <span>·</span>
                <span>${article.reading_time || 3} min read</span>
              </div>
              <span>${article.views || 0} views</span>
            </div>
          </div>
        </a>
      </div>
    `;
  }
})();
