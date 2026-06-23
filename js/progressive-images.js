/* Progressive preview → sharp fade (all connections). */
(function (g) {
  'use strict';

  if (!g.LY_PROGRESSIVE_IMAGES) return;

  var visibleIo = null;
  var pendingAfterHero = [];
  var contentQueue = [];
  var contentBusy = 0;
  var contentMax = 2;
  var previewQueue = [];
  var previewBusy = 0;
  var previewMax = 2;

  g.LY_heroGateOpen = false;
  g.LY_heroSharpReady = false;
  g.LY_onHeroSharpReady = g.LY_onHeroSharpReady || [];

  /* Next animation frame, with a setTimeout fallback so the step still runs
     when rAF is paused (hidden/backgrounded tab). Mirrors net-tier.js. */
  function softFrame(fn) {
    var ran = false;
    function go() { if (ran) return; ran = true; fn(); }
    if (g.requestAnimationFrame) g.requestAnimationFrame(go);
    g.setTimeout(go, 50);
  }

  g.LY_sharpTierSuffix = function (kind) {
    var mob = g.innerWidth <= 640;
    if (mob) return '-960';
    if (kind === 'hero' || kind === 'gallery') return '-1280';
    return '-960';
  };

  g.LY_previewUrlFromStem = function (stem) {
    return stem + '-prev.jpg';
  };

  g.LY_sharpUrlFromStem = function (stem, kind) {
    return stem + g.LY_sharpTierSuffix(kind) + '.webp';
  };

  function gateOpen() {
    return g.LY_heroGateOpen;
  }

  function isHeroWrap(wrap) {
    return wrap && wrap.dataset.lyProgKind === 'hero';
  }

  function isLbWrap(wrap) {
    return !!(wrap && (wrap.dataset.lyProgKind === 'lb' || wrap.classList.contains('ly-prog-wrap--lb')));
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

  function startLayoutCssEarly() {
    if (g.LY_loadLayoutCss && !g.LY_layoutCssLoaded && !g.LY_layoutCssLoading) {
      g.LY_loadLayoutCss();
    }
  }

  function afterHeroGateOpen() {
    g.LY_initDeferredProgressiveImages();
    if (g.LY_loadFont) g.LY_loadFont();
    if (g.LY_scheduleMainCss) g.LY_scheduleMainCss();
    runHeroGateCallbacks();
    flushPendingAfterHero();
  }

  function openHeroGate(wrap) {
    if (g.LY_heroGateOpen) return;
    g.LY_heroGateOpen = true;
    g.LY_heroSharpReady = true;
    if (wrap) wrap.classList.add('ly-prog-hero-done');
    softFrame(afterHeroGateOpen);
  }

  function scheduleHeroGate(wrap) {
    softFrame(function () {
      openHeroGate(wrap);
    });
  }

  function releaseContentSlot(wrap) {
    var i = contentQueue.indexOf(wrap);
    if (i >= 0) contentQueue.splice(i, 1);
    contentBusy = Math.max(0, contentBusy - 1);
    pumpContentQueue();
  }

  function pumpContentQueue() {
    while (contentBusy < contentMax && contentQueue.length) {
      var wrap = contentQueue[0];
      if (wrap.classList.contains('ly-prog-sharp-ready')) {
        contentQueue.shift();
        continue;
      }
      contentBusy++;
      if (!wrap.dataset.lyActivated) wrap.dataset.lyActivated = '1';
      wrap._lyQueueDone = function () { releaseContentSlot(wrap); };
      revealSharp(wrap);
      break;
    }
  }

  function wrapKindRank(wrap) {
    var kind = wrap.dataset.lyProgKind || '';
    if (kind === 'about') return 0;
    if (kind === 'gallery') return 2;
    if (kind === 'dest') return 3;
    return 1;
  }

  function enqueueContentWrap(wrap, front) {
    if (!wrap || isHeroWrap(wrap) || isLbWrap(wrap)) return;
    var i = contentQueue.indexOf(wrap);
    if (i >= 0) contentQueue.splice(i, 1);
    if (front) {
      contentQueue.unshift(wrap);
    } else {
      var rank = wrapKindRank(wrap);
      var at = contentQueue.length;
      for (var q = 0; q < contentQueue.length; q++) {
        if (wrapKindRank(contentQueue[q]) > rank) {
          at = q;
          break;
        }
      }
      contentQueue.splice(at, 0, wrap);
    }
    pumpContentQueue();
  }

  function resumeSharpForWrap(wrap, front) {
    if (!wrap || wrap.classList.contains('ly-prog-sharp-ready')) return;
    if (!wrap.classList.contains('ly-prog-skip-preview')) {
      whenPreviewReady(wrap, function () {
        enqueueContentWrap(wrap, !!front);
      });
      return;
    }
    enqueueContentWrap(wrap, !!front);
  }

  function flushPendingAfterHero() {
    var pending = pendingAfterHero.slice();
    pendingAfterHero = [];
    pending.forEach(function (wrap) {
      if (!wrapVisibleEnough(wrap)) return;
      resumeSharpForWrap(wrap, false);
    });
    activateVisibleProgressiveWraps(pending);
  }

  g.LY_kickProgressiveAfterReveal = function () {
    /* Safety net: don't let content images wait forever on the hero gate.
       If the hero sharp is slow (3G) or its reveal stalls, open the gate on
       a timer so previews/sharps still load instead of staying blank. */
    if (!g.LY_heroGateGuard) {
      g.LY_heroGateGuard = true;
      g.setTimeout(function () { if (!g.LY_heroGateOpen) openHeroGate(null); }, 2000);
    }
    var wraps = [];
    g.document.querySelectorAll('.ly-prog-wrap').forEach(function (wrap) {
      if (isHeroWrap(wrap)) return;
      wraps.push(wrap);
      if (!gateOpen()) {
        if (pendingAfterHero.indexOf(wrap) < 0) pendingAfterHero.push(wrap);
        return;
      }
      if (wrapVisibleEnough(wrap)) g.LY_activateProgressiveWrap(wrap);
    });
    activateVisibleProgressiveWraps(wraps);
  };

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
    return url.replace(/-(?:480|640|720|960|1280|1440|prev)\.(?:webp|jpg)$/i, '');
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
      if (picture.closest('#dest-lightbox')) return;
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
    if (isHeroWrap(wrap)) startLayoutCssEarly();
  }

  function releasePreviewSlot() {
    previewBusy = Math.max(0, previewBusy - 1);
    pumpPreviewQueue();
  }

  function pumpPreviewQueue() {
    while (previewBusy < previewMax && previewQueue.length) {
      var wrap = previewQueue.shift();
      if (wrap.classList.contains('ly-prog-skip-preview')) continue;
      var preview = wrap.querySelector('.ly-prog-preview');
      if (!preview || preview.getAttribute('src')) continue;
      var url = wrap.dataset.lyPreviewUrl;
      if (!url) continue;
      previewBusy++;
      function done() {
        markPreviewReady(wrap);
        releasePreviewSlot();
      }
      preview.addEventListener('load', done, { once: true });
      preview.addEventListener('error', done, { once: true });
      preview.src = url;
      if (preview.complete && preview.naturalWidth) done();
      break;
    }
  }

  function ensurePreview(wrap) {
    if (wrap.classList.contains('ly-prog-skip-preview')) return;
    var preview = wrap.querySelector('.ly-prog-preview');
    if (!preview || preview.getAttribute('src')) return;
    if (!wrap.dataset.lyPreviewUrl) return;
    if (previewQueue.indexOf(wrap) >= 0) return;
    previewQueue.push(wrap);
    pumpPreviewQueue();
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

  function wireHeroPreview(wrap, preview, previewUrl, skipPreview) {
    if (!preview) return;
    if (skipPreview) {
      startLayoutCssEarly();
      return;
    }
    preview.addEventListener('load', function () { markPreviewReady(wrap); }, { once: true });
    preview.addEventListener('error', function () { markPreviewReady(wrap); }, { once: true });
    if (!preview.getAttribute('src')) preview.src = previewUrl;
    if (preview.complete && preview.naturalWidth) markPreviewReady(wrap);
  }

  function finalizeHeroWrap(wrap, picture) {
    if (!wrap || !picture) return null;
    var stem = pictureStem(picture);
    if (!stem) return null;

    var previewUrl = g.LY_previewUrlFromStem(stem);
    var sharpUrl = g.LY_sharpUrlFromStem(stem, 'hero');
    var skipPreview = sharpIsCached(sharpUrl);
    stashPictureSources(picture);

    wrap.dataset.lySharpUrl = sharpUrl;
    wrap.dataset.lyPreviewUrl = previewUrl;
    wrap.dataset.lyProgKind = 'hero';
    wrap.classList.toggle('ly-prog-skip-preview', skipPreview);

    var preview = wrap.querySelector('.ly-prog-preview');
    if (preview) {
      preview.setAttribute('aria-hidden', 'true');
      if (!preview.getAttribute('alt')) preview.alt = '';
      preview.decoding = 'async';
      preview.loading = 'eager';
      preview.fetchPriority = 'high';
    }
    wireHeroPreview(wrap, preview, previewUrl, skipPreview);

    var img = picture.querySelector('img');
    if (img) {
      img.classList.add('ly-prog-sharp');
      if (img.getAttribute('src')) img.removeAttribute('src');
    }

    return wrap;
  }

  function wrapPicture(picture, kind) {
    if (!picture) return null;
    var existingWrap = picture.closest('.ly-prog-wrap');
    if (existingWrap) {
      return kind === 'hero' && existingWrap.classList.contains('ly-prog-wrap--hero')
        ? finalizeHeroWrap(existingWrap, picture)
        : null;
    }
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
    if (kind === 'hero') {
      preview.decoding = 'async';
      preview.loading = 'eager';
      preview.fetchPriority = 'high';
    } else {
      preview.decoding = 'async';
    }
    wrap.appendChild(preview);
    wrap.appendChild(picture);

    if (kind === 'hero') wireHeroPreview(wrap, preview, previewUrl, skipPreview);

    var img = picture.querySelector('img');
    if (img) {
      img.classList.add('ly-prog-sharp');
      if (img.getAttribute('src')) img.removeAttribute('src');
    }

    return wrap;
  }

  function onWrapSharpReady(wrap) {
    var card = wrap.closest('.destination-card, .gallery-item');

    var url = wrap.dataset.lySharpUrl;
    if (url && g.LY_preloadedUrls) g.LY_preloadedUrls[url] = 1;
    if (wrap._lyOnSharpReady) {
      var cb = wrap._lyOnSharpReady;
      wrap._lyOnSharpReady = null;
      try { cb(); } catch (e) { /* ignore */ }
    }
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
    softFrame(function () {
      wrap.classList.add('ly-prog-sharp-visible');
      onWrapSharpReady(wrap);
      if (isHeroWrap(wrap)) scheduleHeroGate(wrap);
      finishQueueSlot(wrap);
    });
  }

  function beginSharpLoad(wrap) {
    if (!wrap || wrap.classList.contains('ly-prog-sharp-ready')) return;
    if (wrap.classList.contains('ly-prog-sharp-loading')) return;
    if (!gateOpen() && !isHeroWrap(wrap) && !isLbWrap(wrap)) {
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
      if (wrap._lyOnSharpReady) {
        var cb = wrap._lyOnSharpReady;
        wrap._lyOnSharpReady = null;
        try { cb(); } catch (e) { /* ignore */ }
      }
      finishQueueSlot(wrap);
    }, { once: true });
    img.src = url;
  }

  function revealSharp(wrap) {
    if (!wrap || wrap.classList.contains('ly-prog-sharp-ready')) {
      finishQueueSlot(wrap);
      return;
    }

    if (!wrap.classList.contains('ly-prog-skip-preview')) ensurePreview(wrap);

    if (!gateOpen() && !isHeroWrap(wrap) && !isLbWrap(wrap)) {
      if (pendingAfterHero.indexOf(wrap) < 0) pendingAfterHero.push(wrap);
      finishQueueSlot(wrap);
      return;
    }

    if (!wrap.classList.contains('ly-prog-skip-preview')) {
      whenPreviewReady(wrap, function () { beginSharpLoad(wrap); });
      return;
    }

    beginSharpLoad(wrap);
  }

  function resetWrapForLoad(wrap) {
    wrap.classList.remove(
      'ly-prog-sharp-ready',
      'ly-prog-sharp-visible',
      'ly-prog-sharp-loading',
      'ly-prog-preview-ready',
      'ly-prog-skip-preview'
    );
    wrap._lySharpGen = (wrap._lySharpGen || 0) + 1;
    var preview = wrap.querySelector('.ly-prog-preview');
    var img = wrap.querySelector('.ly-prog-sharp');
    if (preview) preview.removeAttribute('src');
    if (img) img.removeAttribute('src');
  }

  g.LY_ensureLbWrap = function (host, el, kind) {
    if (!host || !el) return null;
    var block = el.closest && el.closest('picture') ? el.closest('picture') : el;
    var wrap = block.closest('.ly-prog-wrap');
    if (wrap) return wrap;
    var sharpEl = block.querySelector ? (block.querySelector('img') || block) : block;
    wrap = g.document.createElement('div');
    wrap.className = 'ly-prog-wrap ly-prog-wrap--lb';
    wrap.dataset.lyProgKind = 'lb';
    var preview = g.document.createElement('img');
    preview.className = 'ly-prog-preview';
    preview.alt = '';
    preview.setAttribute('aria-hidden', 'true');
    preview.decoding = 'async';
    host.insertBefore(wrap, block);
    wrap.appendChild(preview);
    if (block.parentNode !== wrap) wrap.appendChild(block);
    sharpEl.classList.add('ly-prog-sharp');
    if (kind) wrap.dataset.lyLbKind = kind;
    return wrap;
  };

  g.LY_loadLbProgressive = function (opts) {
    opts = opts || {};
    var wrap = opts.wrap;
    var stem = opts.stem;
    var sharpUrl = opts.sharpUrl;
    var onReady = opts.onReady;
    if (!wrap || !stem || !sharpUrl) {
      if (onReady) onReady();
      return;
    }
    resetWrapForLoad(wrap);
    wrap.dataset.lyPreviewUrl = g.LY_previewUrlFromStem(stem);
    wrap.dataset.lySharpUrl = sharpUrl;
    if (onReady) wrap._lyOnSharpReady = onReady;
    if (sharpIsCached(sharpUrl)) wrap.classList.add('ly-prog-skip-preview');
    revealSharp(wrap);
  };

  g.LY_activateProgressiveWrap = function (wrap, opts) {
    opts = opts || {};
    if (!wrap) return;
    if (isLbWrap(wrap)) {
      revealSharp(wrap);
      return;
    }
    if (!gateOpen() && !isHeroWrap(wrap)) {
      if (pendingAfterHero.indexOf(wrap) < 0) pendingAfterHero.push(wrap);
      if (!isLbWrap(wrap)) ensurePreview(wrap);
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
      if (!gateOpen() && !isHeroWrap(wrap) && !isLbWrap(wrap)) {
        ensurePreview(wrap);
        if (pendingAfterHero.indexOf(wrap) < 0) pendingAfterHero.push(wrap);
        return;
      }
      wrap.classList.add('ly-prog-skip-preview');
      g.LY_activateProgressiveWrap(wrap, { front: true });
    });
  };

  g.LY_upgradeProgressiveForIntent = function (opts) {
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

  function wrapInActiveTab(wrap) {
    var dg = wrap.closest('.dest-group');
    if (dg) return dg.classList.contains('tab-active');
    var gg = wrap.closest('.gallery-group');
    if (gg) return gg.classList.contains('tab-active');
    return true;
  }

  function wrapVisibilityScore(wrap) {
    var r = wrap.getBoundingClientRect();
    var vh = g.innerHeight || 0;
    var vw = g.innerWidth || 0;
    var visW = Math.min(r.right, vw) - Math.max(r.left, 0);
    var visH = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    if (visW <= 0 || visH <= 0) return 0;
    var area = Math.max(1, r.width * r.height);
    return (visW * visH) / area;
  }

  function wrapVisibleEnough(wrap) {
    if (!wrapInActiveTab(wrap)) return false;
    var r = wrap.getBoundingClientRect();
    var vh = g.innerHeight || 0;
    var vw = g.innerWidth || 0;
    if (r.bottom < -48 || r.top > vh + 48 || r.right < 0 || r.left > vw) return false;
    var score = wrapVisibilityScore(wrap);
    if (wrap.dataset.lyProgKind === 'dest') {
      var itin = g.document.getElementById('itinerary');
      if (itin && itin.getBoundingClientRect().top > vh * 0.82) return false;
      return score >= 0.3;
    }
    if (wrap.dataset.lyProgKind === 'gallery') {
      var gal = g.document.getElementById('gallery');
      if (gal && gal.getBoundingClientRect().top > vh * 0.82) return false;
      return score >= 0.3;
    }
    return score >= 0.2;
  }

  function activateVisibleProgressiveWraps(wraps) {
    wraps.forEach(function (wrap) {
      if (isHeroWrap(wrap) || wrap.classList.contains('ly-prog-sharp-ready')) return;
      if (wrapVisibleEnough(wrap)) g.LY_activateProgressiveWrap(wrap);
    });
  }

  function bindVisibleObserver(wraps) {
    if (!('IntersectionObserver' in g)) {
      wraps.forEach(function (wrap) { g.LY_activateProgressiveWrap(wrap); });
      activateVisibleProgressiveWraps(wraps);
      return;
    }
    if (!visibleIo) {
      visibleIo = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.2) return;
          g.LY_activateProgressiveWrap(entry.target);
        });
      }, { rootMargin: '48px 0px', threshold: [0, 0.2, 0.35, 0.5] });
    }
    wraps.forEach(function (wrap) {
      if (isHeroWrap(wrap)) {
        g.LY_activateProgressiveWrap(wrap);
        return;
      }
      visibleIo.observe(wrap);
    });
    g.requestAnimationFrame(function () {
      activateVisibleProgressiveWraps(wraps);
    });
  }

  function collectContentWraps() {
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
    return wraps;
  }

  g.LY_initDeferredProgressiveImages = function () {
    if (g.LY_deferredProgressiveReady) return;
    g.LY_initProgressiveImages();
  };

  g.LY_initProgressiveImages = function () {
    if (g.LY_deferredProgressiveReady) return;
    g.LY_deferredProgressiveReady = true;
    suspendOffHeroPictures();
    var wraps = collectContentWraps();
    var heroWrap = g.LY_heroWrapEarly || null;
    if (!heroWrap) {
      var hero = g.document.querySelector('#hero .hero-bg-wrap');
      heroWrap = hero ? wrapPicture(hero, 'hero') : null;
    }
    if (heroWrap) wraps.unshift(heroWrap);
    bindVisibleObserver(wraps);
  };

  function scheduleEarlySuspend() {
    if (g.LY_earlySuspendDone) return;
    g.LY_earlySuspendDone = true;
    suspendOffHeroPictures();
  }

  var heroWrapEarly = null;

  g.LY_bootHeroEarly = function () {
    if (!g.LY_PROGRESSIVE_IMAGES || heroWrapEarly) return heroWrapEarly;
    var hero = g.document.querySelector('#hero .hero-bg-wrap');
    if (!hero) return null;
    scheduleEarlySuspend();
    heroWrapEarly = wrapPicture(hero, 'hero');
    if (heroWrapEarly) {
      g.LY_heroWrapEarly = heroWrapEarly;
      g.LY_activateProgressiveWrap(heroWrapEarly);
    }
    return heroWrapEarly;
  };

  function bootProgressive() {
    scheduleEarlySuspend();
    g.LY_initProgressiveImages();
  }

  if (g.document.readyState === 'loading') {
    g.document.addEventListener('readystatechange', function onRs() {
      if (g.document.readyState !== 'interactive') return;
      g.document.removeEventListener('readystatechange', onRs);
      bootProgressive();
    });
  } else {
    bootProgressive();
  }
})(window);