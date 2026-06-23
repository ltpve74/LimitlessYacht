/* Path bootstrap + split CSS: layout.css (reveal) then main.css (enhance). */
(function (g) {
  'use strict';
  var d = g.document;
  var h = g.location.hostname;
  var parts = g.location.pathname.split('/').filter(Boolean);
  var gh = h.endsWith('.github.io') && parts[0] ? '/' + parts[0] : '';
  var langParts = gh ? parts.slice(1) : parts;
  var lang = langParts[0] || '';
  var locale = lang === 'de' || lang === 'fr' || lang === 'es';
  var cssRoot = locale ? '../css/' : 'css/';
  var fontPath = (locale ? '../' : '') + 'fonts/montserrat-latin.woff2';

  g.LY_PROGRESSIVE_IMAGES = true;
  g.LY_IMG_ROOT = gh + (locale || gh ? '/images/' : 'images/');
  g.LY_layoutCssLoaded = false;
  g.LY_mainCssLoaded = false;
  g.LY_fontLoaded = false;

  function layoutCssApplies() {
    if (!g.getComputedStyle) return false;
    var card = d.querySelector('.destination-card');
    return !!(card && g.getComputedStyle(card).position === 'relative');
  }

  function finishLayoutCss(cb) {
    if (g.LY_layoutCssLoaded) {
      if (cb) cb();
      return;
    }
    g.LY_layoutCssLoaded = true;
    g.LY_layoutCssLoading = false;
    if (g.LY_kickProgressiveAfterReveal) g.LY_kickProgressiveAfterReveal();
    if (g.LY_markMainReady) g.LY_markMainReady();
    else {
      g.requestAnimationFrame(function () {
        g.requestAnimationFrame(function () {
          d.documentElement.classList.add('ly-main-ready');
        });
      });
    }
    g.setTimeout(function () {
      if (g.LY_scheduleMainCss) g.LY_scheduleMainCss();
    }, 10000);
    if (cb) cb();
  }

  g.LY_mainCssScheduled = false;
  g.LY_scheduleMainCss = function () {
    if (g.LY_mainCssScheduled || g.LY_mainCssLoaded) return;
    g.LY_mainCssScheduled = true;
    g.LY_loadMainCss();
  };

  function afterLayoutSheetEvent(link, cb) {
    function done() {
      g.requestAnimationFrame(function () {
        g.requestAnimationFrame(function () {
          finishLayoutCss(cb);
        });
      });
    }
    if (layoutCssApplies()) {
      done();
      return;
    }
    var tries = 0;
    function tick() {
      if (layoutCssApplies() || tries++ > 120) {
        done();
        return;
      }
      g.requestAnimationFrame(tick);
    }
    tick();
  }

  g.LY_loadLayoutCss = function (cb) {
    if (g.LY_layoutCssLoaded) {
      if (cb) cb();
      return;
    }
    if (g.LY_layoutCssLoading) {
      if (cb) (g.LY_onLayoutCssReady = g.LY_onLayoutCssReady || []).push(cb);
      return;
    }
    g.LY_layoutCssLoading = true;
    var href = g.LY_LAYOUT_CSS_HREF || (cssRoot + 'layout.css?v=14');
    var l = d.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    var started = false;
    function begin() {
      if (started) return;
      started = true;
      afterLayoutSheetEvent(l, cb);
    }
    l.onload = begin;
    l.onerror = begin;
    d.head.appendChild(l);
    if (l.sheet) begin();
  };

  g.LY_loadMainCss = function (cb) {
    if (g.LY_mainCssLoaded) {
      if (cb) cb();
      return;
    }
    if (g.LY_mainCssLoading) {
      if (cb) (g.LY_onMainCssReady = g.LY_onMainCssReady || []).push(cb);
      return;
    }
    g.LY_mainCssLoading = true;
    var href = g.LY_MAIN_CSS_HREF || (cssRoot + 'main.css?v=159');
    var l = d.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    function finish() {
      g.LY_mainCssLoaded = true;
      g.LY_mainCssLoading = false;
      var cbs = g.LY_onMainCssReady || [];
      g.LY_onMainCssReady = [];
      cbs.forEach(function (fn) { try { fn(); } catch (e) {} });
      if (cb) cb();
    }
    l.onload = finish;
    l.onerror = finish;
    d.head.appendChild(l);
    if (l.sheet) finish();
  };

  g.LY_loadFont = function () {
    if (g.LY_fontLoaded) return;
    g.LY_fontLoaded = true;
    var style = d.createElement('style');
    style.textContent = "@font-face{font-family:'Montserrat';font-style:normal;font-weight:300 600;font-display:optional;src:url('"
      + fontPath + "') format('woff2')}";
    d.head.appendChild(style);
  };

  /* Back-compat: progressive-images still calls LY_loadMainCss at hero preview */
  g.LY_loadMainCssEarly = g.LY_loadLayoutCss;

  setTimeout(function () {
    if (!g.LY_layoutCssLoaded) g.LY_loadLayoutCss();
  }, 12000);
})(window);