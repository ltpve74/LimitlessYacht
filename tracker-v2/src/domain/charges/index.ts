/** Charges domain — port from tracker/js/models/charges.js */
export type BillTypeV2 = "CASH" | "INVOICE" | "MIX";

export function constrainBillType(v: unknown): BillTypeV2 {
  const s = String(v || "")
    .toLowerCase()
    .trim();
  if (s === "cash") return "CASH";
  if (s === "mix") return "MIX";
  return "INVOICE";
}
