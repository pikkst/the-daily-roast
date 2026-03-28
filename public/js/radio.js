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
  const USE_CLIENT_BGM_OVERLAY = false;

  const CATEGORY_ICONS = {
    politics: '🏛️', technology: '💻', business: '💼', science: '🔬',
    entertainment: '🎬', sports: '⚽', world: '🌍'
  };
  const TALLINN_TZ = 'Europe/Tallinn';
  const SCHEDULE_HOURS = [9, 15, 21];

  let broadcast = null;
  let broadcasts = [];
  let isPlaying = false;
  let audioCtx = null;
  let analyser = null;
  let sourceNode = null;
  let bgmSourceNode = null;
  let animFrameId = null;
  let visualizerReady = false;
  let deferredInstallPrompt = null;
  let playerInitialized = false;
  let shareInitialized = false;
  let countdownTimer = null;

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
    els.weeklySaga  = document.getElementById('radio-weekly-saga');
    els.weeklySagaText = document.getElementById('radio-weekly-saga-text');
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
    els.bgmWrap     = document.querySelector('.radio-bgm-wrap');
    els.canvas      = document.getElementById('radio-canvas');
    els.intro       = document.getElementById('radio-intro');
    els.articlesSection = document.getElementById('radio-articles-section');
    els.articlesGrid = document.getElementById('radio-articles-grid');
    els.nextCountdown = document.getElementById('radio-next-countdown');
    els.launchTeaser = document.getElementById('radio-launch-teaser');
    els.pipelineStatus = document.getElementById('radio-pipeline-status');
    els.downloadBtn = document.getElementById('radio-download-btn');
    els.archiveSection = document.getElementById('radio-archive-section');
    els.archiveList = document.getElementById('radio-archive-list');
    els.installWrap = document.getElementById('radio-install-wrap');
    els.installBtn = document.getElementById('radio-install-btn');
    els.installHint = document.getElementById('radio-install-hint');
    els.audio       = document.getElementById('radio-audio');
    els.bgm         = document.getElementById('radio-bgm');
  }

  // ── Init ──

  window.addEventListener('supabase-ready', loadBroadcast);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    cacheDom();
    if (els.installWrap) {
      els.installWrap.style.display = 'flex';
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    cacheDom();
    setupInstallPrompt();
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
        .limit(20);

      if (error) throw error;
      if (!data || data.length === 0) return showEmpty();

      broadcasts = data;
      broadcast = data[0];
      renderBroadcast();
      renderBroadcastArchive();
      loadWeeklySaga(db);
      startScheduleTicker();
    } catch (err) {
      console.error('Error loading broadcast:', err);
      showEmpty();
    }
  }

  function showEmpty() {
    if (els.loading) els.loading.style.display = 'none';
    if (els.empty) els.empty.style.display = 'block';
  }

  function setupInstallPrompt() {
    if (!els.installBtn) return;

    els.installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        if (els.installHint) {
          els.installHint.textContent = 'Use your browser menu and choose Add to Home Screen to install the radio app.';
        }
        return;
      }

      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        if (els.installHint) els.installHint.textContent = 'Radio app installed. Open it from your home screen.';
      }
      deferredInstallPrompt = null;
      if (els.installBtn) els.installBtn.disabled = true;
    });
  }

  // ── Weekly Saga Banner ──

  async function loadWeeklySaga(db) {
    if (!db || !els.weeklySaga || !els.weeklySagaText) return;
    try {
      const { data: summaries } = await db
        .from('weekly_roast_summaries')
        .select('id, top_article_title, week_start_date, week_end_date')
        .order('week_start_date', { ascending: false })
        .limit(1);
      const summary = (summaries || [])[0];
      if (!summary?.top_article_title) return;

      const { data: items } = await db
        .from('weekly_roast_items')
        .select('title, absurdity_score')
        .eq('summary_id', summary.id)
        .order('absurdity_score', { ascending: false })
        .limit(1);

      const sagaTitle = (items && items[0]?.title) || summary.top_article_title;
      els.weeklySagaText.textContent = sagaTitle;
      els.weeklySaga.style.display = 'flex';
    } catch (_) {
      // Best-effort only — saga banner is non-critical
    }
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

    if (els.intro) {
      const minutes = Math.max(1, Math.round((broadcast.duration_seconds || 0) / 60));
      const storyCount = Array.isArray(broadcast.article_ids) ? broadcast.article_ids.length : 0;
      els.intro.textContent = `Today's edition features ${storyCount} stories in a ${minutes}-minute comedy bulletin with hosts Joe & Jane.`;
    }

    if (els.downloadBtn) {
      if (broadcast.audio_url) {
        els.downloadBtn.href = broadcast.audio_url;
        els.downloadBtn.setAttribute('download', `${(broadcast.title || 'daily-roast-radio').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.wav`);
      } else {
        els.downloadBtn.removeAttribute('href');
      }
    }

    // Player
    if (broadcast.audio_url) {
      // Needed when piping remote media through WebAudio (visualizer path).
      els.audio.crossOrigin = 'anonymous';
      els.bgm.crossOrigin = 'anonymous';
      els.audio.src = broadcast.audio_url;
      els.audio.load();
      els.playerSection.style.display = 'block';

      // Optional client-side BGM overlay (disabled by default).
      if (USE_CLIENT_BGM_OVERLAY) {
        const bgmTheme = broadcast.bgm_theme || 'upbeat';
        const bgmUrl = BGM_TRACKS[bgmTheme] || BGM_TRACKS.upbeat;
        els.bgm.src = bgmUrl;
        els.bgm.volume = 0.25;
        els.bgm.load();
      } else if (els.bgmWrap) {
        els.bgmWrap.style.display = 'none';
      }

      if (!playerInitialized) {
        setupPlayer();
        playerInitialized = true;
      }
    }

    // Related articles
    renderRelatedArticles();
    renderScheduleStatus();

    // Share buttons
    if (!shareInitialized) {
      setupShare();
      shareInitialized = true;
    }
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
    if (USE_CLIENT_BGM_OVERLAY && els.bgmVolume) {
      els.bgmVolume.addEventListener('input', (e) => {
        els.bgm.volume = parseInt(e.target.value) / 100;
      });
    }

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

      if (!sourceNode && analyser) {
        try {
          sourceNode = audioCtx.createMediaElementSource(els.audio);
          sourceNode.connect(analyser);
          analyser.connect(audioCtx.destination);
          visualizerReady = true;
        } catch (e) {
          // Fallback: keep normal <audio> playback even if WebAudio graph fails.
          visualizerReady = false;
          analyser = null;
          console.warn('Visualizer disabled for main audio:', e);
        }
      }

      if (USE_CLIENT_BGM_OVERLAY && !bgmSourceNode && els.bgm.src) {
        try {
          bgmSourceNode = audioCtx.createMediaElementSource(els.bgm);
          bgmSourceNode.connect(audioCtx.destination);
        } catch (e) {
          console.warn('BGM source node failed:', e);
        }
      }

      await els.audio.play();
      if (USE_CLIENT_BGM_OVERLAY && els.bgm.src) {
        els.bgm.play().catch(() => {});
      }
      els.speakerName.textContent = 'On air: Joe & Jane';

      isPlaying = true;
      els.playIcon.style.display = 'none';
      els.pauseIcon.style.display = 'block';
      els.playBtn.classList.add('playing');

      if (visualizerReady) {
        startVisualizer();
      }
    } catch (err) {
      console.error('Playback failed:', err);
    }
  }

  function stopPlayback() {
    els.audio.pause();
    if (USE_CLIENT_BGM_OVERLAY) {
      els.bgm.pause();
    }
    els.speakerName.textContent = 'Ready to play';
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
        .select('id, title, slug, excerpt, category_slug, category_name, category_color, image_url, reading_time, created_at')
        .in('id', broadcast.article_ids);

      if (error) throw error;
      if (!data || data.length === 0) return;

      const ordered = broadcast.article_ids
        .map(id => data.find(article => article.id === id))
        .filter(Boolean);
      const playlistData = ordered.length > 0 ? ordered : data;

      const cards = playlistData.map((article, idx) => {
        const catIcon = CATEGORY_ICONS[article.category_slug] || '📰';
        const catColor = article.category_color || '#e63946';
        return `<a href="/article?slug=${encodeURIComponent(article.slug)}" class="radio-playlist-item">
          <span class="radio-playlist-index">${String(idx + 1).padStart(2, '0')}</span>
          <div class="radio-article-info">
            <span class="radio-article-cat" style="color:${catColor}">${catIcon} ${article.category_name}</span>
            <h3 class="radio-article-title">${escapeHtml(article.title)}</h3>
            <p class="radio-article-excerpt">${escapeHtml(article.excerpt || '')}</p>
          </div>
          <span class="radio-playlist-action">Open</span>
        </a>`;
      }).join('');

      els.articlesGrid.innerHTML = cards;
      els.articlesSection.style.display = 'block';
    } catch (err) {
      console.error('Error loading related articles:', err);
    }
  }

  function renderBroadcastArchive() {
    if (!els.archiveList || !Array.isArray(broadcasts) || broadcasts.length === 0) return;

    const rows = broadcasts.map((item, idx) => {
      const date = new Date(item.created_at);
      const dateLabel = date.toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric'
      });
      const mins = Math.max(1, Math.round((item.duration_seconds || 0) / 60));
      const hasAudio = Boolean(item.audio_url);

      return `<div class="radio-archive-item ${idx === 0 ? 'radio-archive-item--active' : ''}" data-broadcast-id="${item.id}">
        <div class="radio-archive-main">
          <h3 class="radio-archive-item-title">${escapeHtml(item.title || 'Untitled broadcast')}</h3>
          <p class="radio-archive-item-meta">${dateLabel} · ${mins} min</p>
        </div>
        <div class="radio-archive-actions">
          <button class="radio-archive-btn" data-action="play" data-id="${item.id}" ${hasAudio ? '' : 'disabled'}>Play</button>
          <button class="radio-archive-btn" data-action="playlist" data-id="${item.id}">Open playlist</button>
          <a class="radio-archive-btn radio-archive-btn--link" data-action="download" ${hasAudio ? `href="${item.audio_url}" download` : ''}>Download</a>
        </div>
      </div>`;
    }).join('');

    els.archiveList.innerHTML = rows;
    els.archiveSection.style.display = 'block';

    els.archiveList.querySelectorAll('[data-action="play"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const selected = broadcasts.find(b => String(b.id) === String(id));
        if (!selected) return;
        broadcast = selected;
        renderBroadcast();
        highlightActiveArchive(id);
        if (broadcast.audio_url) {
          await startPlayback();
        }
      });
    });

    els.archiveList.querySelectorAll('[data-action="playlist"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const selected = broadcasts.find(b => String(b.id) === String(id));
        if (!selected) return;
        broadcast = selected;
        renderBroadcast();
        highlightActiveArchive(id);
        if (els.articlesSection) {
          els.articlesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  function highlightActiveArchive(id) {
    if (!els.archiveList) return;
    els.archiveList.querySelectorAll('.radio-archive-item').forEach(el => {
      el.classList.toggle('radio-archive-item--active', el.getAttribute('data-broadcast-id') === String(id));
    });
  }

  function getTallinnNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: TALLINN_TZ }));
  }

  function getNextSlot(nowTallinn) {
    for (const hour of SCHEDULE_HOURS) {
      const slot = new Date(nowTallinn);
      slot.setHours(hour, 0, 0, 0);
      if (slot > nowTallinn) return slot;
    }
    const tomorrow = new Date(nowTallinn);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(SCHEDULE_HOURS[0], 0, 0, 0);
    return tomorrow;
  }

  function getPipelineLabel(nowTallinn) {
    const minutesNow = nowTallinn.getHours() * 60 + nowTallinn.getMinutes();
    const inGeneratingWindow = SCHEDULE_HOURS.some(hour => {
      const slot = hour * 60;
      return minutesNow >= (slot - 20) && minutesNow <= (slot + 40);
    });
    return inGeneratingWindow ? 'Generating now...' : 'Published';
  }

  function renderScheduleStatus() {
    if (!els.nextCountdown || !els.pipelineStatus) return;
    const nowTallinn = getTallinnNow();
    const nextSlot = getNextSlot(nowTallinn);
    const diffMs = Math.max(0, nextSlot.getTime() - nowTallinn.getTime());
    const totalSeconds = Math.floor(diffMs / 1000);
    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const ss = String(totalSeconds % 60).padStart(2, '0');

    els.nextCountdown.textContent = `Next broadcast in ${hh}:${mm}:${ss}`;
    els.pipelineStatus.textContent = getPipelineLabel(nowTallinn);
    els.pipelineStatus.classList.toggle('radio-pipeline-status--generating', els.pipelineStatus.textContent === 'Generating now...');

    if (els.launchTeaser) {
      const slotLabel = `${String(nextSlot.getHours()).padStart(2, '0')}:00`;
      const teaserCandidates = [
        `Launch ritual loading: new roast drops around ${slotLabel}.`,
        `Studio countdown live. Next roast window: ${slotLabel}.`,
        `Heads up: the next absurd bulletin lands near ${slotLabel}.`
      ];

      const idx = nowTallinn.getMinutes() % teaserCandidates.length;
      const baseTeaser = teaserCandidates[idx];
      const isImminent = totalSeconds <= 10 * 60;

      if (isImminent) {
        els.launchTeaser.textContent = `⚡ ${baseTeaser} Teaser mode active.`;
      } else {
        els.launchTeaser.textContent = baseTeaser;
      }

      els.launchTeaser.classList.toggle('radio-launch-teaser--imminent', isImminent);
    }
  }

  function startScheduleTicker() {
    if (countdownTimer) clearInterval(countdownTimer);
    renderScheduleStatus();
    countdownTimer = setInterval(renderScheduleStatus, 1000);
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
