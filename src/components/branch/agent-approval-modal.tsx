"use client";

import { useState, useEffect } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { toast } from "sonner";
import { X, TrendingUp, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface AgentApprovalModalProps {
  agentId: string;
  agentName: string;
  /**
   * Optional — when provided, the P/L type selection triggers a
   * `preview_branch_agent_pl` RPC call to project monthly earnings.
   * Callers from PR 3 should pass this. Backwards-compatible if omitted.
   */
  branchId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface PLPreview {
  proposed_rate: number;
  last_30d_net_pool_flow: number;
  projected_monthly_payout: number;
  basis: string;
}

export function AgentApprovalModal({
  agentId,
  agentName,
  branchId,
  onClose,
  onSuccess,
}: AgentApprovalModalProps) {
  const supabase = useSupabase();
  const [agentType, setAgentType] = useState<"pl" | "commission">("commission");
  const [rateInput, setRateInput] = useState("10");
  const [depositInput, setDepositInput] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<PLPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // PR 3: fetch P/L projection when type=pl + valid rate + branchId provided.
  useEffect(() => {
    if (agentType !== "pl" || !branchId) {
      setPreview(null);
      return;
    }
    const rateNum = parseFloat(rateInput) / 100;
    if (isNaN(rateNum) || rateNum <= 0 || rateNum > 1) {
      setPreview(null);
      return;
    }

    const handle = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc(
          "preview_branch_agent_pl",
          { p_branch_id: branchId, p_rate: rateNum }
        );
        if (!error && data) {
          setPreview(data as PLPreview);
        }
      } finally {
        setPreviewLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [agentType, rateInput, branchId, supabase]);

  const handleSubmit = async () => {
    const rateNum = parseFloat(rateInput) / 100; // Convert display % to decimal
    const depositNum = parseFloat(depositInput);
    if (isNaN(rateNum) || isNaN(depositNum)) {
      toast.error("Please enter valid numbers for rate and deposit");
      return;
    }
    if (rateNum <= 0 || rateNum > 1) {
      toast.error("Rate must be between 0.1% and 100%");
      return;
    }
    if (depositNum < 0) {
      toast.error("Deposit cannot be negative");
      return;
    }

    setSubmitting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("approve_branch_agent", {
        p_agent_id: agentId,
        p_agent_type: agentType,
        p_rate: rateNum,
        p_deposit_required: depositNum,
      });
      if (error) throw error;
      toast.success("Agent approved");
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to approve agent";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-extrabold text-[#2a3439] font-[family-name:var(--font-manrope)]">
            Approve Agent
          </h3>
          <button onClick={onClose} className="text-[#566166] hover:text-[#2a3439] transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Agent name */}
        <p className="text-sm text-[#566166] mb-6">
          Setting deal terms for <span className="font-semibold text-[#2a3439]">{agentName}</span>
        </p>

        {/* Agent type */}
        <div className="mb-5">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#566166] mb-2">
            Agent Type
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAgentType("pl")}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                agentType === "pl"
                  ? "bg-[#dae2fd] text-[#4a5167] ring-2 ring-[#4a5167]/20"
                  : "bg-[#f0f4f7] text-[#566166] hover:bg-[#e4e8eb]"
              }`}
            >
              P/L Share
            </button>
            <button
              type="button"
              onClick={() => setAgentType("commission")}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                agentType === "commission"
                  ? "bg-emerald-100 text-emerald-800 ring-2 ring-emerald-500/20"
                  : "bg-[#f0f4f7] text-[#566166] hover:bg-[#e4e8eb]"
              }`}
            >
              Commission
            </button>
          </div>
        </div>

        {/* Rate */}
        <div className="mb-5">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#566166] mb-2">
            Rate (%)
          </label>
          <input
            type="number"
            step="0.1"
            min="0.1"
            max="100"
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl bg-[#f0f4f7] border border-[#e4e8eb] text-sm text-[#2a3439] font-mono focus:outline-none focus:ring-2 focus:ring-[#4a5167]/20"
            placeholder="e.g. 10"
          />
          <p className="mt-1 text-[10px] text-[#566166]">
            Stored as {rateInput ? (parseFloat(rateInput) / 100).toFixed(4) : "---"} internally
          </p>
        </div>

        {/* PR 3 — P/L preview pane (only when agentType=pl and branchId provided) */}
        {agentType === "pl" && branchId && (
          <div className="mb-5 p-4 rounded-xl bg-[#f0f4f7] border border-[#dae2fd]">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-3.5 w-3.5 text-[#4a5167]" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#4a5167]">
                P/L Projection
              </span>
              {previewLoading && <Loader2 className="h-3 w-3 animate-spin text-[#4a5167]" />}
            </div>
            {preview ? (
              <>
                <p className="text-2xl font-extrabold text-[#2a3439] font-[family-name:var(--font-manrope)] mb-1">
                  ~{formatCurrency(Number(preview.projected_monthly_payout))}/mo
                </p>
                <p className="text-xs text-[#566166]">
                  Based on last 30 days of branch pool activity
                  {" "}({formatCurrency(Number(preview.last_30d_net_pool_flow))}).
                  Actual depends on which users this agent refers and their outcomes.
                </p>
              </>
            ) : (
              <p className="text-xs text-[#566166]">
                {previewLoading ? "Computing projection..." : "Enter a valid rate to see a projection."}
              </p>
            )}
          </div>
        )}

        {/* Deposit required */}
        <div className="mb-6">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#566166] mb-2">
            Deposit Required ($)
          </label>
          <input
            type="number"
            step="1"
            min="0"
            value={depositInput}
            onChange={(e) => setDepositInput(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl bg-[#f0f4f7] border border-[#e4e8eb] text-sm text-[#2a3439] font-mono focus:outline-none focus:ring-2 focus:ring-[#4a5167]/20"
            placeholder="0"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-[#f0f4f7] text-sm font-semibold text-[#566166] hover:bg-[#e4e8eb] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Approving..." : "Approve Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
