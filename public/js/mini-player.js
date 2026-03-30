// ============================================
// The Daily Roast — Mini Radio Player (Homepage)
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
  let audio = null;
  let bgm = null;
  let isPlaying = false;
  const BGM_STORAGE_KEY = 'mini-player-bgm-volume';

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

    try {
      const { data, error } = await db
        .from('broadcasts')
        .select('id, title, audio_url, bgm_theme, category_summary, duration_seconds, created_at')
        .eq('published', true)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0 || !data[0].audio_url) return;

      broadcast = data[0];
      renderMiniPlayer();
    } catch (err) {
      console.error('Mini-player: Error loading broadcast:', err);
    }
  }

  function renderMiniPlayer() {
    const wrapper = document.getElementById('mini-player');
    const titleEl = document.getElementById('mini-player-title');
    const metaEl = document.getElementById('mini-player-meta');
    const catsEl = document.getElementById('mini-player-cats');
    if (!wrapper) return;

    // Set title
    if (titleEl) {
      const date = new Date(broadcast.created_at);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      titleEl.textContent = `${dateStr} — ${Math.round((broadcast.duration_seconds || 0) / 60)} min show`;
    }

    if (metaEl) {
      const catCount = Object.keys(broadcast.category_summary || {}).length;
      metaEl.textContent = `Parody / Fiction Broadcast · ${catCount} stories`; 
    }

    // Category icons
    if (catsEl && broadcast.category_summary) {
      catsEl.innerHTML = Object.keys(broadcast.category_summary)
        .map(cat => `<span class="mini-cat" title="${cat}">${CATEGORY_ICONS[cat] || '📰'}</span>`)
        .join('');
    }

    // Create audio elements
    audio = new Audio();
    audio.preload = 'none';
    setAudioSource(audio, broadcast.audio_url);

    bgm = new Audio();
    bgm.preload = 'none';
    bgm.loop = true;
    const savedVolume = Number(localStorage.getItem(BGM_STORAGE_KEY));
    const defaultVolume = Number.isFinite(savedVolume) ? savedVolume : 0.10;
    bgm.volume = Math.min(1, Math.max(0, defaultVolume));
    const bgmTheme = broadcast.bgm_theme || 'upbeat';
    bgm.src = BGM_TRACKS[bgmTheme] || BGM_TRACKS.upbeat;

    const bgmSlider = document.getElementById('mini-player-bgm-volume');
    if (bgmSlider) {
      bgmSlider.value = String(Math.round(bgm.volume * 100));
    }

    // Setup events
    setupEvents();

    // Show mini-player
    wrapper.style.display = 'block';
  }

  function setupEvents() {
    const playBtn = document.getElementById('mini-player-play');
    const shareBtn = document.getElementById('mini-player-share');
    const bgmSlider = document.getElementById('mini-player-bgm-volume');

    if (playBtn) {
      playBtn.addEventListener('click', togglePlay);
    }

    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        const url = getPublicSiteUrl() + '/radio';
        navigator.clipboard.writeText(url).then(() => {
          shareBtn.textContent = '✅';
          setTimeout(() => { shareBtn.textContent = '🔗'; }, 2000);
        });
      });
    }

    if (bgmSlider) {
      bgmSlider.addEventListener('input', (e) => {
        const vol = Math.min(1, Math.max(0, parseInt(e.target.value, 10) / 100));
        if (bgm) bgm.volume = vol;
        localStorage.setItem(BGM_STORAGE_KEY, String(vol));
      });
    }

    if (audio) {
      audio.addEventListener('timeupdate', updateProgress);
      audio.addEventListener('ended', () => {
        isPlaying = false;
        updatePlayIcon();
        bgm.pause();
      });
      audio.addEventListener('error', () => {
        const mediaError = audio.error;
        const code = mediaError ? mediaError.code : 0;
        console.error('Mini-player audio load error:', {
          code,
          message: describeMediaError(code),
          src: getCurrentAudioSource(audio)
        });
      });
    }
  }

  async function togglePlay() {
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      bgm.pause();
      isPlaying = false;
    } else {
      try {
        await audio.play();
        bgm.play().catch(() => {});
        isPlaying = true;
      } catch (err) {
        console.error('Mini-player playback failed:', err);
        return;
      }
    }
    updatePlayIcon();
  }

  function updatePlayIcon() {
    const playIcon = document.getElementById('mini-play-icon');
    const pauseIcon = document.getElementById('mini-pause-icon');
    if (playIcon) playIcon.style.display = isPlaying ? 'none' : 'block';
    if (pauseIcon) pauseIcon.style.display = isPlaying ? 'block' : 'none';
  }

  function updateProgress() {
    if (!audio || !audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    const fill = document.getElementById('mini-player-progress-fill');
    const timeEl = document.getElementById('mini-player-time');
    if (fill) fill.style.width = pct + '%';
    if (timeEl) {
      const m = Math.floor(audio.currentTime / 60);
      const s = Math.floor(audio.currentTime % 60);
      timeEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }
  }

  function normalizeAudioUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (trimmed.startsWith('//')) {
      return window.location.protocol + trimmed;
    }
    return trimmed;
  }

  function getAudioExtension(url) {
    if (!url) return '';
    const baseUrl = url.split('?')[0].split('#')[0];
    const match = baseUrl.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
  }

  function inferAudioMimeType(url) {
    const ext = getAudioExtension(url);
    if (ext === 'mp3') return 'audio/mpeg';
    if (ext === 'wav') return 'audio/wav';
    if (ext === 'ogg' || ext === 'oga') return 'audio/ogg';
    if (ext === 'webm') return 'audio/webm';
    if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4';
    if (ext === 'aac') return 'audio/aac';
    return '';
  }

  function setAudioSource(audioEl, sourceUrl) {
    if (!audioEl) return;
    const normalized = normalizeAudioUrl(sourceUrl);
    audioEl.pause();
    audioEl.removeAttribute('src');
    while (audioEl.firstChild) {
      audioEl.removeChild(audioEl.firstChild);
    }

    if (!normalized) {
      audioEl.load();
      return;
    }

    const source = document.createElement('source');
    source.src = normalized;
    const mimeType = inferAudioMimeType(normalized);
    if (mimeType) {
      source.type = mimeType;
    }

    audioEl.appendChild(source);
    audioEl.load();
  }

  function getCurrentAudioSource(audioEl) {
    if (!audioEl) return '';
    const sourceEl = audioEl.querySelector('source');
    return sourceEl?.src || audioEl.currentSrc || audioEl.src || '';
  }

  function describeMediaError(code) {
    if (code === 1) return 'MEDIA_ERR_ABORTED';
    if (code === 2) return 'MEDIA_ERR_NETWORK';
    if (code === 3) return 'MEDIA_ERR_DECODE';
    if (code === 4) return 'MEDIA_ERR_SRC_NOT_SUPPORTED';
    return 'UNKNOWN_MEDIA_ERROR';
  }
})();
