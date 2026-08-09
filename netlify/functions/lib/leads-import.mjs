/**
 * ICS → leads helpers (bundled into tracker.mjs).
 * Keep pricing/sources aligned with tracker/js/models.js CHARTER_RATES / lead sources.
 */

export const CHARTER_RATES = {
  low: { "4h": 1700, "6h": 2400, "8h": 3000, day: 3000 },
  high: { "4h": 2200, "6h": 3100, "8h": 4000, day: 4000 },
};

export function constrainLeadSource(v) {
  var s = String(v || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
  if (!s) return "other";
  if (s === "pending" || s === "unassigned" || s === "assign") return "pending";
  if (
    s === "dayoff" ||
    s === "day-off" ||
    s === "day_off" ||
    s === "off" ||
    s === "off-day" ||
    s === "off_day" ||
    s === "closed" ||
    s === "vessel-off" ||
    s === "vessel_off"
  )
    return "dayoff";
  if (s === "captain" || s === "cpt" || s === "website" || s === "web" || s === "direct")
    return "captain";
  if (
    s === "clickboat" ||
    s === "click_boat" ||
    s === "click-and-boat" ||
    s === "click&boat" ||
    s === "c&b" ||
    s === "cb" ||
    s === "paul"
  )
    return "clickboat";
  /* Owner-sourced commercial (income) — distinct from owner days */
  if (
    s === "ownersourced" ||
    s === "owner-sourced" ||
    s === "owner_sourced" ||
    s === "owner-source" ||
    s === "ownersource" ||
    s === "owner-charter" ||
    s === "owner_charter" ||
    s === "ownercharter" ||
    s === "owner-income" ||
    s === "owner_income"
  )
    return "ownersourced";
  if (
    s === "owner" ||
    s === "owners" ||
    s === "owner-day" ||
    s === "owner-days" ||
    s === "ownerdays" ||
    s === "owner_days" ||
    s === "owner-use" ||
    s === "owner_use" ||
    s === "private"
  )
    return "owner";
  if (s === "other" || s === "agency" || s === "manager") return "other";
  return "other";
}

export function leadIsDayOff(r) {
  if (!r) return false;
  if (r.dayOff === true || r.dayOff === "true" || r.dayOff === 1) return true;
  if (String(r.leadKind || r.kind || "").toLowerCase() === "dayoff") return true;
  return constrainLeadSource(r.leadSource) === "dayoff";
}

export function dayOffLabelFromSummary(summary) {
  var s = String(summary || "").trim();
  if (!s || /^\s*off\s*$/i.test(s)) return "Day off";
  var m = s.match(/^\s*off\s*[-–—:]\s*(.+)$/i);
  if (m && m[1]) return ("Day off — " + String(m[1]).trim()).slice(0, 80);
  if (/^\s*day\s*off\b/i.test(s)) return s.slice(0, 80);
  if (isIcsOffSummary(s)) return ("Day off — " + s.replace(/^\s*off\s*/i, "").trim()).slice(0, 80);
  return "Day off";
}

export function charterSeason(ymd) {
  var m = parseInt(String(ymd || "").slice(5, 7), 10);
  if (!(m >= 1 && m <= 12)) m = new Date().getMonth() + 1;
  return m >= 7 && m <= 8 ? "high" : "low";
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function hoursBetweenTimes(startTime, endTime) {
  if (!startTime || !endTime) return null;
  var sh = String(startTime).split(":");
  var eh = String(endTime).split(":");
  var sm = parseInt(sh[0], 10) * 60 + (parseInt(sh[1], 10) || 0);
  var em = parseInt(eh[0], 10) * 60 + (parseInt(eh[1], 10) || 0);
  if (!isFinite(sm) || !isFinite(em)) return null;
  var hours = (em - sm) / 60;
  if (hours < 0) hours += 24;
  return hours;
}

function charterCalendarDays(start, end, allDay, daysList) {
  if (daysList && daysList.length) return daysList.length;
  var s = String(start || "").slice(0, 10);
  var e = String(end || start || "").slice(0, 10);
  if (!s) return 1;
  if (!e || e === s) return 1;
  var a = new Date(s + "T12:00:00Z");
  var b = new Date(e + "T12:00:00Z");
  var diff = Math.round((b - a) / 86400000);
  if (allDay && diff > 0) return diff;
  if (diff < 0) return 1;
  return diff + 1;
}

export function charterPriceFromEvent(ev) {
  ev = ev || {};
  var start = String(ev.start || "").slice(0, 10);
  var end = String(ev.end || ev.start || "").slice(0, 10);
  var season = charterSeason(start);
  var table = CHARTER_RATES[season] || CHARTER_RATES.low;
  var days = charterCalendarDays(start, end, !!ev.allDay, ev.days);
  var sum = String(ev.summary || "");
  /* Real clock span wins when present — stale "6h" in the title must not
   * keep pricing/duration at 6 after the manager moved the event to 12–20. */
  var hours = hoursBetweenTimes(ev.startTime, ev.endTime);
  if (hours == null) {
    if (/\b4\s*h(our)?s?\b/i.test(sum) || /\bhalf[-\s]?day\b/i.test(sum)) hours = 4;
    else if (/\b6\s*h(our)?s?\b/i.test(sum)) hours = 6;
    else if (/\b8\s*h(our)?s?\b/i.test(sum) || /\bfull[-\s]?day\b/i.test(sum)) hours = 8;
  }

  var multi =
    days > 1 || /\b(overnight|overnights?|multi[-\s]?day|nights?)\b/i.test(sum);

  if (multi) {
    var dayRate = table.day;
    var totalM = round2(dayRate * days);
    return {
      season: season,
      dur: "multi",
      days: days,
      rate: dayRate,
      price: totalM,
      total: totalM,
      label: days + "-day · " + season + " season · €" + dayRate + "/day",
    };
  }
  var dur = "8h";
  if (hours != null && hours <= 4.5) dur = "4h";
  else if (hours != null && hours <= 7) dur = "6h";
  else if (hours != null) dur = "8h";
  else if (ev.allDay) dur = "8h";
  var price = table[dur] != null ? table[dur] : table["8h"];
  return {
    season: season,
    dur: dur,
    days: 1,
    rate: price,
    price: price,
    total: price,
    label: dur + " · " + season + " season · €" + price,
  };
}

export function guestNameFromIcsSummary(summary) {
  var s = String(summary || "").trim();
  if (!s) return "Charter guest";
  s = s.replace(/\[(CB|C&B|CLICK\s*&?\s*BOAT|WEB|WEBSITE|SITE|OWNER)\]/gi, " ");
  s = s.replace(/\b(click\s*&?\s*boat|clickboat)\b/gi, " ");
  s = s.split(/\s*[-–—|]\s*/)[0];
  s = s.replace(/\s+/g, " ").trim();
  if (!s || /^(off|charter|hold|tentative)$/i.test(s)) return "Charter guest";
  return s.slice(0, 80);
}

export function isIcsOffSummary(summary) {
  var s = String(summary || "").trim();
  if (/^\s*off\s*$/i.test(s)) return true;
  if (/^\s*off\s*[-–—:].+/i.test(s)) return true;
  if (/^\s*day\s*off\b/i.test(s)) return true;
  if (/^\s*closed\b/i.test(s) && !/\bcharter\b/i.test(s)) return true;
  return false;
}
