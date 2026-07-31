/** Tenancy — organisation / vessel / roles */
export type RoleV2 = "OWNER" | "CAPTAIN" | "MANAGER" | "STEWARD" | "VIEWER";

export const ROLE_RANK: Record<RoleV2, number> = {
  VIEWER: 1,
  STEWARD: 2,
  MANAGER: 3,
  CAPTAIN: 4,
  OWNER: 5,
};

export function roleAtLeast(have: RoleV2, need: RoleV2): boolean {
  return ROLE_RANK[have] >= ROLE_RANK[need];
}
