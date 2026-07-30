/**
 * Shared iCal (.ics) parse for availability + site-calendar seed.
 * Pure: no Netlify / fetch — call with feed text.
 */

export function parseIcs(ics) {
  // Unfold folded lines (continuation lines start with a space or tab).
  const unfolded = String(ics || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "");
  const lines = unfolded.split("\n");

  const booked = new Set();
  const tentative = new Set();
  const events = [];
  let cur = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur && cur.start && cur.status !== "CANCELLED") {
        const isTentative =
          cur.status === "TENTATIVE" ||
          /\b(hold|tentative|option|pencil|enquiry|inquiry|provisional)\b/i.test(
            cur.summary || ""
          );
        const target = isTentative ? tentative : booked;
        for (const day of expandEvent(cur)) target.add(day);

        const days = expandEvent(cur);
        events.push({
          key: eventKey(cur),
          uid: cur.uid || "",
          summary: decodeIcsText(cur.summary || "Charter"),
          start: cur.start,
          end: cur.end || cur.start,
          startTime: cur.startTime || "",
          endTime: cur.endTime || "",
          allDay: !!cur.allDay,
          status: isTentative ? "tentative" : "booked",
          days,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const rawKey = line.slice(0, idx);
    const val = line.slice(idx + 1).trim();
    const name = rawKey.split(";")[0].toUpperCase();

    if (name === "DTSTART") {
      const dt = parseIcsDateTime(val, rawKey);
      cur.start = dt.date;
      cur.startTime = dt.time;
      cur.allDay = dt.allDay;
      cur.hasTime = !!dt.time;
    } else if (name === "DTEND") {
      const dt = parseIcsDateTime(val, rawKey);
      cur.end = dt.date;
      cur.endTime = dt.time;
    } else if (name === "STATUS") {
      cur.status = val.toUpperCase();
    } else if (name === "SUMMARY") {
      cur.summary = val;
    } else if (name === "UID") {
      // Keep first UID (event); ignore nested VALARM UIDs
      if (!cur.uid) cur.uid = val;
    } else if (name === "ORGANIZER") {
      cur.organizer = val;
      const cn = rawKey.match(/CN=([^;:]+)/i);
      if (cn) cur.organizerCn = decodeIcsText(cn[1].replace(/^"|"$/g, ""));
    } else if (name === "RRULE") {
      cur.rrule = val;
    } else if (name === "RDATE") {
      cur.rdates = cur.rdates || [];
      cur.rdates.push(toDate(val));
    }
  }

  events.sort((a, b) => {
    const c = String(a.start).localeCompare(String(b.start));
    if (c) return c;
    return String(a.startTime || "").localeCompare(String(b.startTime || ""));
  });

  return {
    booked: [...booked].sort(),
    tentative: [...tentative].sort(),
    events,
  };
}

export function decodeIcsText(s) {
  return String(s || "")
    .replace(/\\n/g, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

export function eventKey(cur) {
  if (cur.uid) return "uid:" + cur.uid;
  return (
    "ev:" +
    (cur.start || "") +
    "|" +
    (cur.end || "") +
    "|" +
    (cur.startTime || "") +
    "|" +
    (cur.summary || "")
  );
}

function toDate(val) {
  if (!val) return null;
  const m = val.match(/(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? m[1] + "-" + m[2] + "-" + m[3] : null;
}

/** Parse ICS date or date-time → { date: YYYY-MM-DD, time: HH:MM or "", allDay } */
export function parseIcsDateTime(val, rawKey) {
  const allDay = /VALUE=DATE(?!-TIME)/i.test(rawKey || "") || /^\d{8}$/.test(val);
  const m = String(val || "").match(
    /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/
  );
  if (!m) return { date: toDate(val), time: "", allDay: true };
  const date = m[1] + "-" + m[2] + "-" + m[3];
  if (allDay || !m[4]) return { date, time: "", allDay: true };
  return { date, time: m[4] + ":" + m[5], allDay: false };
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

export function expandRange(startKey, endKey, allDay) {
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
  const spanDays = Math.round(
    (parseDateKey(ev.end) - parseDateKey(ev.start)) / 86400000
  );
  if (spanDays <= 0) return startKey;
  return formatDateKey(addUtcDays(parseDateKey(startKey), spanDays));
}

function addEventInstance(days, ev, startKey) {
  if (!startKey) return;
  for (const day of expandRange(startKey, instanceEndKey(ev, startKey), ev.allDay))
    days.add(day);
}

export function expandEvent(ev) {
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
        else if (freq === "MONTHLY")
          cursor = new Date(
            Date.UTC(
              cursor.getUTCFullYear(),
              cursor.getUTCMonth() + interval,
              cursor.getUTCDate()
            )
          );
        else break;
      }
    }
  }

  return [...days];
}

/**
 * Guest-facing event shape only — no guest names, lead ids, or source labels.
 * Website calendar only needs booked/tentative day lists; events stay anonymous
 * for any client that still reads them.
 */
export function sanitizePublicCalendarEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.map((e, i) => {
    const days = Array.isArray(e && e.days) ? e.days.slice() : [];
    const start = (e && e.start) || (days[0] || "");
    const end = (e && e.end) || start;
    const status =
      e && e.status === "tentative" ? "tentative" : "booked";
    return {
      key: "block:" + (start || i) + ":" + status,
      summary: "Charter",
      start,
      end,
      startTime: "",
      endTime: "",
      allDay: true,
      status,
      days,
    };
  });
}

/**
 * Build public availability payload from a stored site calendar snapshot.
 * Never includes guest names, phones, money, lead ids, or leadSource.
 */
export function siteCalendarPublicPayload(cal, extras) {
  extras = extras || {};
  if (!cal || typeof cal !== "object") {
    return {
      booked: [],
      tentative: [],
      events: [],
      generatedAt: new Date().toISOString(),
      source: "blob",
      active: false,
      note: "Site calendar empty",
    };
  }
  return {
    booked: Array.isArray(cal.booked) ? cal.booked.slice() : [],
    tentative: Array.isArray(cal.tentative) ? cal.tentative.slice() : [],
    events: sanitizePublicCalendarEvents(cal.events),
    generatedAt: cal.generatedAt || cal.updatedAt || new Date().toISOString(),
    seededAt: cal.seededAt || "",
    seededFrom: cal.seededFrom || "",
    active: !!cal.active,
    source: "blob",
    note: extras.note || cal.note || "",
  };
}
