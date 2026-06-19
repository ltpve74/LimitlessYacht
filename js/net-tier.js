/* Connection-tier image tuning — sync in <head> before hero preloads. */
(function (g) {
  'use strict';
  var d = g.document;
  var h = g.location.hostname;
  var parts = g.location.pathname.split('/').filter(Boolean);
  var gh = h.endsWith('.github.io') && parts[0] ? '/' + parts[0] : '';
  var langParts = gh ? parts.slice(1) : parts;
  var lang = langParts[0] || '';
  var locale = lang === 'de' || lang === 'fr' || lang === 'es';
  var imgRoot = gh + (locale || gh ? '/images/' : 'images/');

  function lyImg(suffix) {
    return imgRoot + suffix;
  }

  function lySlow() {
    try {
      var q = new URLSearchParams(g.location.search).get('ly_net');
      if (q === 'slow') return true;
      if (q === 'normal') return false;
    } catch (e) {}
    var c = g.navigator.connection || g.navigator.mozConnection || g.navigator.webkitConnection;
    if (!c) return false;
    if (c.saveData) return true;
    var et = c.effectiveType || '';
    if (et === 'slow-2g' || et === '2g' || et === '3g') return true;
    if (typeof c.downlink === 'number' && c.downlink > 0 && c.downlink < 1.4) return true;
    if (typeof c.rtt === 'number' && c.rtt > 500) return true;
    return false;
  }

  function lyCapSrcset(srcset, maxW) {
    if (!srcset || !maxW || maxW >= 9999) return srcset || '';
    return srcset.split(',').map(function (part) { return part.trim(); }).filter(function (part) {
      var m = part.match(/\s(\d+)w$/);
      return m && parseInt(m[1], 10) <= maxW;
    }).join(', ');
  }

  function lyMaxW() {
    if (!g.LY_NET_SLOW) return 9999;
    return g.innerWidth <= 640 ? 480 : 640;
  }

  function lyInjectPreload(href, srcset, sizes, media) {
    var link = d.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.type = 'image/webp';
    link.fetchPriority = 'high';
    if (media) link.media = media;
    if (srcset) {
      link.setAttribute('imagesrcset', srcset);
      if (sizes) link.setAttribute('imagesizes', sizes);
    } else if (href) {
      link.href = href;
    }
    d.head.appendChild(link);
  }

  function lyApplyPictureSrc(root) {
    (root || d).querySelectorAll('picture source[data-ly-srcset]').forEach(function (s) {
      s.setAttribute('srcset', s.getAttribute('data-ly-srcset'));
    });
    (root || d).querySelectorAll('picture img[data-ly-src]').forEach(function (img) {
      if (!img.getAttribute('src')) img.setAttribute('src', img.getAttribute('data-ly-src'));
    });
  }

  g.LY_applyPictureSrc = lyApplyPictureSrc;

  var slow = lySlow();
  g.LY_NET_SLOW = slow;
  g.LY_PROGRESSIVE_IMAGES = slow;
  g.LY_NET_TIER = slow ? 'slow' : 'normal';
  g.LY_PRELOAD_AGGRESSIVE = !slow;
  g.LY_PRELOAD_PUMP_MS = slow ? 900 : 160;
  g.LY_PRELOAD_IDLE_DELAY_MS = slow ? 4500 : 2000;
  g.LY_PRELOAD_QUEUE_MAX = slow ? 8 : 64;
  g.LY_IMG_ROOT = imgRoot;
  g.LY_capSrcset = lyCapSrcset;
  g.LY_maxImgWidth = lyMaxW;
  d.documentElement.dataset.lyNet = g.LY_NET_TIER;

  if (slow) {
    var progCrit = d.createElement('style');
    progCrit.id = 'ly-prog-critical';
    progCrit.textContent = [
      'html[data-ly-net="slow"] #hero{background:#0a1628}',
      'html[data-ly-net="slow"] .ly-prog-wrap--hero{position:absolute;inset:0;overflow:hidden;background:#0a1628}',
      'html[data-ly-net="slow"] .ly-prog-wrap--hero .hero-bg-wrap{position:absolute;inset:0;display:block;width:100%;height:100%;overflow:hidden}',
      'html[data-ly-net="slow"] .ly-prog-wrap--hero .ly-prog-preview,',
      'html[data-ly-net="slow"] .ly-prog-wrap--hero .hero-bg.ly-prog-sharp{',
      'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:58% 48%;display:block}',
      'html[data-ly-net="slow"] .ly-prog-wrap--hero .ly-prog-preview{z-index:0;opacity:1;',
      'transform:scale(1.08);filter:blur(8px) saturate(1.08) brightness(.92)}',
      'html[data-ly-net="slow"] .ly-prog-wrap--hero .hero-bg.ly-prog-sharp{z-index:1;opacity:0;',
      'transform:scale(1.05);filter:brightness(1.02) saturate(1.04)}',
      'html[data-ly-net="slow"] .ly-prog-wrap--hero.ly-prog-sharp-loading .hero-bg.ly-prog-sharp{opacity:0}',
      'html[data-ly-net="slow"] .ly-prog-wrap--hero.ly-prog-sharp-ready.ly-prog-sharp-visible .hero-bg.ly-prog-sharp{',
      'opacity:1;transition:opacity .55s cubic-bezier(.25,.9,.35,1)}',
      'html[data-ly-net="slow"] .ly-prog-wrap--hero.ly-prog-sharp-ready.ly-prog-sharp-visible .ly-prog-preview{',
      'opacity:0;filter:blur(4px);transform:scale(1.03);transition:opacity .7s ease,filter .7s ease,transform .7s ease}',
      'html[data-ly-net="slow"] .ly-prog-wrap--hero.ly-prog-skip-preview .ly-prog-preview{display:none}',
      '@media(max-width:768px){',
      'html[data-ly-net="slow"] #hero .hero-overlay{background:',
      'linear-gradient(180deg,rgba(10,22,40,.46) 0%,transparent 20%),',
      'linear-gradient(0deg,rgba(10,22,40,.58) 0%,transparent 28%)}',
      'html[data-ly-net="slow"] #hero .hero-content::before{',
      'height:min(38%,13rem);background:linear-gradient(180deg,rgba(10,22,40,.84) 0%,rgba(10,22,40,.32) 68%,transparent 100%)}',
      'html[data-ly-net="slow"] #hero .hero-content::after{',
      'height:min(44%,16rem);background:linear-gradient(0deg,rgba(10,22,40,.9) 0%,rgba(10,22,40,.36) 55%,transparent 100%)}',
      'html[data-ly-net="slow"] #hero .hero-eyebrow{letter-spacing:.06em;padding-top:.2rem;margin-bottom:.25rem}',
      'html[data-ly-net="slow"] #hero .hero-top .hero-sub{margin-top:.15rem;',
      'font-size:clamp(.74rem,3.2vw,.82rem);line-height:1.5}',
      'html[data-ly-net="slow"] .hamburger{display:flex!important}',
      'html[data-ly-net="slow"] .ly-prog-wrap--hero .ly-prog-preview,',
      'html[data-ly-net="slow"] .ly-prog-wrap--hero .hero-bg.ly-prog-sharp{object-position:52% 40%}',
      'html[data-ly-net="slow"] .ly-prog-wrap--hero .hero-bg.ly-prog-sharp,',
      'html[data-ly-net="slow"] .ly-prog-wrap--hero.ly-prog-sharp-ready.ly-prog-sharp-visible .hero-bg.ly-prog-sharp{',
      'transform:none;animation:none;filter:brightness(1.04) saturate(1.06)}',
      '}',
    ].join('');
    d.head.appendChild(progCrit);
  }

  var mobMq = g.matchMedia('(max-width: 640px)');
  if (mobMq.matches) {
    if (slow) {
      lyInjectPreload(lyImg('mobile/maiora_20s_02-prev.webp'), null, null, '(max-width: 640px)');
    } else {
      lyInjectPreload(null, lyImg('mobile/maiora_20s_02-480.webp') + ' 480w, ' +
        lyImg('mobile/maiora_20s_02-720.webp') + ' 720w, ' +
        lyImg('mobile/maiora_20s_02-960.webp') + ' 960w', '100vw', '(max-width: 640px)');
    }
  } else {
    if (slow) {
      lyInjectPreload(lyImg('maiora_20s_02-prev.webp'), null, null, '(min-width: 641px)');
    } else {
      lyInjectPreload(null, lyImg('maiora_20s_02-640.webp') + ' 640w, ' +
        lyImg('maiora_20s_02-960.webp') + ' 960w, ' +
        lyImg('maiora_20s_02-1280.webp') + ' 1280w, ' +
        lyImg('maiora_20s_02.webp') + ' 1920w', '100vw', '(min-width: 641px)');
    }
  }

  if (!slow) {
    var font = d.createElement('link');
    font.rel = 'preload';
    font.as = 'font';
    font.type = 'font/woff2';
    font.crossOrigin = 'anonymous';
    font.href = locale ? '../fonts/montserrat-latin.woff2' : 'fonts/montserrat-latin.woff2';
    d.head.appendChild(font);
    if (d.readyState === 'loading') {
      d.addEventListener('DOMContentLoaded', function () { lyApplyPictureSrc(); });
    } else {
      lyApplyPictureSrc();
    }
  }

  if (slow) {
    g.LY_mainCssLoaded = false;
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
      var cssHref = g.LY_MAIN_CSS_HREF || (locale ? '../css/main.css?v=111' : 'css/main.css?v=111');
      var l = d.createElement('link');
      l.rel = 'stylesheet';
      l.href = cssHref;
      l.onload = function () {
        g.LY_mainCssLoaded = true;
        g.LY_mainCssLoading = false;
        if (g.LY_markMainReady) g.LY_markMainReady();
        else {
          g.requestAnimationFrame(function () {
            g.requestAnimationFrame(function () {
              d.documentElement.classList.add('ly-main-ready');
            });
          });
        }
        var cbs = g.LY_onMainCssReady || [];
        g.LY_onMainCssReady = [];
        cbs.forEach(function (fn) { try { fn(); } catch (e) {} });
        if (cb) cb();
      };
      d.head.appendChild(l);
    };
  }

  function lyCapHero() {
    if (g.LY_PROGRESSIVE_IMAGES) return true;
    if (!g.LY_NET_SLOW) return true;
    var wrap = d.querySelector('#hero .hero-bg-wrap');
    if (!wrap) return false;
    var max = lyMaxW();
    var capped = lyImg(max <= 480 ? 'mobile/maiora_20s_02-480.webp' : 'maiora_20s_02-640.webp');
    wrap.querySelectorAll('source').forEach(function (s) {
      var ss = s.getAttribute('srcset') || s.getAttribute('data-ly-srcset');
      if (ss) {
        var next = lyCapSrcset(ss, max);
        if (next) s.setAttribute('srcset', next);
      }
    });
    var img = wrap.querySelector('img.hero-bg');
    if (img && !img.complete) {
      img.removeAttribute('srcset');
      img.src = capped;
    }
    return true;
  }

  function lyPollHero() {
    if (lyCapHero()) return;
    if (d.readyState === 'loading') g.requestAnimationFrame(lyPollHero);
  }
  lyPollHero();
})(window);