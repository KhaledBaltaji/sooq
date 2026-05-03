// Admin withdrawals queue.
// Server-rendered shell with the auth gate; the actual list is a client
// component (WithdrawalsClient) so admins can switch tabs + click
// approve/reject/mark-sent without page reloads.

export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth/guards";
import { WithdrawalsClient } from "@/components/admin/withdrawals-client";

export default async function AdminWithdrawalsPage() {
  await requireAdmin();
  return (
    <div className="p-8 space-y-6">
      <header>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Withdrawals
        </h2>
        <p className="text-[#566166] mt-2 max-w-2xl">
          Review user withdrawal requests. Approving leaves the funds held;
          you mark it <strong>Sent</strong> after the actual transfer is
          processed (and paste the external reference). Rejecting refunds
          the held debit immediately.
        </p>
      </header>
      <WithdrawalsClient />
    </div>
  );
}
