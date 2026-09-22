/* Availability calendar + sticky WhatsApp enquiry bar.
   Source of truth for calendar behaviour. Loaded deferred from index.html
   (and locale homepages) AFTER #availCal and #calStickyCta exist.
   Month/dow labels come from data-i18n-* on #availCal so locales can patch
   markup without rewriting this file. */
(function () { var calRoot = document.getElementById('availCal'); var monthsEl = document.getElementById('calMonths'); var prevBtn = document.getElementById('calPrev'); var nextBtn = document.getElementById('calNext'); var selectionEl = document.getElementById('calSelection'); var selectionText = document.getElementById('calSelectionText'); var emailLink = document.getElementById('calMailtoLink'); var waBtn = document.getElementById('calWaBtn'); var clearBtn = document.getElementById('calClear'); var hintEl = document.getElementById('calHint'); var holdNoteEl = document.getElementById('calHoldNote'); if (!calRoot || !monthsEl || !prevBtn || !nextBtn) return; function lyCsvAttr(el, name, fallback) {
    var raw = el.getAttribute(name);
    if (!raw) return fallback.slice();
    var parts = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return parts.length === fallback.length ? parts : fallback.slice();
  }
  var MONTHS = lyCsvAttr(calRoot, 'data-i18n-months', ['January','February','March','April','May','June','July','August','September','October','November','December']);
  var DOW = lyCsvAttr(calRoot, 'data-i18n-dow', ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']); var dayWord = calRoot.getAttribute('data-i18n-day') || 'day'; var daysWord = calRoot.getAttribute('data-i18n-days') || 'days'; var onHoldLabel = calRoot.getAttribute('data-i18n-onhold') || 'On hold'; var booked = new Set(); var tentative = new Set(); var selected = []; var selectedLookup = {}; var now = new Date(); var curMonthIndex = now.getFullYear() * 12 + now.getMonth(); var seasonStartIndex = now.getFullYear() * 12 + 4; var minIndex = curMonthIndex >= seasonStartIndex ? seasonStartIndex : curMonthIndex; var maxIndex = curMonthIndex + 17; var viewIndex = curMonthIndex;
  var userPagedCal = false;
  var stickyCta = document.getElementById('calStickyCta');
  var stickyWaBtn = document.getElementById('calStickyWaBtn');
  var stickyLabelEl = document.getElementById('calStickyLabel');
  var stickySummary = document.getElementById('calStickySummary');
  var stickyAlts = document.getElementById('calStickyAlts');
  var stickyClear = document.getElementById('calStickyClear');
  var stickyMailto = document.getElementById('calStickyMailto');
  var recoveryIso = '';
  var calInView = true;
  var barShownOnce = false; function monthsToShow(){ var count; if (window.matchMedia('(min-width: 1100px)').matches) count = 3; else if (window.matchMedia('(min-width: 820px)').matches) count = 2; else count = 1; if (count > 2 && calRoot.closest('.contact-cal-pair') && window.matchMedia('(min-width: 769px)').matches) { count = 2; } return count; } function pad(n){ return (n < 10 ? '0' : '') + n; } function todayStr(){ var t = new Date(); return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); } function parseDate(k){ return new Date(k + 'T12:00:00'); } function dateKey(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); } function addDays(k, n){ var d = parseDate(k); d.setDate(d.getDate() + n); return dateKey(d); } function isSelectable(k){ if (k < todayStr()) return false; if (booked.has(k)) return false; return true; }
  function firstOpenMonthIndex() {
    var start = Math.max(curMonthIndex, minIndex);
    for (var idx = start; idx <= maxIndex; idx++) {
      var y = Math.floor(idx / 12), m = idx % 12;
      var daysInMonth = new Date(y, m + 1, 0).getDate();
      var day0 = (idx === curMonthIndex) ? now.getDate() : 1;
      for (var d = day0; d <= daysInMonth; d++) {
        var k = y + '-' + pad(m + 1) + '-' + pad(d);
        if (isSelectable(k)) return idx;
      }
    }
    return curMonthIndex;
  }
  function jumpViewToOpenMonth() {
    if (userPagedCal || selected.length) return;
    var openIdx = firstOpenMonthIndex();
    var count = monthsToShow();
    var maxFirst = maxIndex - (count - 1);
    viewIndex = Math.min(Math.max(openIdx, minIndex), maxFirst);
  }
  function i18nAttr(name, fallback) {
    return (calRoot.getAttribute(name) || fallback || '');
  }
  function countPhrase(n) {
    var tpl = n === 1 ? i18nAttr('data-i18n-count-one', '{n} day selected') : i18nAttr('data-i18n-count-many', '{n} days selected');
    return tpl.replace('{n}', String(n));
  }
  function formatDateShort(k) {
    var d = parseDate(k);
    try {
      return new Intl.DateTimeFormat((document.documentElement.lang || 'en').split('-')[0] === 'de' ? 'de-DE' : (document.documentElement.lang || 'en').split('-')[0] === 'es' ? 'es-ES' : (document.documentElement.lang || 'en').split('-')[0] === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short' }).format(d);
    } catch (err) {
      return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
    }
  }
  function isContiguousList(list) {
    if (!list || list.length <= 1) return true;
    for (var i = 1; i < list.length; i++) {
      if (addDays(list[i - 1], 1) !== list[i]) return false;
    }
    return true;
  }
  function stickyWaLabel() {
    return i18nAttr('data-i18n-enquire', 'Enquire about these dates');
  }
  function fireBarShown() {
    if (barShownOnce || window.LY_OWNER_MODE) return;
    barShownOnce = true;
    try { sessionStorage.setItem('ly_cal_bar_shown', '1'); } catch (e) {}
    if (window.LY_clarityEvent) window.LY_clarityEvent('ly_cal_bar_shown');
  }
  function setDatesCountTag(n) {
    if (window.LY_OWNER_MODE) return;
    var bucket = n <= 1 ? '1' : n <= 3 ? '2-3' : n <= 7 ? '4-7' : '8+';
    var tag = window.clarity;
    if (typeof tag === 'function') {
      try { tag('set', 'ly_cal_dates_count', bucket); } catch (e) {}
    }
  }
  function nearestOpenDates(fromIso, want) {
    var out = [];
    var seen = {};
    var i;
    for (i = 1; i <= 60 && out.length < want; i++) {
      var fwd = addDays(fromIso, i);
      var back = addDays(fromIso, -i);
      if (isSelectable(fwd) && !selectedLookup[fwd] && !seen[fwd]) { out.push(fwd); seen[fwd] = 1; }
      if (out.length >= want) break;
      if (isSelectable(back) && !selectedLookup[back] && !seen[back] && back >= todayStr()) { out.push(back); seen[back] = 1; }
    }
    out.sort();
    return out.slice(0, want);
  }
  function joinAlts(alts, bookedIso) {
    var bookedMonth = bookedIso.slice(0, 7);
    var labels = alts.map(function(k) {
      return k.slice(0, 7) === bookedMonth ? String(parseDate(k).getDate()) : formatDateShort(k);
    });
    var orWord = i18nAttr('data-i18n-or', 'or');
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return labels[0] + ' ' + orWord + ' ' + labels[1];
    return labels.slice(0, -1).join(', ') + ' ' + orWord + ' ' + labels[labels.length - 1];
  }
  function renderRecovery() {
    if (!stickyAlts) return;
    if (!recoveryIso) {
      stickyAlts.hidden = true;
      stickyAlts.innerHTML = '';
      return;
    }
    var alts = nearestOpenDates(recoveryIso, 3);
    var tpl = i18nAttr('data-i18n-booked', '{date} is booked — try {alts}');
    var msg = tpl.replace('{date}', formatDateShort(recoveryIso)).replace('{alts}', joinAlts(alts, recoveryIso));
    var chips = alts.map(function(k) {
      return '<button type="button" class="cal-alt-chip" data-date="' + k + '">' + (k.slice(0, 7) === recoveryIso.slice(0, 7) ? parseDate(k).getDate() : formatDateShort(k)) + '</button>';
    }).join('');
    stickyAlts.innerHTML = '<p class="cal-sticky-recovery">' + msg + '</p><div class="cal-sticky-chips">' + chips + '</div>';
    stickyAlts.hidden = false;
    if (window.LY_clarityEvent) {
      window.LY_clarityEvent('ly_cal_booked_alt_shown');
      window.LY_clarityEvent('ly_cal_booked_softprompt');
    }
  }
  function showBookedRecovery(iso) {
    if (!iso) return;
    recoveryIso = iso;
    renderRecovery();
    syncStickyCta();
  }
  window.LY_showBookedRecovery = showBookedRecovery;
  function lyBindStickyUi() {
    if (!stickyCta) stickyCta = document.getElementById('calStickyCta');
    if (!stickyWaBtn) stickyWaBtn = document.getElementById('calStickyWaBtn');
    if (!stickyLabelEl) stickyLabelEl = document.getElementById('calStickyLabel');
    if (!stickySummary) stickySummary = document.getElementById('calStickySummary');
    if (!stickyAlts) stickyAlts = document.getElementById('calStickyAlts');
    if (!stickyClear) stickyClear = document.getElementById('calStickyClear');
    if (!stickyMailto) stickyMailto = document.getElementById('calStickyMailto');
  }
  function syncStickyCta() {
    lyBindStickyUi();
    if (!stickyCta) return;
    /* Dates selected: keep an enquiry control on screen. Full frosted bar while the
       calendar is in view; shrink to a corner chip when the user scrolls away
       (gallery, etc.) on any viewport. Booked-date recovery stays calendar-gated. */
    var on = (selected.length > 0) || (!!recoveryIso && calInView);
    var compact = !!(selected.length && !calInView && !recoveryIso);
    stickyCta.hidden = !on;
    stickyCta.setAttribute('aria-hidden', on ? 'false' : 'true');
    stickyCta.classList.toggle('is-recovery', !!recoveryIso);
    stickyCta.classList.toggle('is-compact', compact);
    document.documentElement.classList.toggle('ly-cal-sticky-open', on);
    document.documentElement.classList.toggle('ly-cal-sticky-compact', compact);
    if (on) {
      fireBarShown();
      if (stickySummary) {
        if (recoveryIso && !selected.length) stickySummary.textContent = '';
        else if (selected.length) stickySummary.textContent = countPhrase(selected.length) + (formatSelection() ? ' · ' + formatSelection() : '');
        else stickySummary.textContent = '';
      }
      if (stickyLabelEl) stickyLabelEl.textContent = compact && waBtn ? (waBtn.getAttribute('data-wa-label-dates') || stickyWaLabel()) : stickyWaLabel();
      if (stickyClear) stickyClear.textContent = i18nAttr('data-i18n-clear', 'Clear');
      if (stickyWaBtn && waBtn) stickyWaBtn.href = waBtn.href;
      if (stickyWaBtn) stickyWaBtn.hidden = !selected.length;
      if (stickyMailto && emailLink) stickyMailto.href = emailLink.href;
      if (stickyMailto) stickyMailto.parentElement && (stickyMailto.parentElement.hidden = !selected.length);
      if (!recoveryIso && stickyAlts) { stickyAlts.hidden = true; stickyAlts.innerHTML = ''; }
    }
    if (window.LY_syncBottomChrome) window.LY_syncBottomChrome();
  }
 function isAdjacent(a, b){ return addDays(a, 1) === b || addDays(b, 1) === a; } function buildContiguousRange(a, b){ var start = a < b ? a : b, end = a < b ? b : a; var out = [], d = parseDate(start), e = parseDate(end); while (d <= e) { var k = dateKey(d); if (!isSelectable(k)) return null; out.push(k); d.setDate(d.getDate() + 1); } return out; } function formatDateLabel(k){ var d = parseDate(k); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); } function formatSelection(){ if (!selected.length) return ''; var sorted = selected.slice().sort(); if (sorted.length === 1) return formatDateShort(sorted[0]); if (isContiguousList(sorted)) { var start = parseDate(sorted[0]), end = parseDate(sorted[sorted.length - 1]); if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) { return start.getDate() + '–' + end.getDate() + ' ' + MONTHS[start.getMonth()]; } return formatDateShort(sorted[0]) + ' – ' + formatDateShort(sorted[sorted.length - 1]); } return sorted.map(formatDateShort).join(', '); } function countLabel(){ if (selected.length <= 1) return '1 ' + dayWord; return selected.length + ' ' + daysWord; } function rebuildLookup(){ selectedLookup = {}; selected.forEach(function(k){ selectedLookup[k] = true; }); } function monthIndexForDate(k){ var d = parseDate(k); return d.getFullYear() * 12 + d.getMonth(); } function ensureSelectionVisible(){ if (!selected.length) return; var startIdx = monthIndexForDate(selected[0]); var endIdx = monthIndexForDate(selected[selected.length - 1]); var count = monthsToShow(); var maxFirst = maxIndex - (count - 1); if (viewIndex > startIdx || viewIndex + count - 1 < startIdx) { viewIndex = Math.min(Math.max(startIdx, minIndex), maxFirst); } if (endIdx > viewIndex + count - 1 && startIdx < viewIndex) { viewIndex = Math.min(Math.max(endIdx - count + 1, minIndex), maxFirst); } } function syncCalMailto(){ if (!emailLink) return; var base = 'mailto:info@limitlessyachtcharter.com'; if (!selected.length) { emailLink.href = base; return; } var label = formatSelection(); var lang = (document.documentElement.lang || 'en').split('-')[0]; var subj = lang === 'es' ? 'Consulta Limitless — ' : lang === 'de' ? 'Limitless-Anfrage — ' : lang === 'fr' ? 'Demande Limitless — ' : 'Limitless enquiry — '; emailLink.href = base + '?subject=' + encodeURIComponent(subj + label) + '&body=' + encodeURIComponent(buildWaMsg(selected)); } function getDefaultWaMsg(){var lang=(document.documentElement.lang||'en').split('-')[0];if(lang==='es')return "Hola, me gustaría reservar Limitless.\n\nPor favor confirmen disponibilidad y envíen un presupuesto.";if(lang==='de')return "Hallo, ich möchte die Limitless chartern.\n\nBitte Verfügbarkeit bestätigen und ein Angebot senden.";if(lang==='fr')return "Bonjour, je souhaite réserver Limitless.\n\nMerci de confirmer la disponibilité et d'envoyer un devis.";return "Hi, I'd like to charter Limitless.\n\nPlease send available dates and a quote.";}function waHrefForMsg(msg){return 'https://wa.me/34643678072?text='+encodeURIComponent(msg||getDefaultWaMsg());}function syncWaEnquiryLinks(msg){var href=waHrefForMsg(msg);if(waBtn)waBtn.href=href;var infoWa=document.querySelector('.contact-info .whatsapp-btn');if(infoWa)infoWa.href=href;document.querySelectorAll('.footer-links a[href*="wa.me"], .section-forward-cta a[href*="wa.me"]').forEach(function(a){a.href=href;});} function syncCalWaLabel(hasDates) { if (!waBtn) return; var labelEl = waBtn.querySelector('.cal-wa-label'); var text = hasDates ? (waBtn.getAttribute('data-wa-label-dates') || 'WhatsApp these dates') : (waBtn.getAttribute('data-wa-label-default') || 'Enquire on WhatsApp'); if (labelEl) labelEl.textContent = text; } function buildWaMsg(sel) {
    var lang = (document.documentElement.lang || 'en').split('-')[0];
    var sorted = sel.slice().sort();
    var n = sorted.length;
    var contiguous = n > 1 && isContiguousList(sorted);
    var dates = formatSelection();
    var daysBit = n === 1 ? '1 ' + dayWord : n + ' ' + daysWord;
    var typeEn = n === 1 ? 'day charter' : (contiguous ? 'multi-day' : 'several dates');
    var type = typeEn;
    if (lang === 'es') type = n === 1 ? 'día completo / medio día' : (contiguous ? 'varios días' : 'varias fechas');
    else if (lang === 'de') type = n === 1 ? 'Tagescharter' : (contiguous ? 'Mehrtagescharter' : 'mehrere Termine');
    else if (lang === 'fr') type = n === 1 ? 'journée / demi-journée' : (contiguous ? 'plusieurs jours' : 'plusieurs dates');
    var dateLine = dates + ' (' + daysBit + ')';
    if (lang === 'es') return 'Hola, me gustaría reservar Limitless.\n\nFechas: ' + dateLine + '\nTipo: ' + type + '\n\nPor favor confirmen estas fechas y envíen un presupuesto.';
    if (lang === 'de') return 'Hallo, ich möchte die Limitless chartern.\n\nTermine: ' + dateLine + '\nArt: ' + type + '\n\nBitte diese Termine bestätigen und ein Angebot senden.';
    if (lang === 'fr') return 'Bonjour, je souhaite réserver Limitless.\n\nDates : ' + dateLine + '\nFormule : ' + type + '\n\nMerci de confirmer ces dates et d\'envoyer un devis.';
    return "Hi, I'd like to charter Limitless.\n\nDates: " + dateLine + "\nType: " + type + "\n\nPlease confirm these dates and send a quote.";
  } function setCtaState(on){ if (waBtn) { waBtn.classList.toggle('is-disabled', !on); waBtn.setAttribute('aria-disabled', on ? 'false' : 'true'); waBtn.tabIndex = on ? 0 : -1; } if (hintEl) hintEl.hidden = !!on; if (selectionEl) selectionEl.hidden = !on; } function syncHoldNote(){ if (!holdNoteEl) return; var show = false; for (var hi = 0; hi < selected.length; hi++) { if (tentative.has(selected[hi])) { show = true; break; } } holdNoteEl.hidden = !show; } function updateSelectionUi(){ rebuildLookup(); if (!selected.length) { setCtaState(false); syncWaEnquiryLinks(null); syncCalWaLabel(false); if (selectionText) selectionText.textContent = ''; syncCalMailto(); render(); syncStickyCta(); syncHoldNote(); return; } var label = formatSelection(); var meta = countLabel(); if (selectionText) selectionText.textContent = label + ' · ' + meta; syncWaEnquiryLinks(buildWaMsg(selected)); setCtaState(true); syncCalWaLabel(true); syncCalMailto(); ensureSelectionVisible(); render(); syncStickyCta(); syncHoldNote(); } function toggleDate(date){ if (!isSelectable(date)) return; recoveryIso = ''; if (selectedLookup[date]) { selected = selected.filter(function(k){ return k !== date; }); } else { selected.push(date); selected.sort(); } updateSelectionUi(); } function calDayCellHtml(k, d, m, y, selStart, selEnd) { var ts = todayStr(); var cls = 'cal-cell'; var isPast = k < ts; var isFree = false; if (isPast) cls += ' past'; if (k === ts) cls += ' today'; if (booked.has(k)) cls += ' booked'; else if (tentative.has(k)) cls += ' tentative'; else if (!isPast) { cls += ' free'; isFree = true; } var isSelected = !!selectedLookup[k]; if (isSelected) { cls += ' selected'; if (k === selStart) cls += ' range-start'; if (k === selEnd) cls += ' range-end'; } var onHold = tentative.has(k) && !isPast; var isBookedFuture = booked.has(k) && !isPast; var attr = (isFree || onHold || isBookedFuture) ? ' data-date="' + k + '"' + (isBookedFuture ? ' data-booked="true" role="button" tabindex="0" aria-label="' + d + ' ' + MONTHS[m] + ' ' + y + '"' : ' data-selected="' + (isSelected ? 'true' : 'false') + '" role="button" tabindex="0" aria-pressed="' + (isSelected ? 'true' : 'false') + '" aria-label="' + d + ' ' + MONTHS[m] + ' ' + y + (onHold ? ', ' + onHoldLabel : '') + '"') : ''; return '<div class="' + cls + '"' + attr + '>' + d + '</div>'; } function monthHtml(index) { var y = Math.floor(index / 12), m = index % 12; var startDow = (new Date(y, m, 1).getDay() + 6) % 7; var daysInMonth = new Date(y, m + 1, 0).getDate(); var sortedSel = selected.slice().sort(); var contiguous = isContiguousList(sortedSel); var selStart = contiguous ? (sortedSel[0] || '') : ''; var selEnd = contiguous ? (sortedSel[sortedSel.length - 1] || '') : ''; var cells = ''; for (var i = 0; i < startDow; i++) cells += '<div class="cal-cell empty"></div>'; for (var d = 1; d <= daysInMonth; d++) { var k = y + '-' + pad(m + 1) + '-' + pad(d); cells += calDayCellHtml(k, d, m, y, selStart, selEnd); } var dow = DOW.map(function(x){ return '<span>' + x + '</span>'; }).join(''); return '<div class="cal-month">' + '<div class="cal-title">' + MONTHS[m] + ' ' + y + '</div>' + '<div class="cal-grid cal-dow" aria-hidden="true">' + dow + '</div>' + '<div class="cal-grid cal-days">' + cells + '</div>' + '</div>'; } function render() { rebuildLookup(); var count = monthsToShow(); var maxFirst = maxIndex - (count - 1); if (viewIndex > maxFirst) viewIndex = maxFirst; if (viewIndex < minIndex) viewIndex = minIndex; var html = ''; for (var i = 0; i < count; i++) { if (viewIndex + i > maxIndex) break; html += monthHtml(viewIndex + i); } monthsEl.innerHTML = html; prevBtn.disabled = (viewIndex <= minIndex); nextBtn.disabled = (viewIndex >= maxFirst); } function shift(dir) { userPagedCal = true; var count = monthsToShow(); var maxFirst = maxIndex - (count - 1); var next = viewIndex + dir * count; if (next < minIndex) next = minIndex; if (next > maxFirst) next = maxFirst; if (next === viewIndex) return; viewIndex = next; if (window.LY_clarityEvent) { window.LY_clarityEvent(dir > 0 ? 'ly_cal_avail_month_next' : 'ly_cal_avail_month_prev'); } render(); } prevBtn.addEventListener('click', function(e){ shift(-1); e.currentTarget.blur(); }); nextBtn.addEventListener('click', function(e){ shift(1); e.currentTarget.blur(); }); function cellFromEvent(e) { var node = e.target; if (!node || !monthsEl.contains(node)) return null; if (node.nodeType === 3) node = node.parentElement; if (!node || !node.closest) return null; return node.closest('.cal-cell[data-date]'); } function handleCalActivate(e) { var cell = cellFromEvent(e); if (!cell) return; e.preventDefault(); var date = cell.getAttribute('data-date'); if (!date) return; if (booked.has(date) || cell.getAttribute('data-booked') === 'true') { if (window.LY_clarityEvent) window.LY_clarityEvent('ly_cal_booked_tap'); showBookedRecovery(date); return; } if (window.LY_clarityEvent) window.LY_clarityEvent('ly_cal_avail_date_select'); toggleDate(date); } monthsEl.addEventListener('click', handleCalActivate); monthsEl.addEventListener('keydown', function(e) { if (e.key !== 'Enter' && e.key !== ' ') return; handleCalActivate(e); }); if (clearBtn) clearBtn.addEventListener('click', function(){ if (window.LY_clarityEvent) window.LY_clarityEvent('ly_cal_avail_clear'); selected = []; recoveryIso = ''; updateSelectionUi(); }); if (waBtn) waBtn.addEventListener('click', function(e) { if (!selected.length) { e.preventDefault(); return; } setDatesCountTag(selected.length); if (window.LY_clarityEvent) window.LY_clarityEvent('ly_cal_avail_whatsapp'); if (window.LY_clarityEvent) window.LY_clarityEvent('ly_cal_avail_enquire'); if (!window.LY_OWNER_MODE) { gtag('consent', 'update', { 'ad_storage': 'granted', 'ad_user_data': 'granted', 'ad_personalization': 'granted' }); gtag_report_conversion(); } }); var callBtn = document.getElementById('calCallBtn'); if (callBtn) callBtn.addEventListener('click', function() { if (window.LY_clarityEvent) window.LY_clarityEvent('ly_cal_avail_call'); }); var resizeTimer; window.addEventListener('resize', function(){ clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); }); setCtaState(false); render(); syncHoldNote();
  if (stickyClear) stickyClear.addEventListener('click', function(){ if (window.LY_clarityEvent) window.LY_clarityEvent('ly_cal_avail_clear'); selected = []; recoveryIso = ''; updateSelectionUi(); });
  if (stickyWaBtn) stickyWaBtn.addEventListener('click', function(e){ if (!selected.length) { e.preventDefault(); return; } setDatesCountTag(selected.length); if (window.LY_clarityEvent) window.LY_clarityEvent('ly_cal_sticky_whatsapp'); if (window.LY_clarityEvent) window.LY_clarityEvent('ly_cal_avail_whatsapp'); if (window.LY_clarityEvent) window.LY_clarityEvent('ly_cal_avail_enquire'); if (!window.LY_OWNER_MODE) { try { gtag('consent', 'update', { 'ad_storage': 'granted', 'ad_user_data': 'granted', 'ad_personalization': 'granted' }); gtag_report_conversion(); } catch (err) {} } });
  if (stickyAlts) stickyAlts.addEventListener('click', function(e){ var chip = e.target.closest && e.target.closest('.cal-alt-chip'); if (!chip) return; var alt = chip.getAttribute('data-date'); if (!alt || !isSelectable(alt)) return; if (window.LY_clarityEvent) window.LY_clarityEvent('ly_cal_booked_alt_select'); recoveryIso = ''; if (!selectedLookup[alt]) { selected.push(alt); selected.sort(); } updateSelectionUi(); });
  function refreshCalInView() {
    var el = document.getElementById('availability') || calRoot;
    if (!el) return;
    var r = el.getBoundingClientRect();
    var next = r.bottom > 72 && r.top < (window.innerHeight - 56);
    if (next === calInView) return;
    calInView = next;
    syncStickyCta();
  }
  if (window.IntersectionObserver) {
    var calWatch = document.getElementById('availability') || calRoot;
    var calIo = new IntersectionObserver(function () { refreshCalInView(); }, { threshold: [0, 0.08, 0.25] });
    calIo.observe(calWatch);
  }
  window.addEventListener('scroll', refreshCalInView, { passive: true });
  window.addEventListener('resize', refreshCalInView, { passive: true });
  try { barShownOnce = !!sessionStorage.getItem('ly_cal_bar_shown'); } catch (e) {}
  refreshCalInView();
  syncStickyCta();
 var availabilityFetchState = 'idle'; var availabilityWaiters = []; function lyDrainAvailWaiters() { var w = availabilityWaiters.splice(0); w.forEach(function(fn) { fn(); }); } function lyApplyAvailCal(data) { if (!data) return; booked = new Set(data.booked || []); tentative = new Set(data.tentative || []); /* firm booked wins if both */ booked.forEach(function(d){ tentative.delete(d); }); selected = selected.filter(function(k){ return isSelectable(k); }); rebuildLookup(); jumpViewToOpenMonth(); if (selected.length) updateSelectionUi(); else { syncCalMailto(); render(); syncStickyCta(); } } function lyLoadAvailCal(cb, force) { if (typeof cb === 'function') availabilityWaiters.push(cb); if (availabilityFetchState === 'loading') return; if (availabilityFetchState === 'done' && !force) { lyDrainAvailWaiters(); return; } availabilityFetchState = 'loading'; fetch((location.hostname.endsWith('.github.io') ? 'https://limitlessyachtcharter.com' : '') + '/api/availability?fresh=1', { cache: 'no-store' }) .then(function(r){ return r.ok ? r.json() : null; }) .then(function(data){ availabilityFetchState = 'done'; lyApplyAvailCal(data); }) .catch(function(){ availabilityFetchState = 'idle'; }) .finally(function() { if (availabilityFetchState === 'loading') availabilityFetchState = 'idle'; lyDrainAvailWaiters(); }); } window.LY_loadAvailCalNow = lyLoadAvailCal; function lyScheduleAvailCalLoad() { if (window.LY_whenNearSection) window.LY_whenNearSection('availability', lyLoadAvailCal); else lyLoadAvailCal(); var hash = (location.hash || '').replace(/^#/, ''); if (hash === 'availability' || hash === 'availability-land' || hash === 'avail-cal') { lyLoadAvailCal(); } } lyScheduleAvailCalLoad(); })();
