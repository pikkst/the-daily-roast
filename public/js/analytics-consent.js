// ============================================
// Analytics consent gate (Google Analytics)
// ============================================

(function () {
  'use strict';

  var STORAGE_KEY = 'tdr_analytics_consent';
  var GA_ID = 'G-H32XR5CLPX';
  var loaded = false;

  function loadAnalytics() {
    if (loaded) return;
    loaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };

    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    script.onload = function () {
      window.gtag('js', new Date());
      window.gtag('config', GA_ID, { anonymize_ip: true });
    };
    document.head.appendChild(script);
  }

  function setConsent(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (_) {
      // Ignore storage failures.
    }
  }

  function getConsent() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function closeBanner(banner) {
    if (banner && banner.parentNode) {
      banner.parentNode.removeChild(banner);
    }
  }

  function showBanner() {
    var banner = document.createElement('div');
    banner.id = 'tdr-consent-banner';
    banner.style.cssText = [
      'position:fixed',
      'left:16px',
      'right:16px',
      'bottom:16px',
      'z-index:9999',
      'background:#111827',
      'color:#f9fafb',
      'border:1px solid #374151',
      'border-radius:12px',
      'padding:14px 16px',
      'box-shadow:0 10px 30px rgba(0,0,0,0.35)',
      'display:flex',
      'gap:12px',
      'align-items:center',
      'justify-content:space-between',
      'flex-wrap:wrap'
    ].join(';');

    banner.innerHTML = '' +
      '<div style="max-width:720px;font-size:14px;line-height:1.4;">' +
      '<strong>Analytics consent</strong> - We use anonymous analytics to improve the site. ' +
      'You can accept or decline.' +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
      '<button id="tdr-consent-decline" style="background:#374151;color:#f9fafb;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;">Decline</button>' +
      '<button id="tdr-consent-accept" style="background:#dc3545;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;">Accept</button>' +
      '</div>';

    document.body.appendChild(banner);

    var acceptBtn = document.getElementById('tdr-consent-accept');
    var declineBtn = document.getElementById('tdr-consent-decline');

    if (acceptBtn) {
      acceptBtn.addEventListener('click', function () {
        setConsent('yes');
        loadAnalytics();
        closeBanner(banner);
      });
    }

    if (declineBtn) {
      declineBtn.addEventListener('click', function () {
        setConsent('no');
        closeBanner(banner);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var consent = getConsent();
    if (consent === 'yes') {
      loadAnalytics();
      return;
    }
    if (consent === 'no') {
      return;
    }
    showBanner();
  });
})();
