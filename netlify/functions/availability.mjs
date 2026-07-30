// Public site availability calendar.
//
// Source of truth: commercial **leads** in the tracker blob.
//   - pending source → tentative / on hold
//   - captain / clickboat / owner → booked
//   - cancelled → omitted
// Fallback: manager ICS only if no leads in the store.
// Tracker stews also use leads client-side; ICS still used for “new date” detection.

import { getStore } from "@netlify/blobs";
import { parseIcs, siteCalendarPublicPayload } from "./lib/ics.mjs";
import { buildSiteCalendarFromLeads } from "./lib/site-calendar.mjs";

const ICS_URL = process.env.AVAILABILITY_ICS_URL || "";
/** Force ICS (emergency only): AVAILABILITY_SOURCE=ics */
const FORCE_ICS =
  String(process.env.AVAILABILITY_SOURCE || "").toLowerCase() === "ics";

export async function handler(event) {
  const qs = (event && event.queryStringParameters) || {};
  const fresh = qs.fresh === "1" || qs.fresh === "true";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": fresh
      ? "private, no-store, max-age=0, must-revalidate"
      : "public, max-age=120", // 2 min — pending→booked should show sooner
  };

  try {
    if (!FORCE_ICS) {
      const fromLeads = await serveFromLeads(fresh);
      if (fromLeads) {
        return { statusCode: 200, headers, body: JSON.stringify(fromLeads) };
      }
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

async function loadTrackerData() {
  try {
    const store = getStore("limitless-tracker");
    return await store.get("data", { type: "json", consistency: "strong" });
  } catch (e) {
    return null;
  }
}

async function serveFromLeads(fresh) {
  const data = await loadTrackerData();
  if (!data || !Array.isArray(data.leads) || !data.leads.length) return null;

  /* Always rebuild from live leads so pending→hold is never stale */
  const cal = buildSiteCalendarFromLeads(data.leads, "availability", new Date().toISOString());
  const body = siteCalendarPublicPayload(cal, {
    note: "leads SOT · pending = on hold",
  });
  body.fresh = !!fresh;
  body.source = "leads";
  body.active = true;
  /* Counts for debugging */
  body.leadCount = data.leads.length;
  body.pendingHoldDays = (cal.tentative || []).length;
  body.bookedDays = (cal.booked || []).length;
  return body;
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
        note: "ICS feed not configured and no leads in store",
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
        note: "Fallback ICS (no leads in tracker store)",
      }),
    };
  } catch (err) {
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

export { parseIcs, expandEvent } from "./lib/ics.mjs";
