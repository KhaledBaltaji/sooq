"use client";

import { useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { toast } from "sonner";
import { X } from "lucide-react";

interface AgentRejectionModalProps {
  agentId: string;
  agentName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function AgentRejectionModal({ agentId, agentName, onClose, onSuccess }: AgentRejectionModalProps) {
  const supabase = useSupabase();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("reject_branch_agent", {
        p_agent_id: agentId,
        p_reason: reason.trim() || null,
      });
      if (error) throw error;
      toast.success("Agent rejected");
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reject agent";
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
            Reject Agent
          </h3>
          <button onClick={onClose} className="text-[#566166] hover:text-[#2a3439] transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Agent name */}
        <p className="text-sm text-[#566166] mb-6">
          Rejecting application from <span className="font-semibold text-[#2a3439]">{agentName}</span>
        </p>

        {/* Reason */}
        <div className="mb-6">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-[#566166] mb-2">
            Reason (optional)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full px-4 py-2.5 rounded-xl bg-[#f0f4f7] border border-[#e4e8eb] text-sm text-[#2a3439] resize-none focus:outline-none focus:ring-2 focus:ring-red-500/20"
            placeholder="Provide a reason for rejection..."
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
            className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Rejecting..." : "Reject Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
