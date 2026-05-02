"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/components/providers/supabase-provider";
import { toast } from "sonner";

interface BranchConfig {
  branchId: string;
  yesMarkup: number;   // decimal e.g. 0.10
  noMarkup: number;
  exitFee: number;
  displayMode: string;
  cashOutEnabled: boolean;
  branchFeeRate: number;
  createdAt: string;
}

export function BranchConfigEditor({ config }: { config: BranchConfig }) {
  return (
    <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <div className="flex items-center gap-2 mb-8">
        <span className="material-symbols-outlined text-[#566166]">settings</span>
        <h4 className="font-bold tracking-tight text-[#566166]">Branch Configuration</h4>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
        <PercentField
          label="YES Markup"
          branchId={config.branchId}
          field="p_yes_markup"
          currentValue={config.yesMarkup}
          min={0} max={50} step={0.1}
        />
        <PercentField
          label="NO Markup"
          branchId={config.branchId}
          field="p_no_markup"
          currentValue={config.noMarkup}
          min={0} max={50} step={0.1}
        />
        <PercentField
          label="Exit Fee"
          branchId={config.branchId}
          field="p_exit_fee"
          currentValue={config.exitFee}
          min={0} max={10} step={0.1}
        />
        <DisplayModeField
          branchId={config.branchId}
          currentValue={config.displayMode}
        />
        <CashOutField
          branchId={config.branchId}
          currentValue={config.cashOutEnabled}
        />
        <div>
          <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">SOOQ Fee Rate</p>
          <p className="text-sm font-bold text-[#2a3439]">{(config.branchFeeRate * 100).toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Created</p>
          <p className="text-sm text-[#2a3439]">
            {new Date(config.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
      </div>
    </div>
  );
}

// --- Inline-editable percent field ---

function PercentField({
  label, branchId, field, currentValue, min, max, step,
}: {
  label: string;
  branchId: string;
  field: string;
  currentValue: number;
  min: number;
  max: number;
  step: number;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = useSupabase() as any;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState((currentValue * 100).toFixed(1));
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    const pct = parseFloat(value);
    if (isNaN(pct) || pct < min || pct > max) {
      toast.error("Invalid value", { description: `Must be between ${min}% and ${max}%` });
      return;
    }
    setLoading(true);
    const { error } = await supabase.rpc("update_branch_config", {
      p_branch_id: branchId,
      [field]: pct / 100,
    });
    if (error) {
      toast.error("Failed to update", { description: error.message });
    } else {
      toast.success(`${label} updated to ${pct.toFixed(1)}%`);
      setEditing(false);
      router.refresh();
    }
    setLoading(false);
  };

  if (!editing) {
    return (
      <div>
        <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">{label}</p>
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-[#2a3439]">{(currentValue * 100).toFixed(1)}%</p>
          <button onClick={() => setEditing(true)} className="text-[10px] text-[#2D8CFF] hover:underline font-bold">Edit</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          min={min} max={max} step={step}
          className="w-20 border border-[#d9e4ea] rounded px-2 py-1 text-sm font-bold focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
          autoFocus
        />
        <span className="text-sm text-[#566166]">%</span>
        <button onClick={handleSave} disabled={loading} className="text-[10px] text-white bg-[var(--yes)] px-2 py-1 rounded font-bold hover:opacity-90 disabled:opacity-40">
          {loading ? "..." : "Save"}
        </button>
        <button onClick={() => { setEditing(false); setValue((currentValue * 100).toFixed(1)); }} className="text-[10px] text-[#566166] hover:underline font-bold">
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- Display mode select ---

function DisplayModeField({ branchId, currentValue }: { branchId: string; currentValue: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = useSupabase() as any;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentValue);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    const { error } = await supabase.rpc("update_branch_config", {
      p_branch_id: branchId,
      p_display_mode: value,
    });
    if (error) {
      toast.error("Failed to update", { description: error.message });
    } else {
      toast.success(`Display mode updated to ${value}`);
      setEditing(false);
      router.refresh();
    }
    setLoading(false);
  };

  if (!editing) {
    return (
      <div>
        <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Display Mode</p>
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-[#2a3439] capitalize">{currentValue}</p>
          <button onClick={() => setEditing(true)} className="text-[10px] text-[#2D8CFF] hover:underline font-bold">Edit</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Display Mode</p>
      <div className="flex items-center gap-2">
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="border border-[#d9e4ea] rounded px-2 py-1 text-sm font-bold focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
          autoFocus
        >
          <option value="betting">Betting</option>
          <option value="trading">Trading</option>
          <option value="hybrid">Hybrid</option>
        </select>
        <button onClick={handleSave} disabled={loading} className="text-[10px] text-white bg-[var(--yes)] px-2 py-1 rounded font-bold hover:opacity-90 disabled:opacity-40">
          {loading ? "..." : "Save"}
        </button>
        <button onClick={() => { setEditing(false); setValue(currentValue); }} className="text-[10px] text-[#566166] hover:underline font-bold">
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- Cash out toggle ---

function CashOutField({ branchId, currentValue }: { branchId: string; currentValue: boolean }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = useSupabase() as any;
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    setLoading(true);
    const { error } = await supabase.rpc("update_branch_config", {
      p_branch_id: branchId,
      p_cash_out_enabled: !currentValue,
    });
    if (error) {
      toast.error("Failed to update", { description: error.message });
    } else {
      toast.success(`Cash out ${!currentValue ? "enabled" : "disabled"}`);
      router.refresh();
    }
    setLoading(false);
  };

  return (
    <div>
      <p className="text-[10px] text-[#566166] uppercase font-bold tracking-widest mb-1">Cash Out</p>
      <div className="flex items-center gap-2">
        <p className={`text-sm font-bold ${currentValue ? "text-emerald-600" : "text-red-600"}`}>
          {currentValue ? "Enabled" : "Disabled"}
        </p>
        <button
          onClick={handleToggle}
          disabled={loading}
          className="text-[10px] text-[#2D8CFF] hover:underline font-bold disabled:opacity-40"
        >
          {loading ? "..." : "Toggle"}
        </button>
      </div>
    </div>
  );
}
