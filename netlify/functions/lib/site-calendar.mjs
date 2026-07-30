/**
 * Public site calendar from commercial leads (source of truth).
 * Pending source → tentative/on-hold; firm sources → booked; cancelled omitted.
 */
import { expandRange } from "./ics.mjs";
import { constrainLeadSource } from "./leads-import.mjs";

function addUtcDayYmd(ymd, n) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + (n || 0)));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return yy + "-" + mm + "-" + dd;
}

export function leadIsCancelledForSite(l) {
  if (!l) return true;
  if (l.bookingStatus === "cancelled" || l.cancelled === true) return true;
  if (l.status === "Cancelled" || l.status === "cancelled") return true;
  if (String(l.deps || "") === "Refunded") return true;
  return false;
}

export function leadBlockedDays(l) {
  if (!l) return [];
  const start = String(l.start || l.cdate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  const end = String(l.end || "").slice(0, 10);
  const multi = l.dur === "multi" || (end && end > start);
  const nDays = Math.max(1, Math.round(Number(l.days) || 0) || 1);
  if (multi && nDays > 1) {
    const out = [];
    for (let i = 0; i < nDays && i < 60; i++) out.push(addUtcDayYmd(start, i));
    return out;
  }
  if (multi && end && end > start) {
    return expandRange(start, addUtcDayYmd(end, 1), true);
  }
  return [start];
}

/** True when lead is awaiting captain source assignment → site on-hold. */
export function leadIsOnHold(l) {
  if (!l) return false;
  const src = constrainLeadSource(l.leadSource);
  if (src === "pending") return true;
  if (l.sourcePending === true || l.sourcePending === "true" || l.sourcePending === 1)
    return true;
  return false;
}

/**
 * @returns {{ booked: string[], tentative: string[], events: object[], active: true, seededFrom: 'leads', ... }}
 */
export function buildSiteCalendarFromLeads(leads, who, now) {
  const list = Array.isArray(leads) ? leads : [];
  const booked = new Set();
  const tentative = new Set();
  const events = [];
  const ts = now || new Date().toISOString();

  list.forEach((l) => {
    if (!l || !l.id || leadIsCancelledForSite(l)) return;
    const days = leadBlockedDays(l);
    if (!days.length) return;

    const src = constrainLeadSource(l.leadSource);
    const onHold = leadIsOnHold(l);
    const status = onHold ? "tentative" : "booked";
    const target = onHold ? tentative : booked;
    days.forEach((d) => target.add(d));

    const start = days[0];
    const end = days[days.length - 1];
    const endExclusive = addUtcDayYmd(end, 1);
    events.push({
      key: l.calendarEventKey || "lead:" + l.id,
      uid: l.calendarUid || l.id,
      summary: l.name || "Charter",
      start: start,
      end: days.length > 1 ? endExclusive : start,
      startTime: "",
      endTime: "",
      allDay: true,
      status: status,
      days: days.slice(),
      leadId: l.id,
      leadSource: src,
    });
  });

  /* Firm booked wins over hold if both (shouldn't for same lead) */
  booked.forEach((d) => tentative.delete(d));

  return {
    active: true,
    booked: [...booked].sort(),
    tentative: [...tentative].sort(),
    events: events.sort((a, b) => String(a.start).localeCompare(String(b.start))),
    generatedAt: ts,
    seededAt: ts,
    seededFrom: "leads",
    updatedAt: ts,
    updatedBy: who || "system",
    note: "From leads · pending source = on hold · firm = booked",
  };
}
