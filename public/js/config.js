// ============================================
// The Daily Roast — Configuration
// ============================================

const CONFIG = {
  // Public site origin used for canonical/share links
  SITE_URL: 'https://thedailyroast.online',

  // Supabase
  SUPABASE_URL: 'https://pbwswrieljqfshnjulzs.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBid3N3cmllbGpxZnNobmp1bHpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNzg5ODQsImV4cCI6MjA4OTc1NDk4NH0.buK75E84SRp-By6XCsKgMFnl31nNgj5cZV7e3lEkIiI',
  
  // Stripe (live mode)
  STRIPE_PUBLISHABLE_KEY: 'pk_live_51TDnLjJAyWeakalwDGc8KeT7ciHLn8bY6SNz85PWANSM2K5E7aMS2aJ4hAGLAEZnQlXSQhHIsdXxniphyqMyYyAF00IkKj1pAc',
  STRIPE_PRICES: {
    monthly_2:  'price_1TDnQoJZs0YoVLYRnCWs8KQm',  // Coffee Supporter €2/month
    monthly_5:  'price_1TDnR4JZs0YoVLYRxJvZ0Ucf',  // Lunch Supporter €5/month
    monthly_10: 'price_1TDnRKJZs0YoVLYRHHeZBWyR'   // Party Supporter €10/month
  },
  // Stripe Payment Links (live mode)
  STRIPE_PAYMENT_LINKS: {
    monthly_2:  'https://buy.stripe.com/dRm00k0e1bnV7ux5FD1ZS00',
    monthly_5:  'https://buy.stripe.com/fZu7sM8KxbnV7uxec91ZS01',
    monthly_10: 'https://buy.stripe.com/eVqbJ26Cp8bJ3eh5FD1ZS02'
  },
  
  // Site
  SITE_NAME: 'The Daily Roast',
  SITE_TAGLINE: 'Real headlines. Unreal satire. Daily parody radio.',
  ARTICLES_PER_PAGE: 9,
  
  // Category gradients (for article cards without images)
  CATEGORY_GRADIENTS: {
    politics:      'linear-gradient(135deg, #e63946 0%, #a82835 100%)',
    technology:    'linear-gradient(135deg, #457b9d 0%, #1d3557 100%)',
    business:      'linear-gradient(135deg, #2a9d8f 0%, #1a6b61 100%)',
    science:       'linear-gradient(135deg, #e9c46a 0%, #d4a843 100%)',
    entertainment: 'linear-gradient(135deg, #f4a261 0%, #e07b3a 100%)',
    sports:        'linear-gradient(135deg, #264653 0%, #1a2f38 100%)',
    world:         'linear-gradient(135deg, #6a4c93 0%, #4a3566 100%)',
    default:       'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
  },

  CATEGORY_ICONS: {
    politics: '🏛️',
    technology: '💻',
    business: '💼',
    science: '🔬',
    entertainment: '🎬',
    sports: '⚽',
    world: '🌍',
    default: '📰'
  }
};

// Initialize Supabase client
// Using CDN-loaded supabase library
let supabaseClient = null;

function getSupabase() {
  if (!supabaseClient) {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    }
  }
  return supabaseClient;
}

// Load Supabase JS from CDN
(function loadSupabase() {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  script.async = true;
  script.onload = () => {
    supabaseClient = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    // Dispatch event so other scripts know Supabase is ready
    window.dispatchEvent(new Event('supabase-ready'));
  };
  document.head.appendChild(script);
})();

// ---------- Utility Functions ----------

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function formatDateShort(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}

function timeAgo(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDateShort(dateStr);
}

function getCategoryColor(slug) {
  return CONFIG.CATEGORY_GRADIENTS[slug] || CONFIG.CATEGORY_GRADIENTS.default;
}

function getCategoryIcon(slug) {
  return CONFIG.CATEGORY_ICONS[slug] || CONFIG.CATEGORY_ICONS.default;
}

function getImageUrl(article) {
  if (article.image_url) return article.image_url;
  // Fallback: use picsum with article slug as seed
  return `https://picsum.photos/seed/${article.slug}/800/400`;
}

function getPublicSiteUrl() {
  const raw = String(CONFIG.SITE_URL || '').trim();
  return raw ? raw.replace(/\/$/, '') : window.location.origin;
}

// Shared: Disclaimer banner close
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('disclaimer-close');
  const bar = document.getElementById('disclaimer-bar');
  
  if (closeBtn && bar) {
    // Check if previously dismissed
    if (sessionStorage.getItem('disclaimer-closed')) {
      bar.classList.add('hidden');
    }
    closeBtn.addEventListener('click', () => {
      bar.classList.add('hidden');
      sessionStorage.setItem('disclaimer-closed', 'true');
    });
  }

  // Footer year
  const yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});
