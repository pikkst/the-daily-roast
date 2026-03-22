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
    loadArticles();
    loadTrending();
    setupLoadMore();
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
          `<a href="article.html#${a.slug}" style="color:white;text-decoration:none;">${a.title}</a>`
        ).join(' &nbsp;&nbsp;🔥&nbsp;&nbsp; ');
        tickerEl.innerHTML = `<span>${headlines}</span>`;
      }
    } catch (err) {
      console.error('Error updating ticker:', err);
    }
  }

  // ---------- Trending / Most Roasted ----------

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
          const catColor = article.category_color || '#e63946';
          return `
            <a href="article.html#${article.slug}" class="trending-item">
              <span class="trending-rank">#${i + 1}</span>
              <div class="trending-info">
                <span class="trending-category" style="color: ${catColor};">${getCategoryIcon(article.category_slug)} ${article.category_name || 'News'}</span>
                <h4 class="trending-title">${article.title}</h4>
                <span class="trending-views">${(article.views || 0).toLocaleString()} views · ${timeAgo(article.created_at)}</span>
              </div>
              ${article.image_url ? `<img class="trending-thumb" src="${article.image_url}" alt="">` : ''}
            </a>
          `;
        }).join('');
        section.style.display = 'block';
      }
    } catch (err) {
      console.error('Error loading trending:', err);
    }
  }

  // ---------- Render Functions ----------

  function renderFeatured(article) {
    const catSlug = article.category_slug || 'default';
    const catColor = article.category_color || '#e63946';
    const catIcon = getCategoryIcon(catSlug);
    const imageUrl = getImageUrl(article);
    const gradient = getCategoryColor(catSlug);

    return `
      <a href="article.html#${article.slug}" class="featured-article" data-slug="${article.slug}">
        <div class="featured-image">
          ${article.image_url 
            ? `<img src="${imageUrl}" alt="${article.image_alt || article.title}" loading="lazy">`
            : `<div class="featured-image-gradient" style="background: ${gradient};">${catIcon}</div>`
          }
        </div>
        <div class="featured-content">
          <div class="featured-badge">
            <span style="color: ${catColor};">${catIcon} ${article.category_name || 'News'}</span>
            <span style="color: var(--color-accent);">★ FEATURED</span>
          </div>
          <h2 class="featured-title">${article.title}</h2>
          <p class="featured-excerpt">${article.excerpt}</p>
          <div class="featured-meta">
            <span class="featured-category-tag" style="background: ${catColor};">${article.category_name || 'News'}</span>
            <span>${timeAgo(article.created_at)}</span>
            <span>·</span>
            <span>${article.reading_time || 3} min read</span>
            <span>·</span>
            <span>By ${article.author || 'AI Correspondent'}</span>
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

    return `
      <div class="article-card">
        <a href="article.html#${article.slug}">
          <div class="card-image">
            <span class="card-category" style="background: ${catColor};">${article.category_name || 'News'}</span>
            ${article.image_url
              ? `<img src="${article.image_url}" alt="${article.image_alt || article.title}" loading="lazy">`
              : `<div class="card-image-gradient" style="background: ${gradient};">${catIcon}</div>`
            }
          </div>
          <div class="card-content">
            <h3 class="card-title">${article.title}</h3>
            <p class="card-excerpt">${article.excerpt}</p>
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
