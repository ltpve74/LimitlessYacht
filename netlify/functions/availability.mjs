// Public site availability calendar.
//
// Source of truth: commercial **leads** in the tracker blob.
//   - pending source → tentative / on hold
//   - captain / clickboat / owner → booked
//   - cancelled → omitted
// Fallback: manager ICS only if no leads data is reachable.
//
// Uses the same Blobs store as tracker.mjs. A dedicated `public-availability`
// key is written on every tracker save so this function can read a small
// payload even when the full `data` blob is slow/unavailable.

import { getStore } from "@netlify/blobs";
import { parseIcs, siteCalendarPublicPayload } from "./lib/ics.mjs";
import { buildSiteCalendarFromLeads } from "./lib/site-calendar.mjs";

const STORE_NAME = "limitless-tracker";
const DATA_KEY = "data";
const PUBLIC_KEY = "public-availability";
const ICS_URL = process.env.AVAILABILITY_ICS_URL || "";
/** Force ICS (emergency only): AVAILABILITY_SOURCE=ics */
const FORCE_ICS =
  String(process.env.AVAILABILITY_SOURCE || "").toLowerCase() === "ics";

function openStore() {
  /* Match tracker.mjs: string name is the production pattern that works. */
  return getStore(STORE_NAME);
}

function cacheHeaders(fresh) {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": fresh
      ? "private, no-store, max-age=0, must-revalidate"
      : "public, max-age=120",
  };
}

async function resolveAvailability(fresh) {
  if (!FORCE_ICS) {
    const fromLeads = await serveFromLeads(fresh);
    if (fromLeads && !fromLeads.__miss) return fromLeads;
    return serveFromIcsBody(fresh, fromLeads && fromLeads.diag);
  }
  return serveFromIcsBody(fresh, null);
}

/**
 * Netlify Functions 2.0 handler (same style as tracker) so Blobs env injection
 * matches the app that writes leads.
 */
export default async (req) => {
  const url = new URL(req.url);
  const fresh =
    url.searchParams.get("fresh") === "1" ||
    url.searchParams.get("fresh") === "true";
  const headers = cacheHeaders(fresh);

  try {
    const body = await resolveAvailability(fresh);
    return new Response(JSON.stringify(body), { status: 200, headers });
  } catch (err) {
    return new Response(
      JSON.stringify({
        booked: [],
        tentative: [],
        events: [],
        error: String(err && err.message ? err.message : err),
        source: "error",
      }),
      {
        status: 200,
        headers: { ...headers, "Cache-Control": "public, max-age=60" },
      }
    );
  }
};

/**
 * Classic Functions v1 entry (redirects / older runtimes). Same body as default.
 */
export async function handler(event) {
  const qs = (event && event.queryStringParameters) || {};
  const fresh = qs.fresh === "1" || qs.fresh === "true";
  const headers = cacheHeaders(fresh);

  try {
    const body = await resolveAvailability(fresh);
    return { statusCode: 200, headers, body: JSON.stringify(body) };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=60" },
      body: JSON.stringify({
        booked: [],
        tentative: [],
        events: [],
        error: String(err && err.message ? err.message : err),
        source: "error",
      }),
    };
  }
}

