/**
 * Microsoft Clarity ConsentV2 — works with the official <head> tag.
 * Denied by default; granted when ly_consent is accepted.
 */
(function (global) {
  'use strict';

  function clarityConsent(adStorage, analyticsStorage) {
    var fn = global.clarity;
    if (typeof fn !== 'function') return;
    fn('consentv2', {
      ad_Storage: adStorage,
      analytics_Storage: analyticsStorage
    });
  }

  function applyFromStorage() {
    var granted = false;
    try {
      granted = localStorage.getItem('ly_consent') === 'granted';
    } catch (e) {}
    if (granted) {
      clarityConsent('granted', 'granted');
    } else {
      clarityConsent('denied', 'denied');
    }
  }

  global.LY_setClarityConsent = function (granted) {
    if (granted) {
      clarityConsent('granted', 'granted');
      return;
    }
    clarityConsent('denied', 'denied');
    if (typeof global.clarity === 'function') {
      try {
        global.clarity('consent', false);
      } catch (e) {}
    }
  };

  applyFromStorage();
})(window);