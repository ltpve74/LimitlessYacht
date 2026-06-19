/* Progressive preview → sharp fade (slow connections; extend to mobile later). */
(function (g) {
  'use strict';

  g.LY_PROGRESSIVE_IMAGES = !!g.LY_NET_SLOW;
  if (!g.LY_PROGRESSIVE_IMAGES) return;

  var DWELL_MS = 1400;
  var dwellTimers = new WeakMap();
  var sharpQueue = [];
  var sharpPumpActive = false;
  var pendingAfterHero = [];

  g.LY_heroSharpReady = false;
  g.LY_onHeroSharpReady = g.LY_onHeroSharpReady || [];

  g.LY_sharpTierSuffix = function () {
    return g.innerWidth <= 640 ? '-720' : '-960';
  };

  g.LY_previewUrlFromStem = function (stem) {
    return stem + '-prev.webp';
  };

  g.LY_sharpUrlFromStem = function (stem, kind) {
    var suffix = g.LY_sharpTierSuffix();
    if (kind === 'hero' && g.innerWidth > 640) suffix = '-1280';
    return stem + suffix + '.webp';
  };

  function isHeroWrap(wrap) {
    return wrap && wrap.dataset.lyProgKind === 'hero';
  }

  function nonHeroAllowed() {
    return g.LY_heroSharpReady;
  }

  function flushPendingAfterHero() {
    var pending = pendingAfterHero.slice();
    pendingAfterHero = [];
    pending.forEach(function (wrap) {
      if (!wrap.classList.contains('ly-prog-sharp-ready')) {
        g.LY_requestSharpUpgrade(wrap, 'queue');
      }
    });
  }

  function markHeroSharpReady(wrap) {
    if (g.LY_heroSharpReady) return;
    g.LY_heroSharpReady = true;
    if (wrap) wrap.classList.add('ly-prog-hero-done');
    var cbs = g.LY_onHeroSharpReady.slice();
    g.LY_onHeroSharpReady = [];
    cbs.forEach(function (fn) {
      try { fn(); } catch (e) { /* ignore */ }
    });
    flushPendingAfterHero();
    pumpSharpQueue();
  }

  function pickSource(picture) {
    var mob = g.innerWidth <= 640;
    var sel = mob
      ? 'source[type="image/webp"][media*="max-width: 640px"]'
      : 'source[type="image/webp"]:not([media])';
    var source = picture.querySelector(sel);
    return source || picture.querySelector('source[type="image/webp"]');
  }

  function firstUrlFromSrcset(srcset) {
    if (!srcset) return '';
    return (srcset.split(',')[0].trim().split(/\s+/)[0]) || '';
  }

  function stemFromTierUrl(url) {
    return url.replace(/-(?:480|640|720|960|1280|1440|prev)\.webp$/i, '');
  }

  function pictureStem(picture) {
    var source = pickSource(picture);
    var url = source ? firstUrlFromSrcset(source.getAttribute('srcset') || '') : '';
    if (!url) {
      var img = picture.querySelector('img');
      url = (img && img.getAttribute('src')) || '';
      url = url.replace(/\.jpe?g$/i, '.webp');
    }
    return stemFromTierUrl(url);
  }

  function stashPictureSources(picture) {
    picture.querySelectorAll('source').forEach(function (s) {
      var ss = s.getAttribute('srcset');
      if (ss) s.setAttribute('data-ly-orig-srcset', ss);
      s.removeAttribute('srcset');
    });
    var img = picture.querySelector('img');
    if (img) {
      var is = img.getAttribute('srcset');
      if (is) img.setAttribute('data-ly-orig-srcset', is);
      img.removeAttribute('srcset');
    }
  }

  function wrapPicture(picture, kind) {
    if (!picture || picture.closest('.ly-prog-wrap')) return null;
    var stem = pictureStem(picture);
    if (!stem) return null;

    var previewUrl = g.LY_previewUrlFromStem(stem);
    var sharpUrl = g.LY_sharpUrlFromStem(stem, kind);
    stashPictureSources(picture);

    var wrap = g.document.createElement('div');
    wrap.className = 'ly-prog-wrap' + (kind === 'hero' ? ' ly-prog-wrap--hero' : '');
    wrap.dataset.lySharpUrl = sharpUrl;
    wrap.dataset.lyProgKind = kind || 'content';

    var parent = picture.parentNode;
    parent.insertBefore(wrap, picture);

    var preview = g.document.createElement('img');
    preview.className = 'ly-prog-preview';
    preview.src = previewUrl;
    preview.alt = '';
    preview.setAttribute('aria-hidden', 'true');
    preview.decoding = 'async';
    wrap.appendChild(preview);
    wrap.appendChild(picture);

    var img = picture.querySelector('img');
    if (img) {
      img.classList.add('ly-prog-sharp');
      img.removeAttribute('src');
    }

    function previewReady() {
      wrap.classList.add('ly-prog-preview-ready');
    }
    preview.addEventListener('load', previewReady, { once: true });
    if (preview.complete && preview.naturalWidth) previewReady();

    return wrap;
  }

  function commitSharpReveal(wrap, img) {
    wrap.classList.remove('ly-prog-sharp-loading');
    void img.offsetWidth;
    g.requestAnimationFrame(function () {
      g.requestAnimationFrame(function () {
        wrap.classList.add('ly-prog-sharp-ready');
        if (isHeroWrap(wrap)) markHeroSharpReady(wrap);
        var card = wrap.closest('.destination-card, .gallery-item');
        if (card) card.classList.remove('card-loading');
      });
    });
  }

  function revealSharp(wrap) {
    if (!wrap || wrap.classList.contains('ly-prog-sharp-ready')) return;
    if (!nonHeroAllowed() && !isHeroWrap(wrap)) {
      if (pendingAfterHero.indexOf(wrap) < 0) pendingAfterHero.push(wrap);
      return;
    }
    var url = wrap.dataset.lySharpUrl;
    var img = wrap.querySelector('.ly-prog-sharp');
    if (!url || !img) return;

    var gen = (wrap._lySharpGen || 0) + 1;
    wrap._lySharpGen = gen;

    function finish() {
      if (wrap._lySharpGen !== gen) return;
      if (img.decode) {
        img.decode().then(function () { commitSharpReveal(wrap, img); }).catch(function () {
          commitSharpReveal(wrap, img);
        });
      } else {
        commitSharpReveal(wrap, img);
      }
    }

    if (img.src === url && img.complete && img.naturalWidth) {
      finish();
      return;
    }

    wrap.classList.add('ly-prog-sharp-loading');
    img.addEventListener('load', finish, { once: true });
    img.addEventListener('error', function () {
      wrap.classList.remove('ly-prog-sharp-loading');
      if (isHeroWrap(wrap)) markHeroSharpReady(wrap);
    }, { once: true });
    img.src = url;
  }

  function pumpSharpQueue() {
    if (sharpPumpActive || !sharpQueue.length) return;
    if (!nonHeroAllowed()) return;
    if (g.LY_preloadPriorityActive > 0 || (g.LY_priorityPreloadQueue && g.LY_priorityPreloadQueue.length)) {
      g.setTimeout(pumpSharpQueue, 220);
      return;
    }
    var wrap = sharpQueue.shift();
    if (!wrap || wrap.classList.contains('ly-prog-sharp-ready')) {
      pumpSharpQueue();
      return;
    }
    var url = wrap.dataset.lySharpUrl;
    if (!url) {
      pumpSharpQueue();
      return;
    }
    sharpPumpActive = true;
    if (g.LY_loadPreloadImage) {
      g.LY_loadPreloadImage(url, function () {
        sharpPumpActive = false;
        revealSharp(wrap);
        pumpSharpQueue();
      });
    } else {
      revealSharp(wrap);
      sharpPumpActive = false;
      pumpSharpQueue();
    }
  }

  function enqueueSharp(wrap) {
    if (!wrap || wrap.classList.contains('ly-prog-sharp-ready')) return;
    if (!nonHeroAllowed()) {
      if (pendingAfterHero.indexOf(wrap) < 0) pendingAfterHero.push(wrap);
      return;
    }
    if (sharpQueue.indexOf(wrap) >= 0) return;
    sharpQueue.push(wrap);
    pumpSharpQueue();
  }

  function startHeroSharp(wrap) {
    if (!wrap || g.LY_heroSharpReady) return;
    var url = wrap.dataset.lySharpUrl;
    if (!url) return;
    if (g.LY_abortWarmQueues) g.LY_abortWarmQueues();
    if (g.LY_prioritizePreloadUrgent) g.LY_prioritizePreloadUrgent(url);
    if (g.LY_preloadedUrls && g.LY_preloadedUrls[url]) {
      revealSharp(wrap);
      return;
    }
    revealSharp(wrap);
  }

  g.LY_requestSharpUpgrade = function (el, priority) {
    var wrap = el && el.closest ? el.closest('.ly-prog-wrap') : el;
    if (!wrap || wrap.classList.contains('ly-prog-sharp-ready')) return;

    if (isHeroWrap(wrap)) {
      startHeroSharp(wrap);
      return;
    }

    if (!nonHeroAllowed()) {
      if (pendingAfterHero.indexOf(wrap) < 0) pendingAfterHero.push(wrap);
      return;
    }

    var url = wrap.dataset.lySharpUrl;
    if (!url) return;

    if (priority === 'urgent') {
      var qi = sharpQueue.indexOf(wrap);
      if (qi >= 0) sharpQueue.splice(qi, 1);
      if (g.LY_prioritizePreloadUrgent) g.LY_prioritizePreloadUrgent(url);
      if (g.LY_preloadedUrls && g.LY_preloadedUrls[url]) {
        revealSharp(wrap);
        return;
      }
      revealSharp(wrap);
      return;
    }
    enqueueSharp(wrap);
  };

  g.LY_revealProgressiveForUrl = function (url) {
    if (!url) return;
    g.document.querySelectorAll('.ly-prog-wrap').forEach(function (wrap) {
      if (wrap.dataset.lySharpUrl !== url) return;
      if (wrap.classList.contains('ly-prog-sharp-ready')) return;
      if (!nonHeroAllowed() && !isHeroWrap(wrap)) return;
      revealSharp(wrap);
    });
  };

  g.LY_upgradeProgressiveForIntent = function (opts) {
    if (!nonHeroAllowed()) return;
    opts = opts || {};
    var urls = (opts.urgentUrls || []).filter(Boolean);
    var upgraded = {};
    g.document.querySelectorAll('.ly-prog-wrap').forEach(function (wrap) {
      var sharp = wrap.dataset.lySharpUrl;
      if (sharp && urls.indexOf(sharp) >= 0 && !upgraded[wrap]) {
        upgraded[wrap] = 1;
        g.LY_requestSharpUpgrade(wrap, 'urgent');
      }
    });
    if (opts.context && g.LY_cardsForContext) {
      g.LY_cardsForContext(opts.context).forEach(function (card) {
        var wrap = card.querySelector('.ly-prog-wrap');
        if (wrap && !upgraded[wrap]) {
          upgraded[wrap] = 1;
          g.LY_requestSharpUpgrade(wrap, 'urgent');
        }
      });
    }
  };

  g.LY_initProgressiveImages = function () {
    var wraps = [];
    var heroWrap = null;
    var hero = g.document.querySelector('#hero .hero-bg-wrap');
    if (hero) {
      heroWrap = wrapPicture(hero, 'hero');
      if (heroWrap) wraps.push(heroWrap);
    }

    g.document.querySelectorAll('#about .about-image-wrap picture').forEach(function (pic) {
      var w = wrapPicture(pic, 'about');
      if (w) wraps.push(w);
    });
    g.document.querySelectorAll('.destination-card-bg').forEach(function (pic) {
      var w = wrapPicture(pic, 'dest');
      if (w) wraps.push(w);
    });
    g.document.querySelectorAll('.gallery-item picture').forEach(function (pic) {
      var w = wrapPicture(pic, 'gallery');
      if (w) wraps.push(w);
    });

    if ('IntersectionObserver' in g) {
      var dwellIo = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var wrap = entry.target;
          if (isHeroWrap(wrap)) return;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.42) {
            if (dwellTimers.get(wrap)) return;
            var timer = g.setTimeout(function () {
              dwellTimers.delete(wrap);
              g.LY_requestSharpUpgrade(wrap, 'queue');
            }, DWELL_MS);
            dwellTimers.set(wrap, timer);
          } else {
            var t = dwellTimers.get(wrap);
            if (t) {
              g.clearTimeout(t);
              dwellTimers.delete(wrap);
            }
          }
        });
      }, { threshold: [0, 0.42, 0.65] });
      wraps.forEach(function (wrap) {
        if (!isHeroWrap(wrap)) dwellIo.observe(wrap);
      });
    }

    if (heroWrap) {
      function kickHero() {
        startHeroSharp(heroWrap);
      }
      if (heroWrap.classList.contains('ly-prog-preview-ready')) kickHero();
      else {
        var prev = heroWrap.querySelector('.ly-prog-preview');
        if (prev) prev.addEventListener('load', kickHero, { once: true });
        else kickHero();
      }
    }
  };

  if (g.document.readyState === 'loading') {
    g.document.addEventListener('DOMContentLoaded', g.LY_initProgressiveImages);
  } else {
    g.LY_initProgressiveImages();
  }
})(window);