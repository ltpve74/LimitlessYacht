/**
 * Pure money helpers (TypeScript port of tracker/js/models/util.js).
 * No DOM, no Prisma, no Next.
 */

export function num(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v)
    .trim()
    .replace(/[€\s\u00a0]/g, "");
  if (!s) return 0;
  const lastC = s.lastIndexOf(",");
  const lastD = s.lastIndexOf(".");
  if (lastC > -1 && lastD > -1) {
    if (lastC > lastD) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastC > -1) {
    const after = s.length - lastC - 1;
    if (after <= 2) s = s.replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, "");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Convert euro amount to integer cents (banker's-style half-up via Math.round). */
export function eurosToCents(euros: number): number {
  return Math.round(round2(euros) * 100);
}

export function centsToEuros(cents: number): number {
  return round2((Number(cents) || 0) / 100);
}
