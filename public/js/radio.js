// ============================================
// The Daily Roast — Radio Player Logic
// ============================================

(function () {
  'use strict';

  const BGM_TRACKS = {
    upbeat:   'https://cdn.pixabay.com/audio/2022/01/18/audio_d0a13f69d2.mp3',
    chill:    'https://cdn.pixabay.com/audio/2022/03/10/audio_c8c8a7315b.mp3',
    funky:    'https://cdn.pixabay.com/audio/2022/02/22/audio_d1e871676d.mp3',
    dramatic: 'https://cdn.pixabay.com/audio/2022/08/04/audio_2dde6a6983.mp3'
  };

  const CATEGORY_ICONS = {
    politics: '🏛️', technology: '💻', business: '💼', science: '🔬',
    entertainment: '🎬', sports: '⚽', world: '🌍'
  };

  let broadcast = null;
  let isPlaying = false;
  let audioCtx = null;
  let analyser = null;
  let sourceNode = null;
  let bgmSourceNode = null;
  let animFrameId = null;

  // DOM refs
  const els = {};

  function cacheDom() {
    els.loading     = document.getElementById('radio-loading');
    els.empty       = document.getElementById('radio-empty');
    els.title       = document.getElementById('radio-title');
    els.date        = document.getElementById('radio-date');
    els.cover       = document.getElementById('radio-cover');
    els.coverImg    = document.getElementById('radio-cover-img');
    els.categories  = document.getElementById('radio-categories');
    els.playerSection = document.getElementById('radio-player-section');
    els.playBtn     = document.getElementById('radio-play-btn');
    els.playIcon    = document.getElementById('play-icon');
    els.pauseIcon   = document.getElementById('pause-icon');
    els.timeCurrent = document.getElementById('radio-time-current');
    els.timeTotal   = document.getElementById('radio-time-total');
    els.progressFill = document.getElementById('radio-progress-fill');
    els.progressInput = document.getElementById('radio-progress-input');
    els.speakerName = document.getElementById('radio-speaker-name');
    els.volume      = document.getElementById('radio-volume');
    els.volBtn      = document.getElementById('radio-vol-btn');
    els.bgmVolume   = document.getElementById('radio-bgm-volume');
    els.canvas      = document.getElementById('radio-canvas');
    els.scriptSection = document.getElementById('radio-script-section');
    els.scriptMeta  = document.getElementById('radio-script-meta');
    els.scriptEl    = document.getElementById('radio-script');
    els.articlesSection = document.getElementById('radio-articles-section');
    els.articlesGrid = document.getElementById('radio-articles-grid');
    els.audio       = document.getElementById('radio-audio');
    els.bgm         = document.getElementById('radio-bgm');
  }

  // ── Init ──

  window.addEventListener('supabase-ready', loadBroadcast);
  document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    if (getSupabase()) loadBroadcast();
  });

  let loaded = false;
  async function loadBroadcast() {
    if (loaded) return;
    loaded = true;

    cacheDom();
    const db = getSupabase();
    if (!db) return showEmpty();

    try {
      const { data, error } = await db
        .from('broadcasts')
        .select('*')
        .eq('published', true)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0) return showEmpty();

      broadcast = data[0];
      renderBroadcast();
    } catch (err) {
      console.error('Error loading broadcast:', err);
      showEmpty();
    }
  }

  function showEmpty() {
    if (els.loading) els.loading.style.display = 'none';
    if (els.empty) els.empty.style.display = 'block';
  }

  // ── Render ──

  function renderBroadcast() {
    if (els.loading) els.loading.style.display = 'none';

    // Title & date
    els.title.textContent = broadcast.title;
    const created = new Date(broadcast.created_at);
    els.date.textContent = created.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    // Cover image
    if (broadcast.cover_image_url) {
      els.coverImg.src = broadcast.cover_image_url;
      els.coverImg.alt = broadcast.title;
      els.cover.style.display = 'block';
    }

    // Category pills
    if (broadcast.category_summary) {
      const pills = Object.entries(broadcast.category_summary).map(([cat, title]) => {
        const icon = CATEGORY_ICONS[cat] || '📰';
        return `<div class="radio-cat-pill" title="${escapeHtml(title)}">
          <span class="radio-cat-icon">${icon}</span>
          <span class="radio-cat-name">${cat}</span>
        </div>`;
      }).join('');
      els.categories.innerHTML = pills;
    }

    // Player
    if (broadcast.audio_url) {
      els.audio.src = broadcast.audio_url;
      els.audio.load();
      els.playerSection.style.display = 'block';

      // BGM
      const bgmTheme = broadcast.bgm_theme || 'upbeat';
      const bgmUrl = BGM_TRACKS[bgmTheme] || BGM_TRACKS.upbeat;
      els.bgm.src = bgmUrl;
      els.bgm.volume = 0.35;
      els.bgm.load();

      setupPlayer();
    }

    // Script
    if (broadcast.script && broadcast.script.length > 0) {
      renderScript(broadcast.script);
    }

    // Related articles
    renderRelatedArticles();

    // Share buttons
    setupShare();
  }

  // ── Script Rendering ──

  function renderScript(script) {
    els.scriptMeta.textContent = `${script.length} lines · ~${Math.round((broadcast.duration_seconds || 0) / 60)} min`;

    const html = script.map((line, idx) => {
      const isJoe = line.speaker === 'Joe';
      return `<div class="script-line ${isJoe ? 'script-line--joe' : 'script-line--jane'}" data-idx="${idx}" id="script-line-${idx}">
        <div class="script-avatar ${isJoe ? 'script-avatar--joe' : 'script-avatar--jane'}">
          ${line.speaker[0]}
        </div>
        <div class="script-bubble ${isJoe ? 'script-bubble--joe' : 'script-bubble--jane'}">
          <div class="script-speaker">${line.speaker}</div>
          <div class="script-text">${escapeHtml(line.text)}</div>
        </div>
      </div>`;
    }).join('');

    els.scriptEl.innerHTML = html;
    els.scriptSection.style.display = 'block';
  }

  // ── Player Setup ──

  function setupPlayer() {
    // Play/Pause
    els.playBtn.addEventListener('click', togglePlay);

    // Audio events
    els.audio.addEventListener('loadedmetadata', () => {
      els.timeTotal.textContent = formatTime(els.audio.duration);
      els.progressInput.max = Math.floor(els.audio.duration);
    });

    els.audio.addEventListener('timeupdate', () => {
      if (!els.audio.duration) return;
      const pct = (els.audio.currentTime / els.audio.duration) * 100;
      els.progressFill.style.width = pct + '%';
      els.progressInput.value = Math.floor(els.audio.currentTime);
      els.timeCurrent.textContent = formatTime(els.audio.currentTime);

      // Highlight current script line
      updateScriptHighlight(els.audio.currentTime, els.audio.duration);
    });

    els.audio.addEventListener('ended', () => {
      stopPlayback();
    });

    // Seek
    els.progressInput.addEventListener('input', (e) => {
      els.audio.currentTime = parseFloat(e.target.value);
    });

    // Volume
    els.volume.addEventListener('input', (e) => {
      const vol = parseInt(e.target.value) / 100;
      els.audio.volume = vol;
      els.volBtn.textContent = vol === 0 ? '🔇' : vol < 0.5 ? '🔉' : '🔊';
    });

    // BGM Volume
    els.bgmVolume.addEventListener('input', (e) => {
      els.bgm.volume = parseInt(e.target.value) / 100;
    });

    // Mute toggle
    els.volBtn.addEventListener('click', () => {
      els.audio.muted = !els.audio.muted;
      els.volBtn.textContent = els.audio.muted ? '🔇' : '🔊';
    });
  }

  async function togglePlay() {
    if (isPlaying) {
      stopPlayback();
    } else {
      await startPlayback();
    }
  }

  async function startPlayback() {
    try {
      // Init AudioContext for visualizer
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
      }

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      if (!sourceNode) {
        sourceNode = audioCtx.createMediaElementSource(els.audio);
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);
      }

      if (!bgmSourceNode && els.bgm.src) {
        try {
          bgmSourceNode = audioCtx.createMediaElementSource(els.bgm);
          bgmSourceNode.connect(audioCtx.destination);
        } catch (e) {
          console.warn('BGM source node failed:', e);
        }
      }

      await els.audio.play();
      els.bgm.play().catch(() => {});

      isPlaying = true;
      els.playIcon.style.display = 'none';
      els.pauseIcon.style.display = 'block';
      els.playBtn.classList.add('playing');

      startVisualizer();
    } catch (err) {
      console.error('Playback failed:', err);
    }
  }

  function stopPlayback() {
    els.audio.pause();
    els.bgm.pause();
    isPlaying = false;
    els.playIcon.style.display = 'block';
    els.pauseIcon.style.display = 'none';
    els.playBtn.classList.remove('playing');

    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  // ── Visualizer ──

  function startVisualizer() {
    if (!analyser || !els.canvas) return;

    const ctx = els.canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      if (!isPlaying) return;
      animFrameId = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      const w = els.canvas.width;
      const h = els.canvas.height;
      ctx.clearRect(0, 0, w, h);

      const barCount = 64;
      const barWidth = w / barCount;
      const centerCount = barCount / 2;

      for (let i = 0; i < barCount; i++) {
        // Mirror: use first half of data mirrored
        const dataIdx = i < centerCount
          ? (centerCount - 1 - i) % bufferLength
          : (i - centerCount) % bufferLength;

        const value = dataArray[dataIdx] || 0;
        const barHeight = (value / 255) * h * 0.9 + 2;

        const gradient = ctx.createLinearGradient(0, h - barHeight, 0, h);
        gradient.addColorStop(0, '#f97316');
        gradient.addColorStop(1, '#dc3545');

        ctx.fillStyle = gradient;
        ctx.fillRect(i * barWidth + 1, h - barHeight, barWidth - 2, barHeight);
      }
    }

    draw();
  }

  // ── Script Highlight ──

  function updateScriptHighlight(currentTime, duration) {
    if (!broadcast || !broadcast.script || broadcast.script.length === 0) return;

    const script = broadcast.script;
    const totalChars = script.reduce((acc, line) => acc + line.text.length, 0);
    if (totalChars === 0) return;

    let elapsed = 0;
    let currentIdx = 0;

    for (let i = 0; i < script.length; i++) {
      const lineEndTime = ((elapsed + script[i].text.length) / totalChars) * duration;
      if (currentTime < lineEndTime) {
        currentIdx = i;
        break;
      }
      elapsed += script[i].text.length;
      if (i === script.length - 1) currentIdx = i;
    }

    // Update highlight
    document.querySelectorAll('.script-line').forEach((el, idx) => {
      el.classList.toggle('script-line--active', idx === currentIdx);
    });

    // Update speaker indicator
    const speaker = script[currentIdx]?.speaker || '';
    els.speakerName.textContent = `${speaker} is speaking...`;

    // Auto-scroll to active line
    const activeLine = document.getElementById(`script-line-${currentIdx}`);
    if (activeLine) {
      activeLine.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ── Related Articles ──

  async function renderRelatedArticles() {
    if (!broadcast.article_ids || broadcast.article_ids.length === 0) {
      return;
    }

    const db = getSupabase();
    if (!db) return;

    try {
      const { data, error } = await db
        .from('articles_with_category')
        .select('title, slug, excerpt, category_slug, category_name, category_color, image_url, reading_time, created_at')
        .in('id', broadcast.article_ids);

      if (error) throw error;
      if (!data || data.length === 0) return;

      const cards = data.map(article => {
        const catIcon = CATEGORY_ICONS[article.category_slug] || '📰';
        const catColor = article.category_color || '#e63946';
        return `<a href="/article?slug=${encodeURIComponent(article.slug)}" class="radio-article-card">
          ${article.image_url 
            ? `<img class="radio-article-img" src="${article.image_url}" alt="" loading="lazy">` 
            : `<div class="radio-article-img radio-article-img--placeholder">${catIcon}</div>`}
          <div class="radio-article-info">
            <span class="radio-article-cat" style="color:${catColor}">${catIcon} ${article.category_name}</span>
            <h3 class="radio-article-title">${escapeHtml(article.title)}</h3>
            <p class="radio-article-excerpt">${escapeHtml(article.excerpt || '')}</p>
          </div>
        </a>`;
      }).join('');

      els.articlesGrid.innerHTML = cards;
      els.articlesSection.style.display = 'block';
    } catch (err) {
      console.error('Error loading related articles:', err);
    }
  }

  // ── Share ──

  function setupShare() {
    const shareUrl = window.location.origin + '/radio';
    const shareTitle = broadcast.title || 'The Daily Roast Radio';
    const shareText = 'Tune in to The Daily Roast Radio — AI comedy podcast that roasts the day\'s biggest headlines! 📻🔥';

    document.querySelectorAll('.radio-share-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const platform = btn.dataset.platform;
        switch (platform) {
          case 'twitter':
            window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, '_blank');
            break;
          case 'facebook':
            window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, '_blank');
            break;
          case 'reddit':
            window.open(`https://reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(shareTitle)}`, '_blank');
            break;
          case 'copy':
            navigator.clipboard.writeText(shareUrl).then(() => {
              btn.textContent = '✅';
              setTimeout(() => { btn.textContent = '🔗'; }, 2000);
            });
            break;
        }
      });
    });
  }

  // ── Helpers ──

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Expose for mini-player ──
  window.DailyRoastRadio = {
    getBroadcast: () => broadcast,
    isPlaying: () => isPlaying
  };

})();
