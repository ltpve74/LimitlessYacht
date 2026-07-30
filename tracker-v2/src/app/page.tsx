import { commissionRatePct } from "@/domain/leads";
import { summarizePettyFromEvents } from "@/domain/cash-ledger";
import { resolvePaidFrom } from "@/domain/expenses";

/**
 * Scaffold landing — architecture check only.
 * Live Limitless ops remain at /tracker (v1).
 */
export default function HomePage() {
  const demoPetty = summarizePettyFromEvents(5000, [
    { kind: "CASH_OUT", envelope: "PETTY", amountCents: 5000, sourceType: "crew_day_pay", memo: "Toni partial" },
  ]);
  const pocket = resolvePaidFrom({ paidFrom: "Own money", paidById: "captain" });

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Tracker v2 · scaffold</p>
      <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Yacht Ops</h1>
      <p className="mt-3 text-slate-600 leading-relaxed">
        Commercial multi-vessel charter ops platform. This app is <strong>parallel</strong> to the live
        Limitless prototype at <code className="rounded bg-slate-200 px-1">/tracker</code> — that tool
        stays as-is for daily business.
      </p>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Architecture</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          <li>
            Stack: <strong>Next.js + TypeScript + Neon Postgres + Prisma</strong>
          </li>
          <li>
            Docs: <code className="rounded bg-slate-100 px-1">docs/ARCHITECTURE.md</code>
          </li>
          <li>
            Domain modules under <code className="rounded bg-slate-100 px-1">src/domain/*</code> (no UI money
            math)
          </li>
        </ul>
      </section>

      <section className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-emerald-900">Domain smoke</h2>
        <p className="mt-2 text-sm text-emerald-900/90">
          Captain commission rate: <strong>{commissionRatePct("CAPTAIN")}%</strong>
        </p>
        <p className="mt-1 text-sm text-emerald-900/90">
          Own-money classify: <strong>{pocket}</strong> (must never hit petty)
        </p>
        <p className="mt-1 text-sm text-emerald-900/90">
          Demo petty after €50 crew pay from €50 start:{" "}
          <strong>€{(demoPetty.pettyCents / 100).toFixed(2)}</strong>
        </p>
      </section>

      <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-amber-900">Your next step</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-amber-950">
          <li>
            Create a <strong>Neon</strong> Postgres project
          </li>
          <li>
            Copy URL into <code className="rounded bg-amber-100/80 px-1">tracker-v2/.env</code> as{" "}
            <code className="rounded bg-amber-100/80 px-1">DATABASE_URL</code>
          </li>
          <li>
            Run <code className="rounded bg-amber-100/80 px-1">npx prisma db push</code>
          </li>
        </ol>
      </section>
    </main>
  );
}
