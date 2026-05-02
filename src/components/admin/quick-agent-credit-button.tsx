"use client";

import { useState } from "react";
import { AdminAgentCreditModal } from "./admin-agent-credit-modal";

interface QuickAgentCreditButtonProps {
  user: {
    id: string;
    display_name: string | null;
    phone: string | null;
    agent_balance_usd: number;
  };
}

/**
 * Sibling of QuickCreditButton but targets the commission wallet
 * (users.agent_balance_usd) via admin_adjust_agent_balance RPC (mig 298).
 *
 * Shown on /admin/users/[id] next to the portfolio credit button.
 * Used for commission bug recovery, comp'ed commissions, or disputes.
 */
export function QuickAgentCreditButton({ user }: QuickAgentCreditButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-all text-sm"
        title="Adjust commission wallet (separate from trading balance)"
      >
        <span className="material-symbols-outlined text-sm">payments</span>
        Agent Wallet
      </button>
      <AdminAgentCreditModal open={open} onOpenChange={setOpen} user={user} />
    </>
  );
}
