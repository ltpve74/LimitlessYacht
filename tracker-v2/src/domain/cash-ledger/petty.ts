/**
 * Pure petty cash on board — commercial ledger rules.
 * Port of summarizePettyCash spirit from v1 expenses model, using explicit events.
 *
 * pettyCents = startCents + Σ cash_in(petty) − Σ cash_out(petty)
 * Own-pocket events never enter this formula.
 */

export type LedgerEnvelope = "PETTY" | "OWN_POCKET" | "CARD" | "OWNER_POCKET";
export type LedgerKind = "CASH_IN" | "CASH_OUT" | "ADJUSTMENT";

export type LedgerEventLike = {
  kind: LedgerKind;
  envelope: LedgerEnvelope;
  /** Always positive magnitude; kind decides direction */
  amountCents: number;
  occurredAt?: string | Date;
  sourceType?: string;
  sourceId?: string | null;
  memo?: string | null;
};

export type PettySummary = {
  startCents: number;
  cashInCents: number;
  cashOutCents: number;
  pettyCents: number;
  lines: Array<{
    kind: LedgerKind;
    amountCents: number;
    signedCents: number;
    sourceType?: string;
    sourceId?: string | null;
    memo?: string | null;
    occurredAt?: string;
  }>;
};

export function summarizePettyFromEvents(
  startCents: number,
  events: LedgerEventLike[]
): PettySummary {
  let cashInCents = 0;
  let cashOutCents = 0;
  const lines: PettySummary["lines"] = [];

  for (const e of events || []) {
    if (!e || e.envelope !== "PETTY") continue;
    const mag = Math.abs(Math.round(Number(e.amountCents) || 0));
    if (!(mag > 0)) continue;
    if (e.kind === "CASH_IN") {
      cashInCents += mag;
      lines.push({
        kind: e.kind,
        amountCents: mag,
        signedCents: mag,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        memo: e.memo,
        occurredAt: e.occurredAt != null ? String(e.occurredAt) : undefined,
      });
    } else if (e.kind === "CASH_OUT") {
      cashOutCents += mag;
      lines.push({
        kind: e.kind,
        amountCents: mag,
        signedCents: -mag,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        memo: e.memo,
        occurredAt: e.occurredAt != null ? String(e.occurredAt) : undefined,
      });
    } else if (e.kind === "ADJUSTMENT") {
      // Positive adjustment increases petty; negative decreases
      const signed = Math.round(Number(e.amountCents) || 0);
      if (signed >= 0) cashInCents += signed;
      else cashOutCents += -signed;
      lines.push({
        kind: e.kind,
        amountCents: Math.abs(signed),
        signedCents: signed,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        memo: e.memo,
        occurredAt: e.occurredAt != null ? String(e.occurredAt) : undefined,
      });
    }
  }

  const start = Math.round(Number(startCents) || 0);
  return {
    startCents: start,
    cashInCents,
    cashOutCents,
    pettyCents: start + cashInCents - cashOutCents,
    lines,
  };
}
