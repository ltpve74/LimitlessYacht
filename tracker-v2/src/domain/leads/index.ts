/**
 * Leads domain — port commission / free-cash rules from
 * ../tracker/js/models/leads.js here as TypeScript.
 * Controllers call these services; React must not reimplement them.
 */

export const CAPTAIN_COMMISSION_PCT = 15;
export const CLICKBOAT_COMMISSION_PCT = 21;
export const OWNER_SOURCED_COMMISSION_PCT = 0;

export type LeadSourceV2 =
  | "PENDING"
  | "CAPTAIN"
  | "CLICKBOAT"
  | "OWNER_DAYS"
  | "OWNER_SOURCED"
  | "OTHER";

export function commissionRatePct(source: LeadSourceV2): number {
  if (source === "CAPTAIN") return CAPTAIN_COMMISSION_PCT;
  if (source === "CLICKBOAT") return CLICKBOAT_COMMISSION_PCT;
  if (source === "OWNER_SOURCED") return OWNER_SOURCED_COMMISSION_PCT;
  return 0;
}