async function serveFromLeads(fresh) {
  const diag = { steps: [] };

  /* 1) Dedicated public key (written by tracker on every save) */
  try {
    const store = openStore();
    const pub = await store.get(PUBLIC_KEY, {
      type: "json",
      consistency: "strong",
    });
    if (pub && typeof pub === "object") {
      const hasDays =
        (Array.isArray(pub.booked) && pub.booked.length) ||
        (Array.isArray(pub.tentative) && pub.tentative.length) ||
        (Array.isArray(pub.events) && pub.events.length) ||
        pub.leadCount > 0;
      if (hasDays || pub.source === "leads") {
        diag.steps.push("public-key");
        return finalizeLeadsBody(
          pub,
          fresh,
          "leads-public",
          diag,
          "public-availability key"
        );
      }
      diag.steps.push("public-key-empty");
    } else {
      diag.steps.push("public-key-miss");
    }
  } catch (e) {
    diag.steps.push("public-key-err");
    diag.publicErr = String(e && e.message ? e.message : e);
  }

  /* 2) Full tracker data blob → rebuild from live leads */
  let data = null;
  try {
    const store = openStore();
    data = await store.get(DATA_KEY, { type: "json", consistency: "strong" });
    if (!data) {
      data = await store.get(DATA_KEY, { type: "json" });
    }
    diag.steps.push(data ? "data-ok" : "data-empty");
  } catch (e) {
    diag.steps.push("data-err");
    diag.dataErr = String(e && e.message ? e.message : e);
    return {
      booked: [],
      tentative: [],
      events: [],
      source: "leads-error",
      note: "Blob read failed: " + diag.dataErr,
      fresh: !!fresh,
      generatedAt: new Date().toISOString(),
      diag,
    };
  }

  if (!data || typeof data !== "object") {
    diag.steps.push("no-data");
    return { __miss: true, diag };
  }

  const leads = Array.isArray(data.leads) ? data.leads : [];
  if (leads.length) {
    const cal = buildSiteCalendarFromLeads(
      leads,
      "availability",
      new Date().toISOString()
    );
    const body = siteCalendarPublicPayload(cal, {
      note: "leads SOT · pending = on hold",
    });
    body.source = "leads";
    body.active = true;
    body.leadCount = leads.length;
    body.pendingHoldDays = (cal.tentative || []).length;
    body.bookedDays = (cal.booked || []).length;
    body.fresh = !!fresh;
    body.diag = diag;
    diag.steps.push("rebuild-leads");
    return body;
  }

  /* 3) Snapshot inside data blob (from last rebuild) */
  const snap = data.siteCalendar;
  if (
    snap &&
    typeof snap === "object" &&
    (snap.seededFrom === "leads" || snap.active) &&
    (Array.isArray(snap.booked) ||
      Array.isArray(snap.events) ||
      Array.isArray(snap.tentative))
  ) {
    diag.steps.push("siteCalendar-snap");
    const body = siteCalendarPublicPayload(snap, {
      note: "siteCalendar snapshot (empty leads array on read)",
    });
    body.source = "leads-snapshot";
    body.active = true;
    body.fresh = !!fresh;
    body.diag = diag;
    return body;
  }

  diag.steps.push("no-leads");
  return {
    __miss: true,
    diag,
    leadCount: 0,
    hasSiteCal: !!(snap && typeof snap === "object"),
  };
}

function finalizeLeadsBody(pub, fresh, source, diag, note) {
  return {
    booked: Array.isArray(pub.booked) ? pub.booked : [],
    tentative: Array.isArray(pub.tentative) ? pub.tentative : [],
    events: Array.isArray(pub.events) ? pub.events : [],
    generatedAt: pub.generatedAt || new Date().toISOString(),
    seededAt: pub.seededAt || "",
    seededFrom: pub.seededFrom || "leads",
    active: pub.active !== false,
    source: source || "leads",
    note: note || pub.note || "leads SOT · pending = on hold",
    fresh: !!fresh,
    leadCount: pub.leadCount,
    pendingHoldDays:
      pub.pendingHoldDays != null
        ? pub.pendingHoldDays
        : (pub.tentative || []).length,
    bookedDays:
      pub.bookedDays != null ? pub.bookedDays : (pub.booked || []).length,
    diag,
  };
}

async function serveFromIcsBody(fresh, missDiag) {
  if (!ICS_URL) {
    return {
      booked: [],
      tentative: [],
      events: [],
      note: "ICS feed not configured and no leads in store",
      source: "ics",
      fresh: !!fresh,
      diag: missDiag || undefined,
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
      booked: parsed.booked,
      tentative: parsed.tentative,
      events: parsed.events,
      generatedAt: new Date().toISOString(),
      fresh: !!fresh,
      source: "ics",
      note:
        "Fallback ICS (no leads in tracker store) — pending trips look booked until app saves leads",
      diag: missDiag || undefined,
    };
  } catch (err) {
    return {
      booked: [],
      tentative: [],
      events: [],
      error: String(err && err.message ? err.message : err),
      source: "ics",
      fresh: !!fresh,
      diag: missDiag || undefined,
    };
  }
}

export { parseIcs, expandEvent } from "./lib/ics.mjs";
