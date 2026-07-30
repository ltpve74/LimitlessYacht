// Public site availability calendar — READ ONLY, no auth.
//
// Threat model (guests hit this unauthenticated):
//   • Must never return guest names, phones, money, lead ids, or ops notes
//   • Must never write blobs or accept user-controlled URLs (no SSRF)
//   • Must not load the private tracker `data` blob (full leads store)
//
// Source of truth for display:
//   1) `public-availability` key — written by tracker on every save
//      (pending → tentative/on hold; assigned → booked; sanitized)
//   2) Manager ICS env URL only — fallback if public key empty
//
// Tracker API stays passcode-gated POST; this function cannot call it.

import { getStore } from "@netlify/blobs";
import {
  parseIcs,
  siteCalendarPublicPayload,
  sanitizePublicCalendarEvents,
} from "./lib/ics.mjs";

const STORE_NAME = "limitless-tracker";
const PUBLIC_KEY = "public-availability";
const ICS_URL = process.env.AVAILABILITY_ICS_URL || "";
const FORCE_ICS =
  String(process.env.AVAILABILITY_SOURCE || "").toLowerCase() === "ics";
/** Cap day lists so a poisoned blob cannot inflate responses. */
const MAX_DAYS = 800;

function openStore() {
  return getStore(STORE_NAME);
}

function cacheHeaders(fresh) {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": fresh
      ? "private, no-store, max-age=0, must-revalidate"
      : "public, max-age=120",
    "X-Content-Type-Options": "nosniff",
  };
}

/** Only YYYY-MM-DD strings, capped. */
function sanitizeYmdList(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i < arr.length && out.length < MAX_DAYS; i++) {
    const s = String(arr[i] == null ? "" : arr[i]).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) out.push(s);
  }
  return out;
}

/**
 * Final guest payload — only calendar occupancy, no PII, no diag, no counts
 * that reveal lead inventory.
 */
function guestPayload(raw, extras) {
  extras = extras || {};
  const cleaned = siteCalendarPublicPayload(
    {
      booked: sanitizeYmdList(raw && raw.booked),
      tentative: sanitizeYmdList(raw && raw.tentative),
      events: (raw && raw.events) || [],
      generatedAt: raw && raw.generatedAt,
      seededAt: raw && raw.seededAt,
      seededFrom: raw && raw.seededFrom,
      active: raw && raw.active,
      note: extras.note || (raw && raw.note) || "",
    },
    { note: extras.note || (raw && raw.note) || "" }
  );
  /* Drop any accidental extra keys from a poisoned public blob */
  return {
    booked: sanitizeYmdList(cleaned.booked),
    tentative: sanitizeYmdList(cleaned.tentative),
    events: sanitizePublicCalendarEvents(cleaned.events).slice(0, MAX_DAYS),
    generatedAt: cleaned.generatedAt || new Date().toISOString(),
    active: !!cleaned.active,
    source: extras.source || "leads",
    note: String(extras.note || cleaned.note || "").slice(0, 160),
    fresh: !!extras.fresh,
  };
}

function emptyGuest(source, note, fresh) {
  return {
    booked: [],
    tentative: [],
    events: [],
    generatedAt: new Date().toISOString(),
    active: false,
    source: source || "empty",
    note: String(note || "").slice(0, 160),
    fresh: !!fresh,
  };
}

async function resolveAvailability(fresh) {
  if (!FORCE_ICS) {
    const fromPublic = await serveFromPublicKey(fresh);
    if (fromPublic) return fromPublic;
  }
  return serveFromIcs(fresh);
}

/**
 * Only the pre-sanitized public key. Never open the private `data` blob here.
 */
async function serveFromPublicKey(fresh) {
  try {
    const store = openStore();
    const pub = await store.get(PUBLIC_KEY, {
      type: "json",
      consistency: "strong",
    });
    if (!pub || typeof pub !== "object") return null;

    const booked = sanitizeYmdList(pub.booked);
    const tentative = sanitizeYmdList(pub.tentative);
    const hasDays = booked.length || tentative.length;
    const markedLeads =
      pub.source === "leads" ||
      pub.seededFrom === "leads" ||
      pub.active === true;

    if (!hasDays && !markedLeads) return null;

    return guestPayload(
      {
        booked,
        tentative,
        events: pub.events,
        generatedAt: pub.generatedAt,
        seededAt: pub.seededAt,
        seededFrom: "leads",
        active: true,
        note: "leads SOT · pending = on hold",
      },
      {
        source: "leads",
        note: "leads SOT · pending = on hold",
        fresh,
      }
    );
  } catch (_) {
    /* Blob misconfigured — fall through to ICS, no internal error detail to client */
    return null;
  }
}

