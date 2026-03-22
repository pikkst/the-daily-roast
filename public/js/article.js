// ============================================
// The Daily Roast — Article Page Logic
// ============================================

(function() {
  // Wait for Supabase to be ready
  window.addEventListener('supabase-ready', init);
  document.addEventListener('DOMContentLoaded', () => {
    if (getSupabase()) init();
  });

  let initialized = false;
  function init() {
    if (initialized) return;
    initialized = true;

    // Get slug from query parameter ?slug=xxx
    const params = new URLSearchParams(window.location.search);
    let slug = params.get('slug');

    // Fallback: support old hash URLs (article.html#slug) and redirect
    if (!slug && window.location.hash) {
      slug = window.location.hash.slice(1);
      if (slug) {
        // Redirect to clean URL for proper OG tags
        window.location.replace(`/article?slug=${slug}`);
        return;
      }
    }

    console.log('[Daily Roast] slug:', slug);

    if (!slug) {
      showNotFound();
      return;
    }

    loadArticle(slug);
  }

  async function loadArticle(slug) {
    const db = getSupabase();
    if (!db) return;

    try {
      const { data, error } = await db
        .from('articles_with_category')
        .select('*')
        .eq('slug', slug)
        .single();

      if (error) {
        console.error('[Daily Roast] Supabase query error:', error);
      }

      if (error || !data) {
        // Fallback: try querying articles table directly
        console.log('[Daily Roast] Trying direct articles table query...');
        const { data: directData, error: directError } = await db
          .from('articles')
          .select('*, categories!articles_category_id_fkey(name, slug, color, icon)')
          .eq('slug', slug)
          .single();

        if (directError) {
          console.error('[Daily Roast] Direct query also failed:', directError);
          showNotFound();
          return;
        }

        if (!directData) {
          showNotFound();
          return;
        }

        // Map foreign key join to flat fields
        const mapped = {
          ...directData,
          category_name: directData.categories?.name,
          category_slug: directData.categories?.slug,
          category_color: directData.categories?.color,
          category_icon: directData.categories?.icon,
        };
        delete mapped.categories;
        renderArticle(mapped);
        trackView(slug);
        loadRelated(mapped.category_id, mapped.id);
        return;
      }

      renderArticle(data);
      trackView(slug);
      loadRelated(data.category_id, data.id);
    } catch (err) {
      console.error('Error loading article:', err);
      showNotFound();
    }
  }

  function renderArticle(article) {
    const catSlug = article.category_slug || 'default';
    const catColor = article.category_color || '#e63946';

    // Hide loading, show content
    hide('article-loading');
    show('article-header');
    show('article-body-wrap');

    // Update page title & meta
    document.title = `${article.title} — The Daily Roast`;
    setMeta('page-description', article.meta_description || article.excerpt);
    setMeta('og-title', article.title);
    setMeta('og-description', article.excerpt);
    setMeta('tw-title', article.title);
    setMeta('tw-description', article.excerpt);

    if (article.image_url) {
      setMeta('og-image', article.image_url);
    }

    // Fill content
    setText('article-title', article.title);
    setText('article-excerpt', article.excerpt);
    setText('article-author', article.author || 'AI Correspondent');
    setText('article-reading-time', article.reading_time || 3);
    setText('article-views', (article.views || 0).toLocaleString());
    setText('article-date', formatDate(article.created_at));

    // Category badge
    const catEl = document.getElementById('article-category');
    if (catEl) {
      catEl.textContent = `${getCategoryIcon(catSlug)} ${article.category_name || 'News'}`;
      catEl.style.background = catColor;
      catEl.href = `/?cat=${catSlug}`;
    }

    // Byline avatar
    const avatarEl = document.getElementById('byline-avatar');
    if (avatarEl) {
      const initials = (article.author || 'AI').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
      avatarEl.textContent = initials;
    }

    // Article image
    if (article.image_url) {
      show('article-image-wrap');
      const imgEl = document.getElementById('article-image');
      if (imgEl) {
        imgEl.src = article.image_url;
        imgEl.alt = article.image_alt || article.title;
      }
    }

    // Article content — clean up formatting artifacts from AI generation
    const contentEl = document.getElementById('article-content');
    if (contentEl) {
      let html = article.content || '';

      // Fix literal \n sequences that weren't converted to HTML
      html = html.replace(/\\n/g, '\n');
      html = html.replace(/\\"/g, '"');

      // If content has no HTML tags at all, wrap paragraphs
      if (!/<[a-z][\s\S]*>/i.test(html)) {
        html = html.split(/\n{2,}/).filter(Boolean).map(block => {
          const trimmed = block.replace(/\n/g, ' ').trim();
          if (!trimmed) return '';
          if (trimmed.length < 100 && trimmed.split(' ').length <= 12 && !/[.!?]$/.test(trimmed)) {
            return '<h2>' + trimmed + '</h2>';
          }
          return '<p>' + trimmed + '</p>';
        }).join('');
      } else {
        // Content has HTML but may have stray \n\n between tags
        html = html.replace(/\n{2,}/g, '</p><p>');
        html = html.replace(/\n/g, ' ');
        // Clean up any resulting <p></p> empties
        html = html.replace(/<p>\s*<\/p>/gi, '');
        // Fix double <p> wrapping
        html = html.replace(/<p>\s*<p>/gi, '<p>');
        html = html.replace(/<\/p>\s*<\/p>/gi, '</p>');
      }

      // Remove leftover #Hashtag lines
      html = html.replace(/<p>\s*#\w+(?:\s*#\w+)*\s*<\/p>/gi, '');

      contentEl.innerHTML = html;
    }

    // Tags
    const tagsEl = document.getElementById('article-tags');
    if (tagsEl && article.tags && article.tags.length > 0) {
      tagsEl.innerHTML = article.tags.map(tag => 
        `<span class="tag">#${tag}</span>`
      ).join('');
    }

    // Share buttons
    setupShare(article);

    // Reactions
    setupReactions(article);

    // Schema.org structured data
    updateSchema(article);

    // Dispatch event for comments system
    window.dispatchEvent(new CustomEvent('article-loaded', { detail: { id: article.id, slug: article.slug } }));
  }

  function setupShare(article) {
    // Build canonical URL with query param (not hash) so social crawlers can read OG tags
    const slug = new URLSearchParams(window.location.search).get('slug') || article.slug;
    const url = `${window.location.origin}/article?slug=${slug}`;
    const title = encodeURIComponent(article.title);
    const text = encodeURIComponent(article.excerpt);

    const twBtn = document.getElementById('sb-tw');
    const fbBtn = document.getElementById('sb-fb');
    const rdBtn = document.getElementById('sb-rd');
    const cpBtn = document.getElementById('sb-cp');

    if (twBtn) {
      twBtn.addEventListener('click', () => {
        window.open(`https://twitter.com/intent/tweet?text=${title}&url=${encodeURIComponent(url)}`, '_blank', 'width=600,height=400');
      });
    }

    if (fbBtn) {
      fbBtn.addEventListener('click', () => {
        window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank', 'width=600,height=400');
      });
    }

    if (rdBtn) {
      rdBtn.addEventListener('click', () => {
        window.open(`https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${title}`, '_blank', 'width=600,height=400');
      });
    }

    const waBtn = document.getElementById('sb-wa');
    if (waBtn) {
      waBtn.addEventListener('click', () => {
        window.open(`https://api.whatsapp.com/send?text=${title}%20${encodeURIComponent(url)}`, '_blank');
      });
    }

    const tgBtn = document.getElementById('sb-tg');
    if (tgBtn) {
      tgBtn.addEventListener('click', () => {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${title}`, '_blank', 'width=600,height=400');
      });
    }

    const liBtn = document.getElementById('sb-li');
    if (liBtn) {
      liBtn.addEventListener('click', () => {
        window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`, '_blank', 'width=600,height=400');
      });
    }

    const emBtn = document.getElementById('sb-em');
    if (emBtn) {
      emBtn.addEventListener('click', () => {
        window.location.href = `mailto:?subject=${title}&body=Check%20out%20this%20hilarious%20satirical%20article:%20${encodeURIComponent(url)}`;
      });
    }

    if (cpBtn) {
      cpBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(url);
          cpBtn.innerHTML = '<span style="font-size:14px;">✓ Copied!</span>';
          setTimeout(() => {
            cpBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
          }, 2000);
        } catch (e) {
          prompt('Copy this link:', url);
        }
      });
    }

    // Native Web API (mobile)
    const nsBtn = document.getElementById('sb-ns');
    if (nsBtn && navigator.share) {
      nsBtn.style.display = 'flex';
      nsBtn.addEventListener('click', async () => {
        try {
          await navigator.share({
            title: article.title,
            text: article.excerpt,
            url: url
          });
        } catch (e) {
          // User cancelled or error — ignore
        }
      });
    }
  }

  // ---------- Reactions ----------

  function getSessionId() {
    let sid = localStorage.getItem('roast_session_id');
    if (!sid) {
      sid = 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('roast_session_id', sid);
    }
    return sid;
  }

  function getUserReactions(articleId) {
    try {
      const data = JSON.parse(localStorage.getItem('roast_reactions') || '{}');
      return data[articleId] || [];
    } catch { return []; }
  }

  function saveUserReaction(articleId, type) {
    try {
      const data = JSON.parse(localStorage.getItem('roast_reactions') || '{}');
      if (!data[articleId]) data[articleId] = [];
      if (!data[articleId].includes(type)) data[articleId].push(type);
      localStorage.setItem('roast_reactions', JSON.stringify(data));
    } catch {}
  }

  async function setupReactions(article) {
    const container = document.getElementById('article-reactions');
    if (!container) return;
    container.style.display = '';

    const db = getSupabase();
    if (!db) return;

    const sessionId = getSessionId();
    const userReactions = getUserReactions(article.id);

    // Load current counts
    try {
      const { data } = await db.rpc('get_reaction_counts', { article_uuid: article.id });
      if (data) {
        data.forEach(r => {
          const el = document.getElementById('count-' + r.reaction_type);
          if (el) el.textContent = r.count;
        });
      }
    } catch (err) {
      console.error('Error loading reactions:', err);
    }

    // Mark already-reacted buttons
    userReactions.forEach(type => {
      const btn = document.querySelector(`.reaction-btn[data-type="${type}"]`);
      if (btn) btn.classList.add('reacted');
    });

    // Click handlers
    document.querySelectorAll('.reaction-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const type = btn.dataset.type;
        if (btn.classList.contains('reacted')) return; // already reacted

        btn.classList.add('reacted', 'reaction-pop');
        saveUserReaction(article.id, type);

        // Optimistic count update
        const countEl = document.getElementById('count-' + type);
        if (countEl) countEl.textContent = parseInt(countEl.textContent || '0') + 1;

        try {
          await db.from('article_reactions').upsert({
            article_id: article.id,
            reaction_type: type,
            session_id: sessionId
          }, { onConflict: 'article_id,reaction_type,session_id' });
        } catch (err) {
          console.error('Error saving reaction:', err);
        }

        // Remove pop animation
        setTimeout(() => btn.classList.remove('reaction-pop'), 400);
      });
    });
  }

  async function loadRelated(categoryId, currentId) {
    const db = getSupabase();
    if (!db) return;

    try {
      const { data } = await db
        .from('articles_with_category')
        .select('*')
        .eq('category_id', categoryId)
        .neq('id', currentId)
        .order('created_at', { ascending: false })
        .limit(3);

      if (data && data.length > 0) {
        const grid = document.getElementById('related-grid');
        const section = document.getElementById('related-section');
        
        if (grid && section) {
          grid.innerHTML = data.map(article => renderRelatedCard(article)).join('');
          section.style.display = 'block';
        }
      }
    } catch (err) {
      console.error('Error loading related:', err);
    }
  }

  function renderRelatedCard(article) {
    const catSlug = article.category_slug || 'default';
    const catColor = article.category_color || '#e63946';
    const gradient = getCategoryColor(catSlug);
    const catIcon = getCategoryIcon(catSlug);

    return `
      <div class="article-card">
        <a href="/article?slug=${article.slug}">
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
              </div>
              <span>${article.reading_time || 3} min read</span>
            </div>
          </div>
        </a>
      </div>
    `;
  }

  async function trackView(slug) {
    const db = getSupabase();
    if (!db) return;

    try {
      await db.rpc('increment_views', { article_slug: slug });
    } catch (err) {
      // Silent fail
    }
  }

  function updateSchema(article) {
    const schemaEl = document.getElementById('article-schema');
    if (!schemaEl) return;

    const articleUrl = `${window.location.origin}/article?slug=${article.slug}`;

    const schema = {
      "@context": "https://schema.org",
      "@type": "SatiricalArticle",
      "headline": article.title,
      "description": article.meta_description || article.excerpt,
      "datePublished": article.created_at,
      "dateModified": article.updated_at || article.created_at,
      "url": articleUrl,
      "mainEntityOfPage": articleUrl,
      "author": {
        "@type": "Person",
        "name": article.author || "AI Correspondent"
      },
      "publisher": {
        "@type": "Organization",
        "name": "The Daily Roast",
        "url": window.location.origin,
        "logo": {
          "@type": "ImageObject",
          "url": `${window.location.origin}/icons/icon-512.svg`
        }
      },
      "genre": "Satire",
      "keywords": (article.tags || []).join(', '),
      "articleSection": article.category_name || "News",
      "inLanguage": "en",
      "isAccessibleForFree": true,
      "creativeWorkStatus": "Published"
    };

    if (article.image_url) {
      schema.image = {
        "@type": "ImageObject",
        "url": article.image_url,
        "width": 1024,
        "height": 1024
      };
      schema.thumbnailUrl = article.image_url;
    }

    if (article.reading_time) {
      schema.timeRequired = `PT${article.reading_time}M`;
    }

    schemaEl.textContent = JSON.stringify(schema, null, 2);
  }

  // ---------- Helpers ----------

  function show(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  }

  function hide(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setMeta(id, content) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('content', content);
  }

  function showNotFound() {
    hide('article-loading');
    show('article-not-found');
    document.title = 'Article Not Found — The Daily Roast';
  }

  // Footer year
  document.addEventListener('DOMContentLoaded', () => {
    const yearEl = document.getElementById('footer-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  });
})();
