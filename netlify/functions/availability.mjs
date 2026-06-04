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
        const isTentative = /\b(hold|tentative|option|pencil|enquiry|inquiry|provisional)\b/i.test(cur.summary || "");
        const target = isTentative ? tentative : booked;
        for (const day of expand(cur)) target.add(day);
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
    } else if (name === "DTEND") {
      cur.end = toDate(val);
    } else if (name === "STATUS") {
      cur.status = val.toUpperCase();
    } else if (name === "SUMMARY") {
      cur.summary = val;
    }
  }

  return { booked: [...booked].sort(), tentative: [...tentative].sort() };
}

function toDate(val) {
  const m = val.match(/(\d{4})(\d{2})(\d{2})/);
  return m ? (m[1] + "-" + m[2] + "-" + m[3]) : null;
}

function expand(ev) {
  const out = [];
  const start = new Date(ev.start + "T00:00:00Z");
  let end = new Date((ev.end || ev.start) + "T00:00:00Z");
  // For all-day events, DTEND is exclusive (the checkout day) — step back one day.
  if (ev.allDay && ev.end) end.setUTCDate(end.getUTCDate() - 1);
  if (end < start) end = new Date(start);
  let d = new Date(start), guard = 0;
  while (d <= end && guard < 500) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    guard++;
  }
  return out;
}
