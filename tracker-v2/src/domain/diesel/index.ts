/** Diesel domain — port from tracker/js/models/diesel.js. Read-only rate lookups for APA. */
export const DIESEL_MARKUP = 0.1;

export function suggestedGuestSell(buyPrice: number, markup = DIESEL_MARKUP): number {
  const b = Number(buyPrice) || 0;
  if (!(b > 0)) return 0;
  return Math.round((b + markup) * 100) / 100;
}
