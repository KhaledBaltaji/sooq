// Speed operations landing page.
//
// Phase 5J cleanup: replaced the W7 placeholder (which referenced a
// "W10 lean ops rebuild" that already shipped) with a current map of
// the speed-mode admin surfaces. Live counts on top, link grid below.

import Link from "next/link";
import { Zap, ArrowRight } from "lucide-react";
import { sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { speedMarkets, speedPositions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function SpeedOperationsPage() {
  const [openMarketsRow, openPositionsRow, openStakeRow] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(speedMarkets)
      .where(eq(speedMarkets.status, "open")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(speedPositions)
      .where(eq(speedPositions.status, "open")),
    db
      .select({ total: sql<string>`COALESCE(SUM(stake), 0)::text` })
      .from(speedPositions)
      .where(eq(speedPositions.status, "open")),
  ]);

  const openMarkets = openMarketsRow[0]?.count ?? 0;
  const openPositions = openPositionsRow[0]?.count ?? 0;
  const openStake = Number(openStakeRow[0]?.total ?? 0);

  return (
    <div className="flex-1 p-8 space-y-8 max-w-[1400px]">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-[#FFB800]" />
          <h1 className="text-3xl font-extrabold text-[#2a3439]">
            Speed Operations
          </h1>
        </div>
        <p className="text-sm text-[#566166] max-w-2xl">
          Live counts plus quick links to every speed-mode admin surface.
          For trends, P&amp;L, and health telemetry use Stats. For per-market
          knobs use Markets Config. For per-user CLV throttle use Sharks.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Open markets" value={openMarkets} />
        <Stat label="Open positions" value={openPositions} />
        <Stat
          label="Open stake (cash pool)"
          value={`$${openStake.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`}
        />
      </div>

      <section className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.02)] p-6 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[#566166]">
          Speed admin surfaces
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SurfaceLink
            href="/admin/stats?tab=revenue"
            icon="trending_up"
            title="Stats — Revenue"
            hint="Stakes, payouts, per-market P&L, NGR breaker, 14-day sparkline"
          />
          <SurfaceLink
            href="/admin/stats?tab=health"
            icon="monitor_heart"
            title="Stats — Health"
            hint="Oracle freshness, matrix coverage, CLV cron, pricing telemetry"
          />
          <SurfaceLink
            href="/admin/markets-config"
            icon="tune"
            title="Markets Config"
            hint="Per-(asset, duration) stake & payout bounds. Advanced statistical knobs collapsed."
          />
          <SurfaceLink
            href="/admin/sharks"
            icon="gpp_maybe"
            title="Sharks (CLV)"
            hint="Per-user closing-line-value throttle. Top 50 by edge score."
          />
          <SurfaceLink
            href="/admin/fees"
            icon="payments"
            title="Fees"
            hint="Kill switches, risk caps, NGR breaker, master flags. Internal knobs in Advanced."
          />
          <SurfaceLink
            href="/admin/money"
            icon="account_balance_wallet"
            title="Money"
            hint="Withdrawals queue, deposits, manual balance adjustments"
          />
        </div>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-5 text-sm text-amber-900">
        <p className="font-bold mb-1">Operator quick reference</p>
        <ul className="space-y-1 text-xs leading-relaxed">
          <li>
            • <strong>Pause trading:</strong> /admin/fees → Kill Switches → flip{" "}
            <code>speed_markets_enabled</code> to OFF
          </li>
          <li>
            • <strong>Pause cashouts only:</strong> /admin/fees → Kill Switches →
            flip <code>speed_cashout_enabled</code> to OFF
          </li>
          <li>
            • <strong>Tune a market&apos;s stake max:</strong> /admin/markets-config
            → pick the (asset, duration) tab → edit Stake max
          </li>
          <li>
            • <strong>Override a shark&apos;s shading:</strong> see{" "}
            <code>docs/CONFIG_HIDDEN.md</code> → Sharks section (proper override
            UI ships in a follow-up)
          </li>
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.02)] p-5">
      <p className="text-[10px] uppercase tracking-widest text-[#566166] font-bold mb-2">
        {label}
      </p>
      <p className="text-3xl font-extrabold tabular-nums text-[#2a3439]">
        {value}
      </p>
    </div>
  );
}

function SurfaceLink({
  href,
  icon,
  title,
  hint,
}: {
  href: string;
  icon: string;
  title: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-lg border border-[#e9ecef] p-4 hover:bg-[#fafbfc] transition-colors group"
    >
      <div className="w-9 h-9 rounded-md bg-[#dae2fd] text-[#4a5167] flex items-center justify-center shrink-0">
        <span className="material-symbols-outlined text-base">{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-[#2a3439] group-hover:text-[#2d6cdf]">
          {title}
        </p>
        <p className="text-xs text-[#566166] mt-0.5">{hint}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-[#a9b4b9] group-hover:text-[#2d6cdf] mt-1 shrink-0" />
    </Link>
  );
}
