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

      <FeeConfigEditor fees={legacyShape as never[]} />
    </div>
  );
}
