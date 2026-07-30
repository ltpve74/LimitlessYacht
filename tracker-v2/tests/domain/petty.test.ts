import { describe, expect, it } from "vitest";
import { summarizePettyFromEvents } from "@/domain/cash-ledger";
import { resolvePaidFrom } from "@/domain/expenses";
import { eurosToCents } from "@/domain/util/money";

describe("petty from ledger events", () => {
  it("Toni €50 from €50 start → petty 0", () => {
    const s = summarizePettyFromEvents(eurosToCents(50), [
      {
        kind: "CASH_OUT",
        envelope: "PETTY",
        amountCents: eurosToCents(50),
        sourceType: "crew_day_pay",
      },
    ]);
    expect(s.pettyCents).toBe(0);
    expect(s.cashOutCents).toBe(5000);
  });

  it("own pocket spends never touch petty", () => {
    expect(resolvePaidFrom({ paidFrom: "Own money", paidById: "captain" })).toBe("own");
    expect(resolvePaidFrom({ paidFrom: "", paidById: "captain" })).toBe("own");
    const s = summarizePettyFromEvents(eurosToCents(50), [
      {
        kind: "CASH_OUT",
        envelope: "OWN_POCKET",
        amountCents: eurosToCents(250),
        sourceType: "expense",
      },
      {
        kind: "CASH_OUT",
        envelope: "PETTY",
        amountCents: eurosToCents(50),
        sourceType: "crew_day_pay",
      },
    ]);
    expect(s.cashOutCents).toBe(5000);
    expect(s.pettyCents).toBe(0);
  });
});
