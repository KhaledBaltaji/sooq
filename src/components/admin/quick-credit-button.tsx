"use client";

import { useState } from "react";
import { AdminCreditModal } from "./admin-credit-modal";

interface QuickCreditButtonProps {
  user: {
    id: string;
    display_name: string | null;
    phone: string | null;
    balance_usd: number;
  };
}

export function QuickCreditButton({ user }: QuickCreditButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 transition-all text-sm"
      >
        <span className="material-symbols-outlined text-sm">account_balance_wallet</span>
        Credit / Debit
      </button>
      <AdminCreditModal open={open} onOpenChange={setOpen} prefillUser={user} />
    </>
  );
}
