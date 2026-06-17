/**
 * Temporary behaviour analytics: section visibility, scroll depth, time on page.
 * Fires dataLayer events for GTM/GA4.
 * Only runs when cookie consent (ly_consent) is granted.
 * Clarity is loaded separately via the official head tag + clarity-consent.js.
 */
(function (global) {
  'use strict';

  var CONFIG = global.LY_ANALYTICS || {};
  var CONSENT_KEY = 'ly_consent';
  var SECTION_IDS = [
    'hero', 'intro', 'about', 'specs', 'gallery', 'amenities',
    'itinerary', 'reviews', 'charters', 'availability', 'contact'
  ];
  var DWELL_SEC = Number(CONFIG.sectionDwellSeconds) || 3;
  var VISIBLE_RATIO = Number(CONFIG.sectionVisibleRatio) || 0.4;
  var SCROLL_MARKS = [25, 50, 75, 90, 100];
  var TIME_MARKS = [30, 60, 120, 180, 300];
  var started = false;
  var startMs = 0;
  var scrollFired = {};
  var timeFired = {};
  var sectionState = {};
  var sessionSections = {};

  function hasConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY) === 'granted';
    } catch (e) {
      return false;
    }
  }

  function debug() {
    if (!/ly_debug=1/.test(global.location.search)) return;
    console.log.apply(console, ['[LY analytics]'].concat([].slice.call(arguments)));
  }

  function push(event, params) {
    global.dataLayer = global.dataLayer || [];
    var payload = Object.assign({ event: event }, params || {});
    global.dataLayer.push(payload);
    debug(event, params);
  }

  function pageMeta() {
    var html = document.documentElement;
    return {
      page_language: html.lang || 'en',
      page_path: global.location.pathname || '/',
      page_title: document.title || ''
    };
  }

  function trackScrollDepth() {
    var doc = document.documentElement;
    var max = Math.max(
      doc.scrollHeight - doc.clientHeight,
      document.body.scrollHeight - document.body.clientHeight,
      1
    );
    var pct = Math.min(100, Math.round((global.scrollY / max) * 100));

    SCROLL_MARKS.forEach(function (mark) {
      if (scrollFired[mark] || pct < mark) return;
      scrollFired[mark] = true;
      push('scroll_depth', Object.assign({
        scroll_percent: mark,
        max_scroll_percent: pct
      }, pageMeta()));
    });
  }

  function trackTimeOnPage() {
    var elapsed = Math.round((Date.now() - startMs) / 1000);
    TIME_MARKS.forEach(function (mark) {
      if (timeFired[mark] || elapsed < mark) return;
      timeFired[mark] = true;
      push('engagement_time', Object.assign({
        engagement_seconds: mark
      }, pageMeta()));
    });
  }

  function flushSection(id, dwellMs) {
    var sec = Math.round(dwellMs / 1000);
    if (sec < DWELL_SEC) return;
    sessionSections[id] = (sessionSections[id] || 0) + sec;
    push('section_view', Object.assign({
      section_id: id,
      section_dwell_seconds: sec,
      section_engaged: true
    }, pageMeta()));
  }

  function initSections() {
    var observer = new IntersectionObserver(function (entries) {
      var now = Date.now();
      entries.forEach(function (entry) {
        var id = entry.target.id;
        if (!id || SECTION_IDS.indexOf(id) === -1) return;

        var st = sectionState[id] || { visible: false, enteredAt: 0 };

        if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO) {
          if (!st.visible) {
            st.visible = true;
            st.enteredAt = now;
            push('section_enter', Object.assign({ section_id: id }, pageMeta()));
          }
        } else if (st.visible) {
          flushSection(id, now - st.enteredAt);
          st.visible = false;
          st.enteredAt = 0;
        }
        sectionState[id] = st;
      });
    }, { threshold: [0, 0.25, 0.4, 0.5, 0.75, 1] });

    SECTION_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    function onLeave() {
      var now = Date.now();
      SECTION_IDS.forEach(function (id) {
        var st = sectionState[id];
        if (st && st.visible) flushSection(id, now - st.enteredAt);
      });
      var sections = Object.keys(sessionSections);
      if (!sections.length) return;
      push('session_sections_summary', Object.assign({
        sections_viewed: sections.join(','),
        sections_count: sections.length,
        total_engaged_seconds: sections.reduce(function (n, k) {
          return n + sessionSections[k];
        }, 0),
        time_on_page_seconds: Math.round((now - startMs) / 1000)
      }, pageMeta()));
    }

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') onLeave();
    });
    global.addEventListener('pagehide', onLeave);
  }

  function start() {
    if (started || !hasConsent() || global.LY_OWNER_MODE) return;
    started = true;
    startMs = Date.now();

    push('behavior_analytics_start', pageMeta());
    initSections();

    global.addEventListener('scroll', trackScrollDepth, { passive: true });
    trackScrollDepth();

    setInterval(trackTimeOnPage, 5000);
    trackTimeOnPage();

    debug('started');
  }

  global.LY_initBehaviorAnalytics = start;

  if (hasConsent()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  document.addEventListener('ly-consent-granted', start);
})(window);