// W7 cleanup: original 561-LOC speed admin overview leaned on
// `speed_admin_overview` (and a few branch-aware sub-RPCs) that depended
// on tables stripped in W2/W3 — branches, agent levels, pool ledger, RV
// cache. Rather than stub-port a half-broken version, this page is
// minimised to a placeholder until the W10 "lean ops rebuild" phase
// adds back the slim equivalent against the new Drizzle schema.

import Link from "next/link";
import { Zap, ArrowRight } from "lucide-react";
import { sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { speedMarkets, speedPositions } from "@/lib/db/schema";

// Force per-request render — admin landing pages always pull fresh counts
// and we don't want SSG dragging the RDS-unreachable build pool in.
export const dynamic = "force-dynamic";

export default async function SpeedOperationsPage() {
  const [openMarketsRow, openPositionsRow] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(speedMarkets)
      .where(eq(speedMarkets.status, "open")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(speedPositions)
      .where(eq(speedPositions.status, "open")),
  ]);

  const openMarkets = openMarketsRow[0]?.count ?? 0;
  const openPositions = openPositionsRow[0]?.count ?? 0;

  return (
    <div className="flex-1 p-8 space-y-8 max-w-[1400px]">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-destructive" />
          <h1 className="text-3xl font-extrabold">Speed Operations</h1>
        </div>
        <p className="text-sm text-muted-custom">
          Live counts only for now. Per-asset / per-duration breakdowns,
          revenue, kill switches, and RV monitoring rebuild in the
          W10 lean-ops phase against the slim Sooq schema.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Open markets" value={openMarkets} />
        <Stat label="Open positions" value={openPositions} />
        <Stat label="Master switch" value="see fee_config.speed_markets_enabled" muted />
      </div>

      <section className="rounded-xl border border-border-custom p-6 space-y-4">
        <h2 className="font-semibold">Operating tools</h2>
        <ul className="space-y-2 text-sm text-muted-custom">
          <li>
            <Link
              href="/admin/fees"
              className="inline-flex items-center gap-1 text-yes hover:underline"
            >
              Fee config <ArrowRight className="h-4 w-4" />
            </Link>
            <span className="ms-2">— toggle <code>speed_markets_enabled</code> + tune <code>speed_oracle_stale_seconds</code></span>
          </li>
          <li>
            <Link
              href="/admin/users"
              className="inline-flex items-center gap-1 text-yes hover:underline"
            >
              Users <ArrowRight className="h-4 w-4" />
            </Link>
            <span className="ms-2">— freeze accounts, adjust balance</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  muted,
}: {
  label: string;
  value: string | number;
  muted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border-custom p-4">
      <p className="text-xs uppercase tracking-wider text-muted-custom mb-1">
        {label}
      </p>
      <p
        className={
          muted
            ? "text-sm text-muted-custom"
            : "text-3xl font-extrabold tabular-nums"
        }
      >
        {value}
      </p>
    </div>
  );
}
