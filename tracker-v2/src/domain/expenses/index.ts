/**
 * Expenses domain facade — pocket vs petty classification.
 * Full port of tracker/js/models/expenses.js happens here (not in React).
 */

export type PaidFrom = "petty" | "own" | "card";

export function paidFromLooksOwn(label: string | null | undefined): boolean {
  const p = String(label || "").trim();
  if (!p) return false;
  if (/^petty\b/i.test(p) || p === "Petty cash") return false;
  if (p === "Own money" || /^own money\b/i.test(p) || /\bown money\b/i.test(p)) return true;
  if (/^(my|captain'?s?|capt\.?)\s+(money|pocket|personal)/i.test(p)) return true;
  if (/^captain\b/i.test(p) || /^capt\.?\b/i.test(p)) return true;
  if (/^personal\b/i.test(p) || /^from me\b/i.test(p)) return true;
  if (/\bpocket\b/i.test(p) && !/\bpetty\b/i.test(p)) return true;
  return false;
}

/** Captain pocket / paidById never hits petty envelope. */
export function resolvePaidFrom(input: {
  payMethod?: string | null;
  paidFrom?: string | null;
  paidById?: string | null;
}): PaidFrom {
  if (String(input.payMethod || "") === "Credit Card") return "card";
  if (paidFromLooksOwn(input.paidFrom || "")) return "own";
  if (/^petty\b/i.test(String(input.paidFrom || "")) || input.paidFrom === "Petty cash")
    return "petty";
  if (input.paidById != null && String(input.paidById) !== "") return "own";
  return "petty";
}
