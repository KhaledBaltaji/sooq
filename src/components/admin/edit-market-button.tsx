"use client";

import { useState } from "react";
import { EditMarketDialog } from "./edit-market-dialog";

interface EditMarketButtonProps {
  market: {
    id: string;
    question_en: string;
    description_en: string | null;
    description_ar: string | null;
    closes_at: string;
    opens_at: string;
    keywords?: string[];
    image_url?: string | null;
  };
}

export function EditMarketButton({ market }: EditMarketButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-5 py-2.5 bg-[#f0f4f7] text-[#2a3439] font-bold rounded-lg hover:bg-[#e8eff3] transition-all text-sm"
      >
        <span className="material-symbols-outlined text-sm">edit</span>
        Edit Market
      </button>
      <EditMarketDialog open={open} onOpenChange={setOpen} market={market} />
    </>
  );
}
