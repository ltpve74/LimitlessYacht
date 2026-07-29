#!/usr/bin/env node
/**
 * ICS parse + site-calendar payload tests.
 * Run: node scripts/test-ics.mjs
 */
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const icsPath = join(root, "netlify/functions/lib/ics.mjs");
const { parseIcs, expandEvent, siteCalendarPublicPayload } = await import(
  pathToFileURL(icsPath).href
);

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log("  ✓  " + name);
  else {
    failed++;
    console.log("  ✗  " + name + (detail ? " — " + detail : ""));
  }
}

console.log("[ICS parse]");
{
  const sample = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:trip-a@test",
    "DTSTART;VALUE=DATE:20260710",
    "DTEND;VALUE=DATE:20260711",
    "SUMMARY:Oliver charter",
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:hold-b@test",
    "DTSTART;VALUE=DATE:20260715",
    "DTEND;VALUE=DATE:20260716",
    "SUMMARY:Hold — guest pending",
    "STATUS:TENTATIVE",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:gone@test",
    "DTSTART;VALUE=DATE:20260701",
    "DTEND;VALUE=DATE:20260702",
    "SUMMARY:Cancelled trip",
    "STATUS:CANCELLED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n");
  const p = parseIcs(sample);
  ok("booked includes Oliver day", p.booked.indexOf("2026-07-10") >= 0, JSON.stringify(p.booked));
  ok("tentative includes hold day", p.tentative.indexOf("2026-07-15") >= 0);
  ok("cancelled event omitted from events", !p.events.some((e) => e.uid === "gone@test"));
  ok("two live events", p.events.length === 2, "got " + p.events.length);
  ok("event key uses uid", p.events[0].key === "uid:trip-a@test" || p.events.some((e) => e.key === "uid:trip-a@test"));
  ok("hold status tentative", p.events.some((e) => e.status === "tentative" && /hold/i.test(e.summary)));
}

console.log("[expandEvent multi-day]");
{
  const days = expandEvent({
    start: "2026-07-17",
    end: "2026-07-20",
    allDay: true,
  });
  ok("all-day exclusive end → 3 days", days.length === 3, "got " + days.length + " " + days.join(","));
  ok("includes 17", days.indexOf("2026-07-17") >= 0);
  ok("includes 19", days.indexOf("2026-07-19") >= 0);
  ok("excludes 20", days.indexOf("2026-07-20") < 0);
}

console.log("[siteCalendarPublicPayload]");
{
  const empty = siteCalendarPublicPayload(null);
  ok("empty has arrays", Array.isArray(empty.booked) && Array.isArray(empty.events));
  ok("empty source blob", empty.source === "blob");
  const live = siteCalendarPublicPayload({
    active: true,
    booked: ["2026-08-01"],
    tentative: [],
    events: [{ key: "uid:x", summary: "X", start: "2026-08-01" }],
    seededAt: "2026-07-30T00:00:00.000Z",
  });
  ok("active flag", live.active === true);
  ok("booked copied", live.booked[0] === "2026-08-01");
  ok("seededAt kept", live.seededAt === "2026-07-30T00:00:00.000Z");
}

if (failed) {
  console.log("\nFAILED " + failed + " check(s)");
  process.exit(1);
}
console.log("\nPASSED  ICS / site-calendar helpers");
process.exit(0);
