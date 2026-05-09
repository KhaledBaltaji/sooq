// RDS isn't reachable from Vercel's build pool — render per-request.
export const dynamic = "force-dynamic";

import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { feeConfig } from "@/lib/db/schema";
import { FeeConfigEditor } from "@/components/admin/fee-config-editor";

export default async function AdminFeesPage() {
  const fees = await db.select().from(feeConfig).orderBy(asc(feeConfig.feeType));

  // FeeConfigEditor expects snake_case + numeric rates as numbers/strings.
  // We pass through Drizzle column names (camelCase) but ARM the editor to
  // accept either — for now, transform to the legacy shape.
  const legacyShape = fees.map((f) => ({
    fee_type: f.feeType,
    rate: f.rate,
    description: f.description,
    updated_at: f.updatedAt?.toISOString() ?? null,
    updated_by: f.updatedBy,
  }));

  return (
    <div className="p-8 space-y-8">
      <div>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Fee Configuration
        </h2>
        <p className="text-[#566166] mt-2">
          Platform fees and speed-mode runtime knobs. All rates are read from the database.
        </p>
      </div>

      {/* Phase 2C banner — alert admin that several keys are now per-market */}
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-600 text-xl">info</span>
          <div className="text-sm text-amber-900">
            <p className="font-semibold">Some keys moved to per-(asset, duration) config (mig 0049–0051).</p>
            <p className="mt-1">
              Spread, soft-block, late-window multipliers, reject windows, payout caps,
              cashout coefficients, stake max, and per-side pool % are now read from{" "}
              <code className="px-1 py-0.5 bg-amber-100 rounded">speed_market_config</code>{" "}
              per (asset, duration). Edits to the corresponding keys below are
              effectively dead for BTC-5m, BTC-1m, and GOLD-5m. A dedicated{" "}
              <code className="px-1 py-0.5 bg-amber-100 rounded">/admin/markets-config</code>{" "}
              page is on the UX-redesign roadmap. Until then, edit those values
              directly via SQL or wait for the new admin UI.
            </p>
            <p className="mt-1 text-xs text-amber-700">
              Affected keys are tagged below with ⚠ <em>Per-market</em>.
            </p>
          </div>
        </div>
      </div>

      <FeeConfigEditor fees={legacyShape as never[]} />
    </div>
  );
}