async function serveFromIcs(fresh) {
  if (!ICS_URL) {
    return emptyGuest(
      "ics",
      "Calendar feed not configured",
      fresh
    );
  }

  try {
    /* URL from env only — never from query/body (SSRF-safe) */
    const url = ICS_URL.replace(/^webcal:\/\//i, "https://");
    if (!/^https:\/\//i.test(url)) {
      return emptyGuest("ics", "Calendar feed misconfigured", fresh);
    }
    const res = await fetch(url, {
      headers: {
        "User-Agent": "LimitlessYacht/1.0 (+https://limitlessyachtcharter.com)",
        ...(fresh ? { "Cache-Control": "no-cache", Pragma: "no-cache" } : {}),
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error("ics_status");
    const text = await res.text();
    /* Bound ICS size parse work */
    if (text.length > 2_000_000) throw new Error("ics_too_large");
    const parsed = parseIcs(text);
    return guestPayload(
      {
        booked: parsed.booked,
        tentative: parsed.tentative,
        events: parsed.events,
        generatedAt: new Date().toISOString(),
        active: false,
        note: "Fallback ICS",
      },
      {
        source: "ics",
        note: "Fallback ICS (public key empty — open tracker once to publish holds)",
        fresh,
      }
    );
  } catch (_) {
    return emptyGuest("ics", "Calendar temporarily unavailable", fresh);
  }
}

function isGet(reqOrMethod) {
  const m =
    typeof reqOrMethod === "string"
      ? reqOrMethod
      : (reqOrMethod && reqOrMethod.method) || "GET";
  return String(m).toUpperCase() === "GET" || String(m).toUpperCase() === "HEAD";
}

function isOptions(reqOrMethod) {
  const m =
    typeof reqOrMethod === "string"
      ? reqOrMethod
      : (reqOrMethod && reqOrMethod.method) || "";
  return String(m).toUpperCase() === "OPTIONS";
}

/** Netlify Functions 2.0 */
export default async (req) => {
  const headers = cacheHeaders(false);

  if (isOptions(req)) {
    return new Response("", { status: 204, headers });
  }
  if (!isGet(req)) {
    return new Response(JSON.stringify({ error: "method" }), {
      status: 405,
      headers: { ...headers, Allow: "GET, HEAD, OPTIONS" },
    });
  }

  const url = new URL(req.url);
  const fresh =
    url.searchParams.get("fresh") === "1" ||
    url.searchParams.get("fresh") === "true";
  const outHeaders = cacheHeaders(fresh);

  try {
    const body = await resolveAvailability(fresh);
    return new Response(JSON.stringify(body), { status: 200, headers: outHeaders });
  } catch (_) {
    return new Response(
      JSON.stringify(emptyGuest("error", "Calendar temporarily unavailable", fresh)),
      {
        status: 200,
        headers: { ...outHeaders, "Cache-Control": "public, max-age=60" },
      }
    );
  }
};

/** Classic Functions v1 entry */
export async function handler(event) {
  const method = (event && event.httpMethod) || "GET";
  const qs = (event && event.queryStringParameters) || {};
  const fresh = qs.fresh === "1" || qs.fresh === "true";
  const headers = cacheHeaders(fresh);

  if (String(method).toUpperCase() === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (!isGet(method)) {
    return {
      statusCode: 405,
      headers: { ...headers, Allow: "GET, HEAD, OPTIONS" },
      body: JSON.stringify({ error: "method" }),
    };
  }

  try {
    const body = await resolveAvailability(fresh);
    return { statusCode: 200, headers, body: JSON.stringify(body) };
  } catch (_) {
    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=60" },
      body: JSON.stringify(
        emptyGuest("error", "Calendar temporarily unavailable", fresh)
      ),
    };
  }
}

export { parseIcs, expandEvent } from "./lib/ics.mjs";
