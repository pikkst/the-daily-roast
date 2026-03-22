// ============================================
// The Daily Roast — Donation & Newsletter
// ============================================

(function () {
  'use strict';

  // ---------- Stripe Donation ----------

  let stripeObj = null;

  function loadStripe() {
    // Only load Stripe.js if we have a publishable key
    if (!CONFIG.STRIPE_PUBLISHABLE_KEY) return;

    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.async = true;
    script.onload = () => {
      stripeObj = Stripe(CONFIG.STRIPE_PUBLISHABLE_KEY);
    };
    document.head.appendChild(script);
  }

  function handleDonationClick(btn) {
    const tier = btn.dataset.tier;
    const amount = btn.dataset.amount;

    // Method 1: Stripe Payment Links (simplest — just redirect)
    const paymentLink = CONFIG.STRIPE_PAYMENT_LINKS && CONFIG.STRIPE_PAYMENT_LINKS[tier];
    if (paymentLink) {
      window.open(paymentLink, '_blank');
      return;
    }

    // Method 2: Stripe Checkout with Price IDs
    const priceId = CONFIG.STRIPE_PRICES && CONFIG.STRIPE_PRICES[tier];
    if (priceId && stripeObj) {
      btn.disabled = true;
      btn.style.opacity = '0.6';

      stripeObj.redirectToCheckout({
        lineItems: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        successUrl: window.location.origin + '/?donation=success',
        cancelUrl: window.location.href
      }).then(function (result) {
        if (result.error) {
          alert(result.error.message);
        }
        btn.disabled = false;
        btn.style.opacity = '';
      });
      return;
    }

    // Fallback: No Stripe configured yet  
    showDonationFallback(amount);
  }

  function showDonationFallback(amount) {
    // Show a friendly message that Stripe isn't set up yet
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';
    modal.innerHTML = `
      <div style="background:var(--color-surface,#fff);border-radius:16px;padding:32px;max-width:400px;text-align:center;margin:20px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <div style="font-size:3rem;margin-bottom:12px;">🚧</div>
        <h3 style="font-size:1.2rem;margin-bottom:8px;color:var(--text-primary,#000);">Payment System Coming Soon</h3>
        <p style="color:var(--text-secondary,#666);font-size:0.9rem;line-height:1.5;margin-bottom:20px;">
          Stripe donations (€${amount}/mo) will be available soon!<br>
          Stay tuned.
        </p>
        <button onclick="this.closest('div').parentElement.remove()" 
                style="background:var(--color-primary,#e63946);color:white;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-weight:600;">
          Got it 👍
        </button>
      </div>
    `;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    document.body.appendChild(modal);
  }

  // ---------- Newsletter Signup ----------

  async function handleNewsletterSubmit(form, emailInput, messageEl) {
    const email = emailInput.value.trim();
    if (!email) return;

    const submitBtn = form.querySelector('.newsletter-submit, button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : 'Subscribe';
    
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳';
    }

    try {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase not ready');

      // Try to insert subscriber
      const { data, error } = await sb
        .from('newsletter_subscribers')
        .insert([{ email: email, source: window.location.pathname }])
        .select();

      if (error) {
        // Duplicate email
        if (error.code === '23505' || error.message.includes('duplicate')) {
          showMessage(messageEl, 'You\'re already subscribed! 🎉', 'success');
        } else {
          throw error;
        }
      } else {
        showMessage(messageEl, 'Thanks for subscribing! 🔥📬', 'success');
        emailInput.value = '';
      }
    } catch (err) {
      console.error('Newsletter error:', err);
      showMessage(messageEl, 'Something went wrong. Please try again!', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
      }
    }
  }

  function showMessage(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className = `newsletter-message newsletter-message--${type}`;
    el.style.display = 'block';
    
    setTimeout(() => {
      el.style.display = 'none';
    }, 5000);
  }

  // ---------- Init ----------

  function init() {
    // Load Stripe if configured
    loadStripe();

    // Bind all donation buttons on the page
    document.querySelectorAll('.donation-btn').forEach(btn => {
      btn.addEventListener('click', () => handleDonationClick(btn));
    });

    // Bind article page newsletter form
    const form1 = document.getElementById('newsletter-form');
    if (form1) {
      form1.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('newsletter-email');
        const msg = document.getElementById('newsletter-message');
        handleNewsletterSubmit(form1, email, msg);
      });
    }

    // Bind footer newsletter form  
    const form2 = document.getElementById('footer-newsletter-form');
    if (form2) {
      form2.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('footer-newsletter-email');
        const msg = document.getElementById('footer-newsletter-message');
        handleNewsletterSubmit(form2, email, msg);
      });
    }

    // Check for donation success redirect
    if (window.location.search.includes('donation=success')) {
      showDonationSuccess();
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  function showDonationSuccess() {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;background:#2a9d8f;color:white;padding:16px 24px;border-radius:12px;font-weight:600;box-shadow:0 8px 30px rgba(0,0,0,0.2);animation:fadeInUp 0.5s ease;';
    toast.innerHTML = '🎉 Thanks for your support! You\'re a legend! 🔥';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Also re-init after Supabase is ready (for newsletter)
  window.addEventListener('supabase-ready', () => {
    // Supabase is now available
  });

})();
