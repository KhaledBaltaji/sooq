// Admin money operations.
// Four tabs: Deposits / Withdrawal requests / Manual adjust / History.
// Server shell + auth gate; the live work happens in MoneyClient.

export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth/guards";
import { MoneyClient } from "@/components/admin/money-client";

export default async function AdminMoneyPage() {
  await requireAdmin();
  return (
    <div className="p-8 space-y-6">
      <header>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Money
        </h2>
        <p className="text-[#566166] mt-2 max-w-2xl">
          Deposits, withdrawal requests, manual adjustments, and the full
          ledger of every money movement on the platform.
        </p>
      </header>
      <MoneyClient />
    </div>
  );
}
