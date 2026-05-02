"use client";

import { useState } from "react";
import { AdminCreditModal } from "./admin-credit-modal";

export function FinanceCreditButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-5 py-2.5 bg-[var(--yes)] text-white font-bold rounded-lg hover:opacity-90 transition-all text-sm shadow-sm"
      >
        <span className="material-symbols-outlined text-sm">account_balance_wallet</span>
        Credit / Debit
      </button>
      <AdminCreditModal open={open} onOpenChange={setOpen} />
    </>
  );
}
