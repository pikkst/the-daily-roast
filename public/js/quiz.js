// ============================================
// The Daily Roast — "Roast or Real?" Quiz Game
// ============================================

(function() {
  const TOTAL_QUESTIONS = 10;
  const REAL_HEADLINES_NEEDED = 5;

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

  // Wait for Supabase
  window.addEventListener('supabase-ready', init);
  document.addEventListener('DOMContentLoaded', () => {
    if (getSupabase()) init();
  });

  let initialized = false;
  function init() {
    if (initialized) return;
    initialized = true;

    document.getElementById('quiz-start-btn').addEventListener('click', startQuiz);
    document.getElementById('quiz-replay').addEventListener('click', () => {
      document.getElementById('quiz-results').style.display = 'none';
      startQuiz();
    });

    loadLeaderboard('leaderboard-list-intro', 'quiz-leaderboard-intro');
  }

  async function startQuiz() {
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
    const shuffledRoasts = shuffle(roastHeadlines).slice(0, TOTAL_QUESTIONS - REAL_HEADLINES_NEEDED);
    const shuffledReals = shuffle([...REAL_HEADLINE_POOL]).slice(0, REAL_HEADLINES_NEEDED);

    // Build quiz
    shuffledRoasts.forEach(h => quizData.push({ headline: h, isRoast: true }));
    shuffledReals.forEach(h => quizData.push({ headline: h, isRoast: false }));
    quizData = shuffle(quizData);

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

  // Footer year
  document.addEventListener('DOMContentLoaded', () => {
    const yearEl = document.getElementById('footer-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  });
})();
