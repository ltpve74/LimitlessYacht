// Public site availability calendar.
//
// Default (production-safe): live manager ICS via AVAILABILITY_ICS_URL.
// App-owned store: Netlify Blobs siteCalendar on the tracker store, when
//   - env AVAILABILITY_SOURCE=blob, or
//   - siteCalendar.active === true (captain Activate in tracker).
//
// Until activated, guests keep seeing live ICS. Tracker stews still use
// ?fresh=1 → live ICS regardless of this switch.

import { getStore } from "@netlify/blobs";
import { parseIcs, siteCalendarPublicPayload } from "./lib/ics.mjs";

const ICS_URL = process.env.AVAILABILITY_ICS_URL || "";
const FORCE_BLOB =
  String(process.env.AVAILABILITY_SOURCE || "").toLowerCase() === "blob";

export async function handler(event) {
  // ?fresh=1 → no CDN/browser cache (tracker "Refresh calendar"). Default is short
  // public cache so the marketing calendar stays snappy without hammering the ICS host.
  const qs = (event && event.queryStringParameters) || {};
  const fresh = qs.fresh === "1" || qs.fresh === "true";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": fresh
      ? "private, no-store, max-age=0, must-revalidate"
      : "public, max-age=300", // 5 min
  };

  try {
    const preferBlob = FORCE_BLOB || (await isSiteCalendarActive());
    if (preferBlob) {
      const fromBlob = await loadSiteCalendarBlob();
      if (fromBlob && (fromBlob.booked || fromBlob.events)) {
        const body = siteCalendarPublicPayload(fromBlob, {
          note: FORCE_BLOB ? "AVAILABILITY_SOURCE=blob" : "siteCalendar.active",
        });
        body.fresh = !!fresh;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(body),
        };
      }
      /* Active but empty — fall through to ICS so site is not all-open by mistake */
    }

    return await serveFromIcs(headers, fresh);
  } catch (err) {
    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=60" },
      body: JSON.stringify({
        booked: [],
        tentative: [],
        events: [],
        error: String(err),
        source: "error",
      }),
    };
  }
}

async function isSiteCalendarActive() {
  try {
    const cal = await loadSiteCalendarBlob();
    return !!(cal && cal.active);
  } catch (e) {
    return false;
  }
}

async function loadSiteCalendarBlob() {
  try {
    const store = getStore("limitless-tracker");
    const data = await store.get("data", { type: "json", consistency: "strong" });
    if (!data || !data.siteCalendar || typeof data.siteCalendar !== "object") return null;
    return data.siteCalendar;
  } catch (e) {
    return null;
  }
}

async function serveFromIcs(headers, fresh) {
  if (!ICS_URL) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        booked: [],
        tentative: [],
        events: [],
        note: "ICS feed not configured",
        source: "ics",
      }),
    };
  }

  try {
    const url = ICS_URL.replace(/^webcal:\/\//i, "https://");
    const res = await fetch(url, {
      headers: {
        "User-Agent": "LimitlessYacht/1.0 (+https://limitlessyachtcharter.com)",
        ...(fresh ? { "Cache-Control": "no-cache", Pragma: "no-cache" } : {}),
      },
    });
    if (!res.ok) throw new Error("ICS fetch failed: " + res.status);
    const text = await res.text();
    const parsed = parseIcs(text);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        booked: parsed.booked,
        tentative: parsed.tentative,
        events: parsed.events,
        generatedAt: new Date().toISOString(),
        fresh: !!fresh,
        source: "ics",
      }),
    };
  } catch (err) {
    // Fail soft: the front-end falls back to an all-available calendar.
    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=60" },
      body: JSON.stringify({
        booked: [],
        tentative: [],
        events: [],
        error: String(err),
        source: "ics",
      }),
    };
  }
}

// Re-export for tests / other callers that imported from this file historically
export { parseIcs, expandEvent } from "./lib/ics.mjs";
