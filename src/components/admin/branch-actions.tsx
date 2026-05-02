"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/components/providers/supabase-provider";
import { toast } from "sonner";
import type { BranchStatus } from "@/types/branch";

interface BranchActionsProps {
  branchId: string;
  status: BranchStatus;
}

type ActionModal = "status" | "solvency" | "pool" | "withdrawal" | "webhook" | null;

export function BranchActions({ branchId, status }: BranchActionsProps) {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = useSupabase() as any;
  const [activeModal, setActiveModal] = useState<ActionModal>(null);
  const [loading, setLoading] = useState(false);

  // Form state
  const [pin, setPin] = useState("");
  const [newStatus, setNewStatus] = useState<BranchStatus>("active");
  const [reason, setReason] = useState("");
  const [solvencyPct, setSolvencyPct] = useState("90");
  const [durationHours, setDurationHours] = useState("24");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [description, setDescription] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const resetForm = () => {
    setPin("");
    setNewStatus("active");
    setReason("");
    setSolvencyPct("90");
    setDurationHours("24");
    setNote("");
    setAmount("");
    setDestination("");
    setDescription("");
    setWebhookUrl("");
    setWebhookSecret("");
    setActiveModal(null);
  };

  const handleChangeStatus = async () => {
    if (loading) return;
    setLoading(true);
    const { error } = await supabase.rpc("admin_update_branch_status", {
      p_branch_id: branchId,
      p_new_status: newStatus,
      p_reason: reason,
      p_pin: pin,
    });
    if (error) {
      toast.error("Failed to update status", { description: error.message });
    } else {
      toast.success(`Branch status changed to ${newStatus}`);
      resetForm();
      router.refresh();
    }
    setLoading(false);
  };

  const handleOverrideSolvency = async () => {
    const pct = parseFloat(solvencyPct);
    const hours = parseInt(durationHours);
    if (isNaN(pct) || pct < 80 || pct > 100) {
      toast.error("Invalid threshold", { description: "Must be between 80% and 100%" });
      return;
    }
    if (isNaN(hours) || hours < 1 || hours > 168) {
      toast.error("Invalid duration", { description: "Must be between 1 and 168 hours" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.rpc("admin_override_solvency", {
      p_branch_id: branchId,
      p_new_pct: pct / 100,
      p_duration_hours: hours,
      p_note: note,
      p_pin: pin,
    });
    if (error) {
      toast.error("Failed to override solvency", { description: error.message });
    } else {
      toast.success(`Solvency override applied: ${pct}% for ${hours}h`);
      resetForm();
      router.refresh();
    }
    setLoading(false);
  };

  const handleAdjustPool = async () => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed === 0) {
      toast.error("Invalid amount", { description: "Enter a non-zero number" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.rpc("admin_adjust_branch_pool", {
      p_branch_id: branchId,
      p_amount: parsed,
      p_description: description,
      p_pin: pin,
    });
    if (error) {
      toast.error("Failed to adjust pool", { description: error.message });
    } else {
      toast.success(parsed > 0 ? `Pool credited $${parsed.toFixed(2)}` : `Pool debited $${Math.abs(parsed).toFixed(2)}`);
      resetForm();
      router.refresh();
    }
    setLoading(false);
  };

  const handleOverrideWithdrawal = async () => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      toast.error("Invalid amount", { description: "Enter a positive number" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.rpc("admin_override_withdrawal", {
      p_branch_id: branchId,
      p_amount: parsed,
      p_destination: destination,
      p_note: note,
      p_pin: pin,
    });
    if (error) {
      toast.error("Failed to override withdrawal", { description: error.message });
    } else {
      toast.success(`Withdrawal of $${parsed.toFixed(2)} processed`);
      resetForm();
      router.refresh();
    }
    setLoading(false);
  };

  const handleUpdateWebhook = async () => {
    if (loading) return;
    setLoading(true);
    const { error } = await supabase
      .from("branches")
      .update({
        webhook_url: webhookUrl || null,
        webhook_secret: webhookSecret || null,
      })
      .eq("id", branchId);
    if (error) {
      toast.error("Failed to update webhook config", { description: error.message });
    } else {
      toast.success("Webhook configuration updated");
      resetForm();
      router.refresh();
    }
    setLoading(false);
  };

  const generateSecret = () => {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    setWebhookSecret(Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join(""));
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setActiveModal("status")}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#2a3439] text-white font-semibold rounded-lg hover:opacity-90 transition-all text-sm"
        >
          <span className="material-symbols-outlined text-sm">swap_horiz</span>
          Change Status
        </button>
        <button
          onClick={() => setActiveModal("solvency")}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#f0f4f7] text-[#566166] font-semibold rounded-lg hover:bg-[#e8eff3] transition-all text-sm"
        >
          <span className="material-symbols-outlined text-sm">tune</span>
          Solvency Override
        </button>
        <button
          onClick={() => setActiveModal("pool")}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#f0f4f7] text-[#566166] font-semibold rounded-lg hover:bg-[#e8eff3] transition-all text-sm"
        >
          <span className="material-symbols-outlined text-sm">account_balance</span>
          Adjust Pool
        </button>
        <button
          onClick={() => setActiveModal("withdrawal")}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#f0f4f7] text-[#566166] font-semibold rounded-lg hover:bg-[#e8eff3] transition-all text-sm"
        >
          <span className="material-symbols-outlined text-sm">output</span>
          Override Withdrawal
        </button>
        <button
          onClick={() => setActiveModal("webhook")}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#f0f4f7] text-[#566166] font-semibold rounded-lg hover:bg-[#e8eff3] transition-all text-sm"
        >
          <span className="material-symbols-outlined text-sm">webhook</span>
          Webhook
        </button>
      </div>

      {/* Modal Overlay */}
      {activeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => resetForm()}>
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Change Status */}
            {activeModal === "status" && (
              <>
                <h3 className="text-lg font-bold text-[#2a3439] mb-6">Change Branch Status</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">New Status</label>
                    <select
                      value={newStatus}
                      onChange={(e) => setNewStatus(e.target.value as BranchStatus)}
                      className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                    >
                      <option value="active">Active</option>
                      <option value="payback">Payback</option>
                      <option value="frozen">Frozen</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Reason</label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                      rows={2}
                      placeholder="Reason for status change..."
                    />
                  </div>
                  <PinInput pin={pin} setPin={setPin} />
                  <ActionButton label="Update Status" loading={loading} onClick={handleChangeStatus} disabled={!pin || !reason} />
                </div>
              </>
            )}

            {/* Solvency Override */}
            {activeModal === "solvency" && (
              <>
                <h3 className="text-lg font-bold text-[#2a3439] mb-6">Override Solvency Gate</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Threshold (%)</label>
                    <input
                      type="number"
                      value={solvencyPct}
                      onChange={(e) => setSolvencyPct(e.target.value)}
                      min={80} max={100} step={1}
                      className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Duration (hours)</label>
                    <input
                      type="number"
                      value={durationHours}
                      onChange={(e) => setDurationHours(e.target.value)}
                      min={1} max={168}
                      className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Note</label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                      rows={2}
                      placeholder="Reason for override..."
                    />
                  </div>
                  <PinInput pin={pin} setPin={setPin} />
                  <ActionButton label="Apply Override" loading={loading} onClick={handleOverrideSolvency} disabled={!pin || !note} />
                </div>
              </>
            )}

            {/* Adjust Pool */}
            {activeModal === "pool" && (
              <>
                <h3 className="text-lg font-bold text-[#2a3439] mb-6">Adjust Branch Pool</h3>
                <p className="text-xs text-[#566166] mb-4">Positive = credit, negative = debit. Pool cannot go below $0.</p>
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Amount ($)</label>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      step={0.01}
                      className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                      placeholder="e.g., 5000 or -1000"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                      rows={2}
                      placeholder="Reason for adjustment..."
                    />
                  </div>
                  <PinInput pin={pin} setPin={setPin} />
                  <ActionButton label="Adjust Pool" loading={loading} onClick={handleAdjustPool} disabled={!pin || !amount || !description} />
                </div>
              </>
            )}

            {/* Override Withdrawal */}
            {activeModal === "withdrawal" && (
              <>
                <h3 className="text-lg font-bold text-[#2a3439] mb-6">Override Withdrawal</h3>
                <p className="text-xs text-[#566166] mb-4">Bypasses reserve lock. Fee still applies.</p>
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Amount ($)</label>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      min={0} step={0.01}
                      className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Destination</label>
                    <input
                      type="text"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                      placeholder="Bank account, wallet, etc."
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Note</label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                      rows={2}
                      placeholder="Reason for override..."
                    />
                  </div>
                  <PinInput pin={pin} setPin={setPin} />
                  <ActionButton label="Process Withdrawal" loading={loading} onClick={handleOverrideWithdrawal} disabled={!pin || !amount || !destination || !note} />
                </div>
              </>
            )}

            {/* Configure Webhook */}
            {activeModal === "webhook" && (
              <>
                <h3 className="text-lg font-bold text-[#2a3439] mb-6">Configure Webhook</h3>
                <p className="text-xs text-[#566166] mb-4">
                  Branch will receive HMAC-SHA256 signed POST requests when markets resolve.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Webhook URL</label>
                    <input
                      type="url"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                      placeholder="https://example.com/webhook/resolution"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Webhook Secret</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={webhookSecret}
                        onChange={(e) => setWebhookSecret(e.target.value)}
                        className="flex-1 border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
                        placeholder="HMAC signing secret"
                      />
                      <button
                        onClick={generateSecret}
                        type="button"
                        className="px-3 py-2.5 bg-[#f0f4f7] text-[#566166] font-semibold rounded-lg hover:bg-[#e8eff3] transition-all text-xs whitespace-nowrap"
                      >
                        Generate
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-[#566166]">Leave both empty to disable webhooks for this branch.</p>
                  <ActionButton label="Save Webhook Config" loading={loading} onClick={handleUpdateWebhook} disabled={false} />
                </div>
              </>
            )}

            <button
              onClick={resetForm}
              className="mt-4 w-full text-center text-sm text-[#566166] hover:text-[#2a3439] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function PinInput({ pin, setPin }: { pin: string; setPin: (v: string) => void }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-[#566166] uppercase tracking-widest mb-1 block">Admin PIN</label>
      <input
        type="password"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        maxLength={6}
        className="w-full border border-[#d9e4ea] rounded-lg px-3 py-2.5 text-sm font-mono tracking-[0.3em] text-center focus:ring-2 focus:ring-[var(--yes)]/20 focus:outline-none"
        placeholder="••••••"
      />
    </div>
  );
}

function ActionButton({ label, loading, onClick, disabled }: { label: string; loading: boolean; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className="w-full py-3 bg-[var(--yes)] text-white font-bold rounded-lg hover:opacity-90 transition-all disabled:opacity-40 text-sm"
    >
      {loading ? "Processing..." : label}
    </button>
  );
}
