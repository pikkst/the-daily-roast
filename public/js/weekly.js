(function() {
  window.addEventListener('supabase-ready', init);
  document.addEventListener('DOMContentLoaded', () => {
    if (getSupabase()) init();
  });

  let initialized = false;

  async function init() {
    if (initialized) return;
    initialized = true;

    const db = getSupabase();
    if (!db) return;

    const subtitle = document.getElementById('weekly-page-subtitle');
    const list = document.getElementById('weekly-list');
    const topWrap = document.getElementById('weekly-top-card-wrap');

    try {
      const { data: summaries, error: summaryError } = await db
        .from('weekly_roast_summaries')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(1);

      if (summaryError || !summaries || summaries.length === 0) {
        subtitle.textContent = 'No weekly summary yet. Check back after the first weekly run.';
        list.innerHTML = '<div class="weekly-loading">No Top 10 data available yet.</div>';
        return;
      }

      const summary = summaries[0];
      subtitle.textContent = `${formatDate(summary.week_start_date)} to ${formatDate(summary.week_end_date)}`;

      const { data: items, error: itemError } = await db
        .from('weekly_roast_items')
        .select('*')
        .eq('summary_id', summary.id)
        .order('rank', { ascending: true });

      if (itemError || !items || items.length === 0) {
        list.innerHTML = '<div class="weekly-loading">No ranked entries available yet.</div>';
        return;
      }

      topWrap.innerHTML = renderTopCard(items[0]);
      topWrap.style.display = 'block';

      list.innerHTML = items.map(renderItem).join('');
    } catch (err) {
      console.error('Weekly page load error:', err);
      subtitle.textContent = 'Could not load this week\'s data right now.';
      list.innerHTML = '<div class="weekly-loading">Unable to load weekly rankings.</div>';
    }
  }

  function renderTopCard(item) {
    return `
      <a href="/article?slug=${encodeURIComponent(item.article_slug)}" class="weekly-top-card">
        <div class="weekly-top-badge">#1 OF THE WEEK</div>
        <h3 class="weekly-top-title">${item.title}</h3>
        <p class="weekly-top-excerpt">${item.excerpt || 'The most roasted story of the week.'}</p>
        <div class="weekly-top-meta">
          <span>${getCategoryIcon(item.category_slug)} ${(item.category_slug || 'news').toUpperCase()}</span>
          <span>${(item.views || 0).toLocaleString()} views</span>
          <span>Absurdity ${item.absurdity_score || 0}</span>
        </div>
      </a>
    `;
  }

  function renderItem(item) {
    return `
      <a href="/article?slug=${encodeURIComponent(item.article_slug)}" class="weekly-item">
        <div class="weekly-item-rank">#${item.rank}</div>
        <div class="weekly-item-main">
          <h4 class="weekly-item-title">${item.title}</h4>
          <div class="weekly-item-meta">
            <span>${getCategoryIcon(item.category_slug)} ${(item.category_slug || 'news').toUpperCase()}</span>
            <span>${(item.views || 0).toLocaleString()} views</span>
            <span>${item.reaction_count || 0} reactions</span>
            <span>${item.comment_count || 0} comments</span>
            <span>Absurdity ${item.absurdity_score || 0}</span>
          </div>
        </div>
      </a>
    `;
  }
})();
