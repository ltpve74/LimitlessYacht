/* Progressive preview → sharp fade (slow connections; extend to mobile later). */
(function (g) {
  'use strict';

  g.LY_PROGRESSIVE_IMAGES = !!g.LY_NET_SLOW;
  if (!g.LY_PROGRESSIVE_IMAGES) return;

  var visibleIo = null;
  var pendingAfterHero = [];
  var contentQueue = [];
  var contentBusy = false;

  g.LY_heroGateOpen = false;
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

  function gateOpen() {
    return g.LY_heroGateOpen;
  }

  function isHeroWrap(wrap) {
    return wrap && wrap.dataset.lyProgKind === 'hero';
  }

  function isHeroPicture(picture) {
    return !!(picture && (picture.classList.contains('hero-bg-wrap') || picture.closest('#hero')));
  }

  function sharpIsCached(url) {
    return !!(url && g.LY_preloadedUrls && g.LY_preloadedUrls[url]);
  }

  function runHeroGateCallbacks() {
    var cbs = g.LY_onHeroSharpReady.slice();
    g.LY_onHeroSharpReady = [];
    cbs.forEach(function (fn) {
      try { fn(); } catch (e) { /* ignore */ }
    });
  }

  function afterHeroGateOpen() {
    g.LY_initDeferredProgressiveImages();
    runHeroGateCallbacks();
    flushPendingAfterHero();
  }

  function openHeroGate(wrap) {
    if (g.LY_heroGateOpen) return;
    g.LY_heroGateOpen = true;
    g.LY_heroSharpReady = true;
    if (wrap) wrap.classList.add('ly-prog-hero-done');
    g.requestAnimationFrame(function () {
      g.requestAnimationFrame(function () {
        if (g.LY_loadMainCss) {
          g.LY_loadMainCss(afterHeroGateOpen);
        } else {
          afterHeroGateOpen();
        }
      });
    });
  }

  function scheduleHeroGate(wrap) {
    g.requestAnimationFrame(function () {
      openHeroGate(wrap);
    });
  }

  function releaseContentSlot(wrap) {
    if (contentQueue.length && contentQueue[0] === wrap) contentQueue.shift();
    contentBusy = false;
    pumpContentQueue();
  }

  function pumpContentQueue() {
    if (contentBusy || !contentQueue.length) return;
    var wrap = contentQueue[0];
    if (wrap.classList.contains('ly-prog-sharp-ready')) {
      contentQueue.shift();
      pumpContentQueue();
      return;
    }
    contentBusy = true;
    if (!wrap.dataset.lyActivated) wrap.dataset.lyActivated = '1';
    wrap._lyQueueDone = function () { releaseContentSlot(wrap); };
    revealSharp(wrap);
  }

  function enqueueContentWrap(wrap, front) {
    if (!wrap || isHeroWrap(wrap)) return;
    var i = contentQueue.indexOf(wrap);
    if (i >= 0) contentQueue.splice(i, 1);
    if (front) contentQueue.unshift(wrap);
    else contentQueue.push(wrap);
    pumpContentQueue();
  }

  function flushPendingAfterHero() {
    var pending = pendingAfterHero.slice();
    pendingAfterHero = [];
    pending.forEach(function (wrap) {
      g.LY_activateProgressiveWrap(wrap);
    });
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
    if (picture.dataset.lyStem) return picture.dataset.lyStem;
    var source = pickSource(picture);
    var url = source ? firstUrlFromSrcset(
      source.getAttribute('srcset')
      || source.getAttribute('data-ly-srcset')
      || source.getAttribute('data-ly-orig-srcset')
      || ''
    ) : '';
    if (!url) {
      var img = picture.querySelector('img');
      url = (img && (img.getAttribute('data-ly-defer-src') || img.getAttribute('data-ly-src') || img.getAttribute('src'))) || '';
      url = url.replace(/\.jpe?g$/i, '.webp');
    }
    return stemFromTierUrl(url);
  }

  function stashPictureSources(picture) {
    picture.querySelectorAll('source').forEach(function (s) {
      var ss = s.getAttribute('srcset') || s.getAttribute('data-ly-srcset');
      if (ss && !s.getAttribute('data-ly-orig-srcset')) {
        s.setAttribute('data-ly-orig-srcset', ss);
      }
      s.removeAttribute('srcset');
      s.removeAttribute('data-ly-srcset');
    });
    var img = picture.querySelector('img');
    if (img) {
      var is = img.getAttribute('srcset');
      if (is && !img.getAttribute('data-ly-orig-srcset')) {
        img.setAttribute('data-ly-orig-srcset', is);
      }
      img.removeAttribute('srcset');
    }
  }

  function suspendOffHeroPictures() {
    g.document.querySelectorAll('picture').forEach(function (picture) {
      if (isHeroPicture(picture) || picture.dataset.lySuspended) return;
      var stem = pictureStem(picture);
      if (stem) picture.dataset.lyStem = stem;
      picture.dataset.lySuspended = '1';
      stashPictureSources(picture);
      var img = picture.querySelector('img');
      if (img) {
        var src = img.getAttribute('src') || img.getAttribute('data-ly-src');
        if (src) {
          img.setAttribute('data-ly-defer-src', src);
          img.removeAttribute('src');
          img.removeAttribute('data-ly-src');
        }
        img.setAttribute('loading', 'lazy');
        img.setAttribute('decoding', 'async');
      }
    });
  }

  function markPreviewReady(wrap) {
    if (wrap.classList.contains('ly-prog-preview-ready')) return;
    wrap.classList.add('ly-prog-preview-ready');
  }

  function ensurePreview(wrap) {
    if (wrap.classList.contains('ly-prog-skip-preview')) return;
    var preview = wrap.querySelector('.ly-prog-preview');
    if (!preview || preview.getAttribute('src')) return;
    var url = wrap.dataset.lyPreviewUrl;
    if (!url) return;
    preview.addEventListener('load', function () { markPreviewReady(wrap); }, { once: true });
    preview.addEventListener('error', function () { markPreviewReady(wrap); }, { once: true });
    preview.src = url;
    if (preview.complete && preview.naturalWidth) markPreviewReady(wrap);
  }

  function whenPreviewReady(wrap, fn) {
    if (wrap.classList.contains('ly-prog-skip-preview') || wrap.classList.contains('ly-prog-preview-ready')) {
      fn();
      return;
    }
    var preview = wrap.querySelector('.ly-prog-preview');
    if (!preview) {
      fn();
      return;
    }
    preview.addEventListener('load', fn, { once: true });
    preview.addEventListener('error', fn, { once: true });
    if (preview.complete && preview.naturalWidth) fn();
  }

  function wrapPicture(picture, kind) {
    if (!picture || picture.closest('.ly-prog-wrap')) return null;
    var stem = pictureStem(picture);
    if (!stem) return null;

    var previewUrl = g.LY_previewUrlFromStem(stem);
    var sharpUrl = g.LY_sharpUrlFromStem(stem, kind);
    var skipPreview = sharpIsCached(sharpUrl);
    stashPictureSources(picture);

    var wrap = g.document.createElement('div');
    wrap.className = 'ly-prog-wrap' + (kind === 'hero' ? ' ly-prog-wrap--hero' : '');
    wrap.dataset.lySharpUrl = sharpUrl;
    wrap.dataset.lyPreviewUrl = previewUrl;
    wrap.dataset.lyProgKind = kind || 'content';
    if (skipPreview) wrap.classList.add('ly-prog-skip-preview');

    var parent = picture.parentNode;
    parent.insertBefore(wrap, picture);

    var preview = g.document.createElement('img');
    preview.className = 'ly-prog-preview';
    preview.alt = '';
    preview.setAttribute('aria-hidden', 'true');
    preview.decoding = 'async';
    wrap.appendChild(preview);
    wrap.appendChild(picture);

    var img = picture.querySelector('img');
    if (img) {
      img.classList.add('ly-prog-sharp');
      if (img.getAttribute('src')) img.removeAttribute('src');
    }

    return wrap;
  }

  function onWrapSharpReady(wrap) {
    var card = wrap.closest('.destination-card, .gallery-item');
    if (card) card.classList.remove('card-loading');
    var url = wrap.dataset.lySharpUrl;
    if (url && g.LY_preloadedUrls) g.LY_preloadedUrls[url] = 1;
  }

  function finishQueueSlot(wrap) {
    if (wrap._lyQueueDone) {
      var done = wrap._lyQueueDone;
      wrap._lyQueueDone = null;
      done();
    }
  }

  function commitSharpReveal(wrap, img) {
    wrap.classList.remove('ly-prog-sharp-loading');
    wrap.classList.add('ly-prog-sharp-ready');
    if (!wrap.classList.contains('ly-prog-skip-preview')) markPreviewReady(wrap);
    void img.offsetWidth;
    g.requestAnimationFrame(function () {
      wrap.classList.add('ly-prog-sharp-visible');
      onWrapSharpReady(wrap);
      if (isHeroWrap(wrap)) scheduleHeroGate(wrap);
      finishQueueSlot(wrap);
    });
  }

  function beginSharpLoad(wrap) {
    if (!wrap || wrap.classList.contains('ly-prog-sharp-ready')) return;
    if (wrap.classList.contains('ly-prog-sharp-loading')) return;
    if (!gateOpen() && !isHeroWrap(wrap)) {
      if (pendingAfterHero.indexOf(wrap) < 0) pendingAfterHero.push(wrap);
      finishQueueSlot(wrap);
      return;
    }

    var url = wrap.dataset.lySharpUrl;
    var img = wrap.querySelector('.ly-prog-sharp');
    if (!url || !img) {
      finishQueueSlot(wrap);
      return;
    }

    if (sharpIsCached(url)) wrap.classList.add('ly-prog-skip-preview');

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
      if (isHeroWrap(wrap)) scheduleHeroGate(wrap);
      finishQueueSlot(wrap);
    }, { once: true });
    img.src = url;
  }

  function revealSharp(wrap) {
    if (!wrap || wrap.classList.contains('ly-prog-sharp-ready')) {
      finishQueueSlot(wrap);
      return;
    }
    if (!gateOpen() && !isHeroWrap(wrap)) {
      if (pendingAfterHero.indexOf(wrap) < 0) pendingAfterHero.push(wrap);
      finishQueueSlot(wrap);
      return;
    }

    if (!wrap.classList.contains('ly-prog-skip-preview')) ensurePreview(wrap);

    if (!wrap.classList.contains('ly-prog-skip-preview')) {
      whenPreviewReady(wrap, function () { beginSharpLoad(wrap); });
      return;
    }

    beginSharpLoad(wrap);
  }

  g.LY_activateProgressiveWrap = function (wrap, opts) {
    opts = opts || {};
    if (!wrap) return;
    if (!gateOpen() && !isHeroWrap(wrap)) {
      if (pendingAfterHero.indexOf(wrap) < 0) pendingAfterHero.push(wrap);
      return;
    }
    if (isHeroWrap(wrap)) {
      if (wrap.dataset.lyActivated) return;
      wrap.dataset.lyActivated = '1';
      revealSharp(wrap);
      return;
    }
    if (wrap.classList.contains('ly-prog-sharp-ready')) return;
    enqueueContentWrap(wrap, !!opts.front);
  };

  g.LY_requestSharpUpgrade = function (el) {
    var wrap = el && el.closest ? el.closest('.ly-prog-wrap') : el;
    if (!wrap) return;
    g.LY_activateProgressiveWrap(wrap, { front: true });
  };

  g.LY_revealProgressiveForUrl = function (url) {
    if (!url) return;
    g.document.querySelectorAll('.ly-prog-wrap').forEach(function (wrap) {
      if (wrap.dataset.lySharpUrl !== url) return;
      if (wrap.classList.contains('ly-prog-sharp-ready')) return;
      if (!gateOpen() && !isHeroWrap(wrap)) return;
      wrap.classList.add('ly-prog-skip-preview');
      g.LY_activateProgressiveWrap(wrap, { front: true });
    });
  };

  g.LY_upgradeProgressiveForIntent = function (opts) {
    if (!gateOpen()) return;
    opts = opts || {};
    var urls = (opts.urgentUrls || []).filter(Boolean);
    var upgraded = {};
    g.document.querySelectorAll('.ly-prog-wrap').forEach(function (wrap) {
      var sharp = wrap.dataset.lySharpUrl;
      if (sharp && urls.indexOf(sharp) >= 0 && !upgraded[wrap]) {
        upgraded[wrap] = 1;
        g.LY_activateProgressiveWrap(wrap, { front: true });
      }
    });
    if (opts.context && g.LY_cardsForContext) {
      g.LY_cardsForContext(opts.context).forEach(function (card) {
        var wrap = card.querySelector('.ly-prog-wrap');
        if (wrap && !upgraded[wrap]) {
          upgraded[wrap] = 1;
          g.LY_activateProgressiveWrap(wrap, { front: true });
        }
      });
    }
  };

  function bindVisibleObserver(wraps) {
    if (!('IntersectionObserver' in g)) {
      wraps.forEach(function (wrap) { g.LY_activateProgressiveWrap(wrap); });
      return;
    }
    if (!visibleIo) {
      visibleIo = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.2) return;
          g.LY_activateProgressiveWrap(entry.target);
        });
      }, { rootMargin: '80px 0px', threshold: [0, 0.2, 0.45] });
    }
    wraps.forEach(function (wrap) {
      if (isHeroWrap(wrap)) {
        g.LY_activateProgressiveWrap(wrap);
        return;
      }
      visibleIo.observe(wrap);
    });
  }

  g.LY_initDeferredProgressiveImages = function () {
    if (g.LY_deferredProgressiveReady) return;
    g.LY_deferredProgressiveReady = true;
    var wraps = [];
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
    bindVisibleObserver(wraps);
  };

  g.LY_initProgressiveImages = function () {
    suspendOffHeroPictures();
    var hero = g.document.querySelector('#hero .hero-bg-wrap');
    var heroWrap = hero ? wrapPicture(hero, 'hero') : null;
    if (heroWrap) g.LY_activateProgressiveWrap(heroWrap);
  };

  function scheduleEarlySuspend() {
    if (g.LY_earlySuspendDone) return;
    g.LY_earlySuspendDone = true;
    suspendOffHeroPictures();
  }

  if (g.document.readyState === 'loading') {
    g.document.addEventListener('readystatechange', function onRs() {
      if (g.document.readyState !== 'interactive') return;
      g.document.removeEventListener('readystatechange', onRs);
      scheduleEarlySuspend();
    });
    g.document.addEventListener('DOMContentLoaded', g.LY_initProgressiveImages);
  } else {
    scheduleEarlySuspend();
    g.LY_initProgressiveImages();
  }
})(window);