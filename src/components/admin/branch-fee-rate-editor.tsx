"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/components/providers/supabase-provider";
import { toast } from "sonner";

interface Props {
  branchId: string;
  currentRate: number; // decimal, e.g. 0.05 for 5%
}

export function BranchFeeRateEditor({ branchId, currentRate }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = useSupabase() as any;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState((currentRate * 100).toFixed(1));
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    const pct = parseFloat(value);
    if (isNaN(pct) || pct < 0 || pct > 20) {
      toast.error("Invalid rate", { description: "Must be between 0% and 20%" });
      return;
    }
    setLoading(true);
    const { error } = await supabase
      .from("branches")
      .update({ branch_fee_rate: pct / 100 })
      .eq("id", branchId);

    if (error) {
      toast.error("Failed to update fee rate", { description: error.message });
    } else {
      toast.success(`SOOQ fee rate updated to ${pct.toFixed(1)}%`);
      setEditing(false);
      router.refresh();
    }
    setLoading(false);
  };

  if (!editing) {
    return (
      <div>
        <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">SOOQ Fee Rate</p>
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-[#2a3439]">{(currentRate * 100).toFixed(1)}%</p>
          <button
            onClick={() => setEditing(true)}
            className="text-[10px] text-[#2D8CFF] hover:underline font-bold"
          >
            Edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">SOOQ Fee Rate</p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          min={0}
          max={20}
          step={0.1}
          className="w-20 border border-[#d9e4ea] rounded px-2 py-1 text-sm font-bold focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
          autoFocus
        />
        <span className="text-sm text-[#566166]">%</span>
        <button
          onClick={handleSave}
          disabled={loading}
          className="text-[10px] text-white bg-[var(--yes)] px-2 py-1 rounded font-bold hover:opacity-90 disabled:opacity-40"
        >
          {loading ? "..." : "Save"}
        </button>
        <button
          onClick={() => { setEditing(false); setValue((currentRate * 100).toFixed(1)); }}
          className="text-[10px] text-[#566166] hover:underline font-bold"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
