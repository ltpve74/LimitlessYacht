// Receipt photo read for the tracker.
// Endpoint: /.netlify/functions/tracker-receipt
// Auth: same passcode header as the tracker (x-tracker-pass). Captain and manager only.
// Env: TRACKER_PASSCODE (required), XAI_API_KEY (required to read a photo).
// Suggests shop, date, and total. Does not write the ledger.

import { readReceiptImage } from "./lib/receipt-read.mjs";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Keep in step with passOk in tracker.mjs. */
function passOk(pass, role) {
  const captain = process.env.TRACKER_PASSCODE || "";
  if (!captain) return false;
  const manager = process.env.TRACKER_MANAGER_PASSCODE || captain;
  const team = process.env.TRACKER_TEAM_PASSCODE || captain;
  if (role === "captain") return pass === captain;
  if (role === "manager") return pass === manager;
  if (role === "team") return pass === team;
  return pass === captain;
}

function roleOf(who, bodyRole) {
  const r = String(bodyRole || "")
    .toLowerCase()
    .trim();
  if (r === "captain" || r === "manager" || r === "team") return r;
  const w = String(who || "");
  if (/^manager\b/i.test(w)) return "manager";
  if (/^team\b/i.test(w)) return "team";
  return "captain";
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!process.env.TRACKER_PASSCODE) {
    return json({ error: "Server not configured" }, 500);
  }
  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "bad json" }, 400);
  }
  const role = roleOf(body && body.who, body && body.role);
  const pass = req.headers.get("x-tracker-pass") || "";
  if (!passOk(pass, role)) return json({ error: "unauthorized" }, 401);
  if (role !== "captain" && role !== "manager") {
    return json({ error: "Receipt reading is for the captain" }, 403);
  }
  try {
    const read = await readReceiptImage({
      image: body && body.image,
      images: body && body.images,
      apiKey: process.env.XAI_API_KEY || "",
      today: new Date().toISOString().slice(0, 10),
    });
    return json(read);
  } catch (err) {
    const status = err && err.status ? err.status : 502;
    const error = err && err.message ? err.message : "Could not read the receipt";
    return json({ error: error }, status);
  }
};
