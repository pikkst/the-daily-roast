// ============================================
// The Daily Roast — Comments System
// ============================================

(function() {
  const COMMENTS_PER_PAGE = 20;
  let currentArticleId = null;
  let commentsOffset = 0;
  let allLoaded = false;

  // Wait for article to be loaded, then init comments
  window.addEventListener('article-loaded', (e) => {
    currentArticleId = e.detail?.id;
    if (currentArticleId) initComments();
  });

  function initComments() {
    const section = document.getElementById('comments-section');
    if (!section) return;
    section.style.display = '';

    // Restore saved name
    const nameInput = document.getElementById('comment-name');
    if (nameInput) {
      nameInput.value = localStorage.getItem('roast_comment_name') || '';
    }

    // Character counter
    const textarea = document.getElementById('comment-text');
    const charCount = document.getElementById('comment-char-count');
    if (textarea && charCount) {
      textarea.addEventListener('input', () => {
        charCount.textContent = `${textarea.value.length}/1000`;
      });
    }

    // Form submit
    const form = document.getElementById('comment-form');
    if (form) {
      form.addEventListener('submit', handleSubmit);
    }

    // Load more button
    const loadMoreBtn = document.getElementById('load-more-comments');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => loadComments(true));
    }

    // Initial load
    loadComments(false);
  }

  async function loadComments(append) {
    const db = getSupabase();
    if (!db || !currentArticleId) return;

    if (!append) {
      commentsOffset = 0;
      allLoaded = false;
    }

    try {
      const { data, error } = await db
        .from('article_comments')
        .select('*')
        .eq('article_id', currentArticleId)
        .eq('is_approved', true)
        .is('parent_id', null)
        .order('created_at', { ascending: false })
        .range(commentsOffset, commentsOffset + COMMENTS_PER_PAGE - 1);

      if (error) {
        console.error('[Comments] Load error:', error);
        return;
      }

      const list = document.getElementById('comments-list');
      const loading = document.getElementById('comments-loading');
      const empty = document.getElementById('comments-empty');
      const loadMore = document.getElementById('comments-load-more');

      if (loading) loading.style.display = 'none';

      if (!data || data.length === 0) {
        if (!append) {
          if (empty) empty.style.display = '';
        }
        allLoaded = true;
        if (loadMore) loadMore.style.display = 'none';
        return;
      }

      if (empty) empty.style.display = 'none';

      const html = data.map(c => renderComment(c)).join('');
      if (append) {
        list.insertAdjacentHTML('beforeend', html);
      } else {
        list.innerHTML = html;
      }

      commentsOffset += data.length;

      if (data.length < COMMENTS_PER_PAGE) {
        allLoaded = true;
        if (loadMore) loadMore.style.display = 'none';
      } else {
        if (loadMore) loadMore.style.display = '';
      }

      // Update count
      updateCount();

      // Attach like handlers
      attachLikeHandlers();

    } catch (err) {
      console.error('[Comments] Error:', err);
    }
  }

  function renderComment(comment) {
    const initials = (comment.author_name || 'A')
      .split(' ')
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    const timeStr = timeAgo(comment.created_at);
    const likedComments = getLikedComments();
    const isLiked = likedComments.includes(comment.id);

    return `
      <div class="comment" data-id="${comment.id}">
        <div class="comment-avatar">${initials}</div>
        <div class="comment-body">
          <div class="comment-meta">
            <span class="comment-author">${escapeHtml(comment.author_name || 'Anonymous Roaster')}</span>
            <span class="comment-time">${timeStr}</span>
          </div>
          <div class="comment-content">${escapeHtml(comment.content)}</div>
          <div class="comment-actions">
            <button class="comment-like-btn ${isLiked ? 'liked' : ''}" data-comment-id="${comment.id}">
              ${isLiked ? '❤️' : '🤍'} <span class="comment-like-count">${comment.likes || 0}</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const db = getSupabase();
    if (!db || !currentArticleId) return;

    const nameInput = document.getElementById('comment-name');
    const textInput = document.getElementById('comment-text');
    const submitBtn = document.getElementById('comment-submit');
    const submitText = submitBtn?.querySelector('.comment-submit-text');
    const submitLoading = submitBtn?.querySelector('.comment-submit-loading');
    const messageEl = document.getElementById('comment-form-message');

    const authorName = (nameInput?.value || '').trim() || 'Anonymous Roaster';
    const content = (textInput?.value || '').trim();

    if (!content || content.length < 2) {
      showMessage(messageEl, 'Comment is too short!', 'error');
      return;
    }

    if (content.length > 1000) {
      showMessage(messageEl, 'Comment is too long!', 'error');
      return;
    }

    if (authorName.length > 80) {
      showMessage(messageEl, 'Name is too long!', 'error');
      return;
    }

    if (!/\S/.test(content) || /(.)\1{25,}/.test(content)) {
      showMessage(messageEl, 'Please write a normal comment.', 'error');
      return;
    }

    // Simple spam check: no posting within 10 seconds
    const lastPost = parseInt(localStorage.getItem('roast_last_comment') || '0', 10);
    if (Date.now() - lastPost < 15000) {
      showMessage(messageEl, 'Easy there! Wait a few seconds between comments.', 'error');
      return;
    }

    // Disable button
    if (submitText) submitText.style.display = 'none';
    if (submitLoading) submitLoading.style.display = '';
    if (submitBtn) submitBtn.disabled = true;

    try {
      const sessionId = getSessionId();

      const { data, error } = await db.from('article_comments').insert({
        article_id: currentArticleId,
        author_name: authorName,
        content: content,
        session_id: sessionId
      }).select().single();

      if (error) throw error;

      // Save name for next time
      localStorage.setItem('roast_comment_name', authorName);
      localStorage.setItem('roast_last_comment', Date.now().toString());

      // Clear form
      if (textInput) textInput.value = '';
      const charCount = document.getElementById('comment-char-count');
      if (charCount) charCount.textContent = '0/1000';

      // Add comment to top of list
      const list = document.getElementById('comments-list');
      const empty = document.getElementById('comments-empty');
      if (empty) empty.style.display = 'none';

      if (list && data) {
        list.insertAdjacentHTML('afterbegin', renderComment(data));
        attachLikeHandlers();
      }

      showMessage(messageEl, 'Comment posted! 🔥', 'success');
      updateCount();

    } catch (err) {
      console.error('[Comments] Post error:', err);
      showMessage(messageEl, 'Failed to post comment. Try again.', 'error');
    } finally {
      if (submitText) submitText.style.display = '';
      if (submitLoading) submitLoading.style.display = 'none';
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function attachLikeHandlers() {
    document.querySelectorAll('.comment-like-btn:not([data-bound])').forEach(btn => {
      btn.setAttribute('data-bound', '1');
      btn.addEventListener('click', async () => {
        const commentId = btn.dataset.commentId;
        const likedComments = getLikedComments();

        if (likedComments.includes(commentId)) return; // already liked

        // Optimistic update
        btn.classList.add('liked');
        btn.innerHTML = `❤️ <span class="comment-like-count">${parseInt(btn.querySelector('.comment-like-count')?.textContent || '0') + 1}</span>`;
        saveLikedComment(commentId);

        try {
          const db = getSupabase();
            if (db) {
              await db.rpc('like_comment', {
                comment_uuid: commentId,
                sid: getSessionId()
              });
            }
        } catch (err) {
          console.error('[Comments] Like error:', err);
        }
      });
    });
  }

  async function updateCount() {
    const db = getSupabase();
    if (!db || !currentArticleId) return;

    try {
      const { data } = await db.rpc('get_comment_count', { article_uuid: currentArticleId });
      const countEl = document.getElementById('comments-count');
      if (countEl) countEl.textContent = `(${data || 0})`;
    } catch {}
  }

  function getLikedComments() {
    try {
      return JSON.parse(localStorage.getItem('roast_liked_comments') || '[]');
    } catch { return []; }
  }

  function saveLikedComment(id) {
    const liked = getLikedComments();
    if (!liked.includes(id)) {
      liked.push(id);
      localStorage.setItem('roast_liked_comments', JSON.stringify(liked));
    }
  }

  // Re-use getSessionId from article.js
  function getSessionId() {
    let sid = localStorage.getItem('roast_session_id');
    if (!sid) {
      sid = 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('roast_session_id', sid);
    }
    return sid;
  }

  function showMessage(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className = `comment-form-message ${type}`;
    el.style.display = '';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

})();
