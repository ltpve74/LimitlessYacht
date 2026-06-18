/**
 * Analytics environment — must load before any GA / Clarity / gtag snippets.
 * Sets LY_OWNER_MODE on preview hosts and optional owner override (?ly_owner=set).
 */
(function (global) {
  'use strict';

  var h = global.location.hostname;
  var parts = global.location.pathname.split('/').filter(Boolean);

  global.LY_BASE = (h.endsWith('.github.io') && parts[0]) ? '/' + parts[0] : '';

  global.LY_IS_PREVIEW =
    h.endsWith('.github.io') ||
    h === 'localhost' ||
    h === '127.0.0.1' ||
    (h.endsWith('.netlify.app') && h.indexOf('limitlessyachtcharter') === -1);

  try {
    var p = new URLSearchParams(global.location.search);
    if (p.get('ly_owner') === 'set') {
      global.localStorage.setItem('ly_owner', '1');
      global.history.replaceState(null, '', global.location.pathname + (global.location.hash || ''));
    } else if (p.get('ly_owner') === 'unset') {
      global.localStorage.removeItem('ly_owner');
      global.history.replaceState(null, '', global.location.pathname + (global.location.hash || ''));
    }
  } catch (e) {}

  var ownerStored = false;
  try {
    ownerStored = global.localStorage.getItem('ly_owner') === '1';
  } catch (e) {}

  if (ownerStored || global.LY_IS_PREVIEW) {
    global.LY_OWNER_MODE = true;
    if (global.LY_IS_PREVIEW && !ownerStored) {
      console.log(
        '%c[Limitless] Preview host — GA · Clarity · behavior analytics suppressed',
        'color:#c9a84c;font-weight:bold'
      );
    } else if (ownerStored) {
      console.log(
        '%c[Limitless] Owner mode — GA · Clarity suppressed',
        'color:#c9a84c;font-weight:bold'
      );
    }
  }

  try {
    if (new URLSearchParams(global.location.search).get('ly_test_consent') === '1') {
      global.LY_OWNER_MODE = false;
      global.LY_IS_PREVIEW = false;
    }
  } catch (e) {}
})(window);