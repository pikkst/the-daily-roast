// ============================================
// The Daily Roast — "Roast or Real?" Quiz Game
// ============================================

(function() {
  const TOTAL_QUESTIONS = 10;
  const REAL_HEADLINES_NEEDED = 5;
  const MODE_CLASSIC = 'classic';
  const MODE_DAILY = 'daily';

  // Hard-coded pool of REAL headlines (verified real news snippets)
  const REAL_HEADLINE_POOL = [
    "NASA's James Webb Space Telescope Discovers New Earth-Like Exoplanet",
    "Scientists Create Synthetic Embryos Without Eggs or Sperm",
    "Amazon Introduces Drone Delivery in Select US Cities",
    "World's Oldest Known DNA Recovered From 2-Million-Year-Old Sediment",
    "SpaceX Successfully Lands Starship Rocket for First Time",
    "Japan's Population Drops Below 125 Million for First Time",
    "Scientists Discover New Species of Deep-Sea Fish That Glows in the Dark",
    "European Union Passes World's First Comprehensive AI Regulation",
    "Record-Breaking Heat Wave Pushes Global Temperatures Above 1.5°C Threshold",
    "Researchers Use AI to Decode Brain Signals and Translate Thoughts to Text",
    "World's Largest Iceberg Breaks Free From Antarctic Ice Shelf",
    "India Successfully Lands Spacecraft Near Moon's South Pole",
    "First Gene Therapy for Sickle Cell Disease Approved by FDA",
    "New York City Bans Natural Gas Hookups in New Buildings",
    "Researchers Find High Levels of Microplastics in Human Blood",
    "China Launches World's First 6G Test Satellite",
    "Scientists Successfully Grow Plants in Lunar Soil for First Time",
    "Global Electric Vehicle Sales Surpass 10 Million in Single Year",
    "Archaeologists Discover 5,000-Year-Old Pub in Iraq",
    "Switzerland Votes to Ban Full Face Coverings in Public",
    "Denmark Plans to Tax Livestock Emissions Starting in 2030",
    "World Chess Champion Loses to AI For First Time in Blitz Format",
    "Scientists Revive 48,500-Year-Old Virus Found in Siberian Permafrost",
    "Octopus Found to Throw Objects at Other Octopuses When Annoyed",
    "Venice Charges Day-Trip Tourists Entry Fee for First Time in History"
  ];

  let quizData = [];
  let currentQuestion = 0;
  let score = 0;
  let answered = false;
  let quizMode = MODE_CLASSIC;
  let currentDayKey = '';
  let latestShareCardDataUrl = '';
  let latestShareCardBlob = null;

  // Wait for Supabase
  window.addEventListener('supabase-ready', init);
  document.addEventListener('DOMContentLoaded', () => {
    if (getSupabase()) init();
  });

  let initialized = false;
  function init() {
    if (initialized) return;
    initialized = true;

    document.getElementById('quiz-start-classic').addEventListener('click', () => startQuiz(MODE_CLASSIC));
    document.getElementById('quiz-start-daily').addEventListener('click', () => startQuiz(MODE_DAILY));
    document.getElementById('quiz-replay').addEventListener('click', () => {
      document.getElementById('quiz-results').style.display = 'none';
      startQuiz(quizMode);
    });

    updateDailyStatusUI();
    loadLeaderboard('leaderboard-list-intro', 'quiz-leaderboard-intro');
  }

  async function startQuiz(mode = MODE_CLASSIC) {
    quizMode = mode;
    currentDayKey = getDayKey();

    document.getElementById('quiz-intro').style.display = 'none';
    document.getElementById('quiz-results').style.display = 'none';
    document.getElementById('quiz-game').style.display = '';

    currentQuestion = 0;
    score = 0;
    answered = false;
    quizData = [];

    // Fetch satirical headlines from Supabase
    const db = getSupabase();
    let roastHeadlines = [];

    try {
      const { data } = await db
        .from('articles')
        .select('title')
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (data) {
        roastHeadlines = data.map(a => a.title);
      }
    } catch (err) {
      console.error('Error fetching roast headlines:', err);
    }

    // Fallback if not enough articles
    if (roastHeadlines.length < TOTAL_QUESTIONS - REAL_HEADLINES_NEEDED) {
      roastHeadlines.push(
        "CEO Announces 'Mandatory Fun' Policy, Employees Immediately Start Crying",
        "Local Man's 'Quick 5-Minute Fix' Now Entering Its 14th Hour",
        "Study Finds 97% of 'Reply All' Emails Could Have Been Avoided",
        "Tech Company Pivots to AI After Realizing Original Product Never Worked",
        "Elon Musk Announces Plan to Colonize Sun, Says 'Just Go at Night'"
      );
    }

    // Shuffle and pick
    if (quizMode === MODE_DAILY) {
      quizData = buildDailyQuiz(roastHeadlines, currentDayKey);
    } else {
      const shuffledRoasts = shuffle(roastHeadlines).slice(0, TOTAL_QUESTIONS - REAL_HEADLINES_NEEDED);
      const shuffledReals = shuffle([...REAL_HEADLINE_POOL]).slice(0, REAL_HEADLINES_NEEDED);
      shuffledRoasts.forEach(h => quizData.push({ headline: h, isRoast: true }));
      shuffledReals.forEach(h => quizData.push({ headline: h, isRoast: false }));
      quizData = shuffle(quizData);
    }

    showQuestion();
    setupChoiceHandlers();
  }

  function setupChoiceHandlers() {
    const roastBtn = document.getElementById('choice-roast');
    const realBtn = document.getElementById('choice-real');
    const nextBtn = document.getElementById('quiz-next');

    // Remove old listeners by cloning
    const newRoast = roastBtn.cloneNode(true);
    const newReal = realBtn.cloneNode(true);
    const newNext = nextBtn.cloneNode(true);
    roastBtn.replaceWith(newRoast);
    realBtn.replaceWith(newReal);
    nextBtn.replaceWith(newNext);

    newRoast.addEventListener('click', () => handleAnswer('roast'));
    newReal.addEventListener('click', () => handleAnswer('real'));
    newNext.addEventListener('click', nextQuestion);
  }

  function showQuestion() {
    if (currentQuestion >= quizData.length) {
      showResults();
      return;
    }

    answered = false;
    const q = quizData[currentQuestion];
    document.getElementById('quiz-headline').textContent = q.headline;
    document.getElementById('quiz-question-num').textContent = `${currentQuestion + 1}/${quizData.length}`;
    document.getElementById('quiz-score-live').textContent = `Score: ${score}`;
    document.getElementById('quiz-progress-fill').style.width = `${((currentQuestion + 1) / quizData.length) * 100}%`;
    document.getElementById('quiz-feedback').textContent = '';
    document.getElementById('quiz-feedback').className = 'quiz-feedback';
    document.getElementById('quiz-next').style.display = 'none';

    // Reset choice buttons
    const roastBtn = document.getElementById('choice-roast');
    const realBtn = document.getElementById('choice-real');
    [roastBtn, realBtn].forEach(btn => {
      btn.className = 'quiz-choice';
      btn.disabled = false;
    });
  }

  function handleAnswer(answer) {
    if (answered) return;
    answered = true;

    const q = quizData[currentQuestion];
    const isCorrect = (answer === 'roast' && q.isRoast) || (answer === 'real' && !q.isRoast);

    const roastBtn = document.getElementById('choice-roast');
    const realBtn = document.getElementById('choice-real');
    const feedback = document.getElementById('quiz-feedback');

    // Disable buttons
    roastBtn.classList.add('disabled');
    realBtn.classList.add('disabled');

    // Show correct/wrong
    if (q.isRoast) {
      roastBtn.classList.add('correct');
      if (answer === 'real') realBtn.classList.add('wrong');
    } else {
      realBtn.classList.add('correct');
      if (answer === 'roast') roastBtn.classList.add('wrong');
    }

    if (isCorrect) {
      score++;
      feedback.textContent = '✅ Correct! ' + (q.isRoast ? 'That was a Daily Roast headline.' : 'That was real news!');
      feedback.className = 'quiz-feedback correct';
    } else {
      feedback.textContent = '❌ Nope! ' + (q.isRoast ? 'That was actually from The Daily Roast!' : 'That was actually real news!');
      feedback.className = 'quiz-feedback wrong';
    }

    document.getElementById('quiz-score-live').textContent = `Score: ${score}`;
    document.getElementById('quiz-next').style.display = '';
  }

  function nextQuestion() {
    currentQuestion++;
    if (currentQuestion >= quizData.length) {
      showResults();
    } else {
      showQuestion();
      setupChoiceHandlers();
    }
  }

  async function showResults() {
    document.getElementById('quiz-game').style.display = 'none';
    document.getElementById('quiz-results').style.display = '';

    const total = quizData.length;
    document.getElementById('final-score').textContent = `${score}/${total}`;

    const pct = score / total;
    let verdict = '';
    if (pct === 1) verdict = '🏆 Perfect! You\'re a headline detective!';
    else if (pct >= 0.8) verdict = '🔥 Impressive! You can smell a roast a mile away.';
    else if (pct >= 0.6) verdict = '😏 Not bad! You\'ve got decent news instincts.';
    else if (pct >= 0.4) verdict = '🤔 Hmm, our AI fooled you more than expected...';
    else verdict = '💀 Oh no... You might want to check your news sources!';

    document.getElementById('quiz-verdict').textContent = verdict;

    const dailySummaryEl = document.getElementById('quiz-daily-summary');
    const shareBtn = document.getElementById('quiz-share');
    const downloadBtn = document.getElementById('quiz-download-card');
    const radioCta = document.getElementById('quiz-radio-cta');
    const shareCardWrap = document.getElementById('quiz-share-card-wrap');
    const shareCardImg = document.getElementById('quiz-share-card-image');
    if (quizMode === MODE_DAILY) {
      const dailyState = updateDailyState(score, total, currentDayKey);
      dailySummaryEl.textContent = `Daily challenge ${currentDayKey}: ${score}/${total}. Current streak: ${dailyState.streak} day${dailyState.streak === 1 ? '' : 's'}. Best daily score: ${dailyState.best.score}/${dailyState.best.total}.`;
      dailySummaryEl.style.display = '';
      shareBtn.style.display = '';
      downloadBtn.style.display = '';

      const card = createDailyShareCard(score, total, currentDayKey, dailyState.streak);
      latestShareCardDataUrl = card.dataUrl;
      latestShareCardBlob = card.blob;

      shareCardImg.src = latestShareCardDataUrl;
      shareCardWrap.style.display = '';

      bindShareButton(shareBtn, score, total, currentDayKey, dailyState.streak);
      bindDownloadCardButton(downloadBtn, currentDayKey);
      updateDailyStatusUI();
      if (radioCta) {
        radioCta.textContent = dailyState.streak >= 3
          ? '📻 Keep Streak Alive: Listen Today\'s Radio'
          : '📻 Listen Today\'s Radio';
      }
    } else {
      dailySummaryEl.style.display = 'none';
      shareBtn.style.display = 'none';
      downloadBtn.style.display = 'none';
      shareCardWrap.style.display = 'none';
      latestShareCardDataUrl = '';
      latestShareCardBlob = null;
      if (radioCta) {
        radioCta.textContent = '📻 Listen Today\'s Radio';
      }
    }

    // Save score
    await saveScore(score, total);
    loadLeaderboard('leaderboard-list-results', 'quiz-leaderboard-results');
  }

  async function saveScore(score, total) {
    const db = getSupabase();
    if (!db) return;

    let sid = localStorage.getItem('roast_session_id');
    if (!sid) {
      sid = 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('roast_session_id', sid);
    }

    try {
      await db.from('quiz_scores').insert({
        score,
        total,
        session_id: sid
      });
    } catch (err) {
      console.error('Error saving quiz score:', err);
    }
  }

  async function loadLeaderboard(listId, containerId) {
    const db = getSupabase();
    if (!db) return;

    try {
      const { data } = await db
        .from('quiz_scores')
        .select('*')
        .order('score', { ascending: false })
        .order('played_at', { ascending: false })
        .limit(10);

      if (data && data.length > 0) {
        const list = document.getElementById(listId);
        const container = document.getElementById(containerId);
        if (!list || !container) return;

        list.innerHTML = data.map((s, i) => {
          const medals = ['🥇', '🥈', '🥉'];
          const rank = i < 3 ? medals[i] : `#${i + 1}`;
          const date = new Date(s.played_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          return `
            <div class="leaderboard-item">
              <span class="rank">${rank}</span>
              <span class="score-text">${s.score}/${s.total}</span>
              <span class="date-text">${date}</span>
            </div>
          `;
        }).join('');

        container.style.display = '';
      }
    } catch (err) {
      console.error('Error loading leaderboard:', err);
    }
  }

  // ---------- Utility ----------
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function getDayKey() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function buildDailyQuiz(roastHeadlines, dayKey) {
    const roastNeed = TOTAL_QUESTIONS - REAL_HEADLINES_NEEDED;
    const uniqueRoasts = [...new Set(roastHeadlines.map(h => String(h).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const roastPool = uniqueRoasts.length >= roastNeed ? uniqueRoasts : uniqueRoasts.concat([
      'CEO Announces Mandatory Fun Week, Staff Immediately Opens LinkedIn',
      'Company Deploys New AI Tool to Explain Why Existing AI Tool Failed',
      'Man Opens One Browser Tab, Somehow Ends Up With 64',
      'Local Team Holds Strategic Meeting About Why Meetings Are Too Long',
      'Breaking: Deadline Extended, Panic Continues as Scheduled'
    ]);

    const roastPick = seededPick(roastPool, roastNeed, `${dayKey}-roast`).map((headline) => ({ headline, isRoast: true }));
    const realPick = seededPick(REAL_HEADLINE_POOL, REAL_HEADLINES_NEEDED, `${dayKey}-real`).map((headline) => ({ headline, isRoast: false }));
    return seededShuffle([...roastPick, ...realPick], `${dayKey}-mix`);
  }

  function seededPick(arr, count, seedStr) {
    return seededShuffle(arr, seedStr).slice(0, count);
  }

  function seededShuffle(arr, seedStr) {
    const a = [...arr];
    let seed = seedFromString(seedStr);

    for (let i = a.length - 1; i > 0; i--) {
      seed = lcg(seed);
      const j = seed % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function seedFromString(input) {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function lcg(seed) {
    return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  }

  function getYesterdayDayKey(dayKey) {
    const [y, m, d] = dayKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() - 1);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function getDailyState() {
    const key = 'tdr_quiz_daily_state';
    let state = {
      streak: 0,
      best: { score: 0, total: TOTAL_QUESTIONS, day: '' },
      days: {}
    };

    try {
      const raw = localStorage.getItem(key);
      if (!raw) return state;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        state = {
          streak: Number(parsed.streak) || 0,
          best: parsed.best || state.best,
          days: parsed.days || {}
        };
      }
    } catch (err) {
      console.warn('Could not parse daily quiz state:', err);
    }
    return state;
  }

  function saveDailyState(state) {
    try {
      localStorage.setItem('tdr_quiz_daily_state', JSON.stringify(state));
    } catch (err) {
      console.warn('Could not save daily quiz state:', err);
    }
  }

  function updateDailyState(currentScore, total, dayKey) {
    const state = getDailyState();
    const previousEntry = state.days[dayKey];

    state.days[dayKey] = {
      score: Math.max(currentScore, previousEntry ? Number(previousEntry.score) || 0 : 0),
      total,
      playedAt: new Date().toISOString()
    };

    const yesterday = getYesterdayDayKey(dayKey);
    if (!previousEntry) {
      state.streak = state.days[yesterday] ? (Number(state.streak) || 0) + 1 : 1;
    }

    if (currentScore > (Number(state.best.score) || 0)) {
      state.best = { score: currentScore, total, day: dayKey };
    }

    saveDailyState(state);
    return state;
  }

  function updateDailyStatusUI() {
    const statusEl = document.getElementById('quiz-daily-status');
    const dailyBtn = document.getElementById('quiz-start-daily');
    if (!statusEl || !dailyBtn) return;

    const dayKey = getDayKey();
    const state = getDailyState();
    const today = state.days[dayKey];

    if (today) {
      statusEl.textContent = `Today already played: ${today.score}/${today.total}. You can replay for practice.`;
      dailyBtn.textContent = '🎯 Replay Daily Challenge';
    } else {
      statusEl.textContent = 'New daily challenge is ready.';
      dailyBtn.textContent = '🎯 Daily Challenge';
    }
  }

  function bindShareButton(btn, currentScore, total, dayKey, streak) {
    const newBtn = btn.cloneNode(true);
    btn.replaceWith(newBtn);

    newBtn.addEventListener('click', async () => {
      const text = `I scored ${currentScore}/${total} in today's Roast or Real Daily Challenge (${dayKey}) on The Daily Roast. Current streak: ${streak}. Can you beat me?`;
      const url = `${getPublicSiteUrl()}/quiz.html`;
      const filename = `roast-or-real-${dayKey}.png`;

      const shareImageBlob = await ensureShareCardBlob();
      if (navigator.share) {
        try {
          if (shareImageBlob && navigator.canShare) {
            const file = new File([shareImageBlob], filename, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({
                title: 'Roast or Real Daily Challenge',
                text,
                url,
                files: [file]
              });
              return;
            }
          }

          await navigator.share({ title: 'Roast or Real Daily Challenge', text, url });
          return;
        } catch (err) {
          // Fall back to clipboard below.
        }
      }

      try {
        await navigator.clipboard.writeText(`${text} ${url}`);
        newBtn.textContent = 'Copied!';
        setTimeout(() => {
          newBtn.textContent = '🔗 Share Daily Score';
        }, 1500);
      } catch (err) {
        alert('Unable to share right now.');
      }
    });
  }

  function bindDownloadCardButton(btn, dayKey) {
    const newBtn = btn.cloneNode(true);
    btn.replaceWith(newBtn);

    newBtn.addEventListener('click', async () => {
      const dataUrl = latestShareCardDataUrl;
      if (!dataUrl) return;

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `roast-or-real-${dayKey}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  async function ensureShareCardBlob() {
    if (latestShareCardBlob) return latestShareCardBlob;
    if (!latestShareCardDataUrl) return null;

    try {
      const res = await fetch(latestShareCardDataUrl);
      latestShareCardBlob = await res.blob();
      return latestShareCardBlob;
    } catch {
      return null;
    }
  }

  function createDailyShareCard(currentScore, total, dayKey, streak) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, 1200, 630);
    bg.addColorStop(0, '#1b2838');
    bg.addColorStop(0.6, '#24384f');
    bg.addColorStop(1, '#2f4d69');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(60, 60, 1080, 510);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(60, 60, 1080, 510);

    ctx.fillStyle = '#ffc107';
    ctx.font = '700 34px Inter, Arial, sans-serif';
    ctx.fillText('THE DAILY ROAST', 100, 128);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 70px Inter, Arial, sans-serif';
    ctx.fillText('Roast or Real', 100, 245);

    ctx.fillStyle = '#cfe1f0';
    ctx.font = '600 34px Inter, Arial, sans-serif';
    ctx.fillText(`Daily Challenge - ${dayKey}`, 100, 300);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 120px Inter, Arial, sans-serif';
    ctx.fillText(`${currentScore}/${total}`, 100, 445);

    ctx.fillStyle = '#ffdfae';
    ctx.font = '700 34px Inter, Arial, sans-serif';
    ctx.fillText(`Streak: ${streak} day${streak === 1 ? '' : 's'}`, 100, 500);

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '600 28px Inter, Arial, sans-serif';
    ctx.fillText('Can you beat this score?', 720, 520);

    return {
      dataUrl: canvas.toDataURL('image/png'),
      blob: null
    };
  }

  // Footer year
  document.addEventListener('DOMContentLoaded', () => {
    const yearEl = document.getElementById('footer-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  });
})();
