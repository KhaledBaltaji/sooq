"use client";

import { useState } from "react";
import { useBranchContext } from "@/components/providers/branch-provider";
import { useBranchAgentStatus } from "@/hooks/use-branch-agent-status";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useSession } from "@/lib/auth/hooks";
import { toast } from "sonner";
import { Copy, Check, Clock, XCircle, CheckCircle2, UserPlus, Share2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export default function BranchAgentPage() {
  const branchCtx = useBranchContext();
  const branch = branchCtx?.branch;
  const { user: authUser, loading: authLoading } = useSession();
  const { agent, loading, refetch } = useBranchAgentStatus(branch?.id);
  const supabase = useSupabase();
  const [applying, setApplying] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!branch) {
    return (
      <div className="py-20 text-center text-muted-custom font-dm-sans">
        Branch not found.
      </div>
    );
  }

  if (authLoading || loading) {
    return (
      <div className="py-20 text-center">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-muted-custom border-t-text" />
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-custom font-dm-sans">Please sign in to view agent options.</p>
      </div>
    );
  }

  const handleApply = async () => {
    setApplying(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("apply_branch_agent", {
        p_branch_id: branch.id,
      });
      if (error) throw error;
      toast.success("Application submitted!");
      await refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to apply";
      toast.error(msg);
    } finally {
      setApplying(false);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  // No application yet — show hero
  if (!agent) {
    return (
      <div className="py-12 max-w-lg mx-auto">
        <div className="bg-surface rounded-2xl shadow-sm p-8 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-yes/10">
            <UserPlus className="h-8 w-8 text-yes" />
          </div>
          <h1 className="text-2xl font-bold font-satoshi text-text mb-3">
            Become an Agent
          </h1>
          <p className="text-muted-custom font-dm-sans mb-8 leading-relaxed">
            Join <span className="font-semibold text-text">{branch.name}</span> as an agent.
            Earn commissions by referring users and driving trading activity.
          </p>
          <button
            onClick={handleApply}
            disabled={applying}
            className="w-full py-3 px-6 rounded-xl bg-yes text-white font-dm-sans font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applying ? "Submitting..." : "Apply Now"}
          </button>
        </div>
      </div>
    );
  }

  // Pending
  if (agent.status === "pending") {
    return (
      <div className="py-12 max-w-lg mx-auto">
        <div className="bg-surface rounded-2xl shadow-sm p-8 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
            <Clock className="h-8 w-8 text-warning" />
          </div>
          <h1 className="text-2xl font-bold font-satoshi text-text mb-3">
            Application Under Review
          </h1>
          <p className="text-muted-custom font-dm-sans mb-4 leading-relaxed">
            Your application to become an agent at <span className="font-semibold text-text">{branch.name}</span> is
            being reviewed by the branch operator.
          </p>
          <p className="text-xs text-dim font-dm-sans">
            Applied {new Date(agent.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
      </div>
    );
  }

  // Rejected
  if (agent.status === "rejected") {
    return (
      <div className="py-12 max-w-lg mx-auto">
        <div className="bg-surface rounded-2xl shadow-sm p-8 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-no/10">
            <XCircle className="h-8 w-8 text-no" />
          </div>
          <h1 className="text-2xl font-bold font-satoshi text-text mb-3">
            Application Not Approved
          </h1>
          {agent.rejection_reason && (
            <div className="bg-bg rounded-xl p-4 mb-4">
              <p className="text-sm text-muted-custom font-dm-sans">
                <span className="font-semibold text-text">Reason:</span> {agent.rejection_reason}
              </p>
            </div>
          )}
          <p className="text-xs text-dim font-dm-sans">
            Contact the branch operator if you have questions.
          </p>
        </div>
      </div>
    );
  }

  // Approved / Suspended — show deal terms and stats
  const isSuspended = agent.status === "suspended";

  return (
    <div className="py-12 max-w-lg mx-auto space-y-6">
      {/* Status banner */}
      <div className="bg-surface rounded-2xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${isSuspended ? "bg-dim/10" : "bg-success/10"}`}>
            <CheckCircle2 className={`h-5 w-5 ${isSuspended ? "text-dim" : "text-success"}`} />
          </div>
          <div>
            <h1 className="text-xl font-bold font-satoshi text-text">
              {isSuspended ? "Agent Suspended" : "Agent Active"}
            </h1>
            <p className="text-xs text-muted-custom font-dm-sans">
              {branch.name}
            </p>
          </div>
        </div>

        {/* Deal terms */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-bg rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-custom font-dm-sans font-bold mb-1">Type</p>
            <p className="text-sm font-semibold text-text font-dm-sans">
              {agent.agent_type === "pl" ? "P/L Share" : "Commission"}
            </p>
          </div>
          <div className="bg-bg rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-custom font-dm-sans font-bold mb-1">Rate</p>
            <p className="text-sm font-semibold text-text font-dm-sans">
              {agent.rate != null ? `${(agent.rate * 100).toFixed(1)}%` : "---"}
            </p>
          </div>
          <div className="bg-bg rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-custom font-dm-sans font-bold mb-1">Deposit Req.</p>
            <p className="text-sm font-semibold text-text font-dm-sans">
              {formatCurrency(agent.deposit_required)}
            </p>
          </div>
          <div className="bg-bg rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-custom font-dm-sans font-bold mb-1">Cumulative P/L</p>
            <p className={`text-sm font-semibold font-dm-sans ${Number(agent.cumulative_pl) >= 0 ? "text-success" : "text-no"}`}>
              {Number(agent.cumulative_pl) >= 0 ? "+" : ""}{formatCurrency(Number(agent.cumulative_pl))}
            </p>
          </div>
        </div>
      </div>

      {/* Referral link */}
      {agent.referral_code && (
        <BranchAgentReferralCard
          branchCode={branch.branch_code}
          referralCode={agent.referral_code}
          onCopy={handleCopy}
          copied={copied}
        />
      )}
    </div>
  );
}

function BranchAgentReferralCard({
  branchCode,
  referralCode,
  onCopy,
  copied,
}: {
  branchCode: string;
  referralCode: string;
  onCopy: (text: string) => void;
  copied: boolean;
}) {
  const referralLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/b/${branchCode}?ref=${referralCode}`
      : "";

  const shareWhatsApp = () => {
    if (!referralLink) return;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`Join me on Sooq! ${referralLink}`)}`,
      "_blank",
    );
  };

  return (
    <div className="bg-surface rounded-2xl shadow-sm p-6 space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-custom font-dm-sans font-bold mb-1">
          Your Referral Link
        </p>
        <p className="text-xs text-muted-custom font-dm-sans">
          Share this link with clients — they'll be auto-attributed to you on signup.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 bg-bg rounded-xl px-4 py-3 font-mono text-xs text-text break-all">
          {referralLink || "\u00a0"}
        </div>
        <button
          onClick={() => onCopy(referralLink)}
          disabled={!referralLink}
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-bg text-muted-custom hover:text-text transition-colors disabled:opacity-40"
          aria-label="Copy referral link"
        >
          {copied ? <Check className="h-5 w-5 text-success" /> : <Copy className="h-5 w-5" />}
        </button>
      </div>

      <button
        onClick={shareWhatsApp}
        disabled={!referralLink}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-bg text-text font-dm-sans font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-40"
      >
        <Share2 className="h-4 w-4" /> Share on WhatsApp
      </button>

      <div className="pt-2 border-t border-border-custom">
        <p className="text-[10px] uppercase tracking-widest text-muted-custom font-dm-sans font-bold mb-1">
          Your Code
        </p>
        <p className="font-mono text-sm font-bold text-text tracking-wider">{referralCode}</p>
      </div>
    </div>
  );
}
