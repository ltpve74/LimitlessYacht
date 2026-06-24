// Reads a shared calendar's public iCal (.ics) feed and returns booked/tentative
// dates as JSON for the on-site availability calendar.
//
// Configure the feed URL via the Netlify environment variable AVAILABILITY_ICS_URL
// (Site settings → Environment variables). Works with any iCal feed — iCloud
// shared calendar public link, Google Calendar secret/public iCal address, etc.
// webcal:// URLs are accepted and upgraded to https://.

const ICS_URL = process.env.AVAILABILITY_ICS_URL || "";

export async function handler() {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=1800" // 30 min CDN cache
  };

  if (!ICS_URL) {
    return { statusCode: 200, headers, body: JSON.stringify({ booked: [], tentative: [], note: "ICS feed not configured" }) };
  }

  try {
    const url = ICS_URL.replace(/^webcal:\/\//i, "https://");
    const res = await fetch(url, { headers: { "User-Agent": "LimitlessYacht/1.0 (+https://limitlessyachtcharter.com)" } });
    if (!res.ok) throw new Error("ICS fetch failed: " + res.status);
    const text = await res.text();
    const { booked, tentative } = parseIcs(text);
    return { statusCode: 200, headers, body: JSON.stringify({ booked, tentative, generatedAt: new Date().toISOString() }) };
  } catch (err) {
    // Fail soft: the front-end falls back to an all-available calendar.
    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=60" },
      body: JSON.stringify({ booked: [], tentative: [], error: String(err) })
    };
  }
}

function parseIcs(ics) {
  // Unfold folded lines (continuation lines start with a space or tab).
  const unfolded = ics.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const lines = unfolded.split("\n");

  const booked = new Set();
  const tentative = new Set();
  let cur = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur && cur.start && cur.status !== "CANCELLED") {
        const isTentative = cur.status === "TENTATIVE"
          || /\b(hold|tentative|option|pencil|enquiry|inquiry|provisional)\b/i.test(cur.summary || "");
        const target = isTentative ? tentative : booked;
        for (const day of expandEvent(cur)) target.add(day);
      }
      cur = null; continue;
    }
    if (!cur) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const rawKey = line.slice(0, idx);
    const val = line.slice(idx + 1).trim();
    const name = rawKey.split(";")[0].toUpperCase();

    if (name === "DTSTART") {
      cur.start = toDate(val);
      cur.allDay = /VALUE=DATE(?!-TIME)/i.test(rawKey) || /^\d{8}$/.test(val);
      cur.hasTime = /T\d{6}/.test(val);
    } else if (name === "DTEND") {
      cur.end = toDate(val);
    } else if (name === "STATUS") {
      cur.status = val.toUpperCase();
    } else if (name === "SUMMARY") {
      cur.summary = val;
    } else if (name === "RRULE") {
      cur.rrule = val;
    } else if (name === "RDATE") {
      cur.rdates = cur.rdates || [];
      cur.rdates.push(toDate(val));
    }
  }

  return { booked: [...booked].sort(), tentative: [...tentative].sort() };
}

function toDate(val) {
  if (!val) return null;
  const m = val.match(/(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? (m[1] + "-" + m[2] + "-" + m[3]) : null;
}

function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateKey(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function addUtcDays(d, n) {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function expandRange(startKey, endKey, allDay) {
  const out = [];
  const start = parseDateKey(startKey);
  let end = parseDateKey(endKey || startKey);
  if (allDay && endKey) end = addUtcDays(end, -1);
  if (end < start) end = new Date(start);
  let d = new Date(start);
  let guard = 0;
  while (d <= end && guard < 500) {
    out.push(formatDateKey(d));
    d = addUtcDays(d, 1);
    guard++;
  }
  return out;
}

function instanceEndKey(ev, startKey) {
  if (!ev.end || ev.end === ev.start) return startKey;
  const spanDays = Math.round((parseDateKey(ev.end) - parseDateKey(ev.start)) / 86400000);
  if (spanDays <= 0) return startKey;
  return formatDateKey(addUtcDays(parseDateKey(startKey), spanDays));
}

function addEventInstance(days, ev, startKey) {
  if (!startKey) return;
  for (const day of expandRange(startKey, instanceEndKey(ev, startKey), ev.allDay)) days.add(day);
}

function expandEvent(ev) {
  const days = new Set();
  addEventInstance(days, ev, ev.start);
  for (const rdate of ev.rdates || []) addEventInstance(days, ev, rdate);

  if (ev.rrule) {
    const rule = {};
    ev.rrule.split(";").forEach((part) => {
      const i = part.indexOf("=");
      if (i > 0) rule[part.slice(0, i).toUpperCase()] = part.slice(i + 1);
    });
    const freq = rule.FREQ;
    if (freq) {
      const interval = Math.max(1, parseInt(rule.INTERVAL || "1", 10) || 1);
      const count = rule.COUNT ? parseInt(rule.COUNT, 10) : null;
      const until = rule.UNTIL ? toDate(rule.UNTIL) : null;
      let cursor = parseDateKey(ev.start);
      const horizon = addUtcDays(parseDateKey(ev.start), 560);
      let n = 0;
      while (n < 400) {
        n++;
        if (count && n > count) break;
        const key = formatDateKey(cursor);
        if (until && key > until) break;
        if (cursor > horizon) break;
        if (n > 1) addEventInstance(days, ev, key);
        if (freq === "DAILY") cursor = addUtcDays(cursor, interval);
        else if (freq === "WEEKLY") cursor = addUtcDays(cursor, 7 * interval);
        else if (freq === "MONTHLY") cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + interval, cursor.getUTCDate()));
        else break;
      }
    }
  }

  return [...days];
}