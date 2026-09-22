/* Cookie banner + bottom chrome heights (--ly-cookie-h / --ly-sticky-cta-h).
   Loaded deferred after #cookie-consent. Calendar calls window.LY_syncBottomChrome.
 */
(function () {
  function lyMeasureCookie() {
    var el = document.getElementById('cookie-consent');
    if (!el || el.hidden || el.classList.contains('is-hiding')) return 0;
    return el.offsetHeight || 0;
  }
  function lyMeasureSticky() {
    var el = document.getElementById('calStickyCta');
    if (!el || el.hidden) return 0;
    return el.offsetHeight || 0;
  }
  window.LY_syncBottomChrome = function () {
    var ch = lyMeasureCookie();
    var sh = lyMeasureSticky();
    var root = document.documentElement;
    root.style.setProperty('--ly-cookie-h', ch + 'px');
    root.style.setProperty('--ly-sticky-cta-h', sh + 'px');
    root.classList.toggle('ly-cookie-open', ch > 0);
    root.classList.toggle('ly-cal-sticky-open', sh > 0);
  };
  function bind() {
    window.LY_syncBottomChrome();
    var cookie = document.getElementById('cookie-consent');
    if (cookie && 'MutationObserver' in window) {
      new MutationObserver(function () { window.LY_syncBottomChrome(); }).observe(cookie, { attributes: true, attributeFilter: ['hidden', 'class'] });
    }
    window.addEventListener('resize', function () { window.LY_syncBottomChrome(); }, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () { window.LY_syncBottomChrome(); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();

(function () { if (window.LY_OWNER_MODE) return; var KEY = 'ly_consent'; var banner = document.getElementById('cookie-consent'); function push(){ window.dataLayer = window.dataLayer || []; window.dataLayer.push(arguments); } function show(){ banner.classList.remove('is-hiding'); banner.hidden = false; } function hide(){ banner.classList.add('is-hiding'); setTimeout(function(){ banner.hidden = true; }, 520); } function choose(value) { try { localStorage.setItem(KEY, value); } catch (e) {} try { if (value === 'granted') { push('consent', 'update', { 'analytics_storage': 'granted', 'ad_storage': 'granted', 'ad_user_data': 'granted', 'ad_personalization': 'granted' }); if (window.LY_setClarityConsent) window.LY_setClarityConsent(true); document.dispatchEvent(new CustomEvent('ly-consent-granted')); if (window.LY_initBehaviorAnalytics) window.LY_initBehaviorAnalytics(); if (window._ly_loadAnalytics) window._ly_loadAnalytics(); if (window._ly_loadClarity) window._ly_loadClarity(); } else if (value === 'denied') { if (window.LY_setClarityConsent) window.LY_setClarityConsent(false); } } catch (e) {} hide(); } var stored; try { stored = localStorage.getItem(KEY); } catch (e) {} if (stored !== 'granted' && stored !== 'denied') { setTimeout(show, 6000); } document.getElementById('cookie-accept').addEventListener('click', function () { choose('granted'); }); document.getElementById('cookie-decline').addEventListener('click', function () { choose('denied'); }); var settings = document.getElementById('cookie-settings-link'); if (settings) settings.addEventListener('click', function (e) { e.preventDefault(); show(); }); var closeBtn = document.getElementById('cookie-close'); if (closeBtn) { closeBtn.addEventListener('click', function () { choose('denied'); }); } function autoAcceptOnInteraction() { var cur = ''; try { cur = localStorage.getItem(KEY) || ''; } catch(e){} if (cur !== 'granted' && cur !== 'denied') { choose('granted'); } } document.addEventListener('touchstart', autoAcceptOnInteraction, { once: true, passive: true }); window.addEventListener('scroll', autoAcceptOnInteraction, { once: true, passive: true }); document.addEventListener('click', autoAcceptOnInteraction, { once: true }); function autoAcceptOnEngagement() { var current = ''; try { current = localStorage.getItem(KEY) || ''; } catch(e){} if (current !== 'granted' && current !== 'denied') { choose('granted'); } } document.querySelectorAll('.btn-primary, .nav-cta, a[href="#charters"], a[href="#avail-cal"], a[href="#availability"], a[href*="wa.me"]').forEach(function (el) { el.addEventListener('click', function () { setTimeout(autoAcceptOnEngagement, 0); }, { once: true }); }); })();
