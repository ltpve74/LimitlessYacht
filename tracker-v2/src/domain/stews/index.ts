/** Stews domain — roster status port from tracker/js/models/stews.js */
export type RosterStatus = "assigned" | "unassigned" | "cancelled";

export function rosterStatus(input: {
  cancelled?: boolean;
  crewCount?: number;
}): RosterStatus {
  if (input.cancelled) return "cancelled";
  if ((input.crewCount || 0) > 0) return "assigned";
  return "unassigned";
}
