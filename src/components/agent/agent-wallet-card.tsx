"use client";

import { useState } from "react";
import { Wallet, ArrowRight, Check, Loader2, Clock } from "lucide-react";
import { useAgentTransfer } from "@/hooks/use-agent-transfer";
import { Skeleton } from "@/components/ui/skeleton";
import { Odometer } from "@/components/ui/odometer";
import { motion } from "framer-motion";

interface AgentWalletCardProps {
  /** Total agent_balance_usd — shown as a small secondary line when pending > 0 */
  agentBalance: number;
  /**
   * Withdrawable right now. Falls back to agentBalance when summary
   * isn't available (e.g., legacy caller, pre-migration state).
   */
  available?: number;
  /** Locked commissions that unlock on a future date. */
  pending?: number;
  /** ISO 8601 UTC timestamp of the earliest unlock. Rendered in the user's local timezone. */
  nextUnlockAt?: string | null;
  loading: boolean;
  onTransferComplete?: () => void;
}

/**
 * Renders the agent wallet with an Available / Pending split.
 *
 * Source-of-truth for the split comes from `get_agent_wallet_summary`
 * (migration 250). This component is a pure renderer — it does not
 * compute available/pending itself. If `available` is undefined,
 * we fall back to showing `agentBalance` (preserves pre-migration
 * rendering for any stale caller).
 *
 * Transfer validation happens server-side via `transfer_agent_to_portfolio`,
 * which raises `Insufficient unlocked balance` when the request exceeds
 * available. We surface that message verbatim in the error toast below.
 */
export function AgentWalletCard({
  agentBalance,
  available,
  pending,
  nextUnlockAt,
  loading,
  onTransferComplete,
}: AgentWalletCardProps) {
  const { transfer, loading: transferring, error } = useAgentTransfer();
  const [amount, setAmount] = useState("");
  const [showTransfer, setShowTransfer] = useState(false);
  const [success, setSuccess] = useState(false);

  if (loading) {
    return (
      <div>
        <Skeleton className="h-5 w-40 mb-3" />
        <Skeleton className="h-10 w-32" />
      </div>
    );
  }

  // Available falls back to total for pre-migration callers.
  const availableBalance = available ?? agentBalance;
  const pendingBalance = pending ?? 0;
  const hasPending = pendingBalance > 0.005; // ignore sub-cent rounding

  const handleTransfer = async () => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return;
    const result = await transfer(parsed);
    if (result) {
      setSuccess(true);
      setAmount("");
      setTimeout(() => {
        setSuccess(false);
        setShowTransfer(false);
      }, 2000);
      onTransferComplete?.();
    }
  };

  const handleTransferAll = () => {
    setAmount(availableBalance.toFixed(2));
    setShowTransfer(true);
  };

  const unlockLabel = nextUnlockAt ? formatUnlockDate(nextUnlockAt) : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Wallet className="w-4 h-4 text-warning" />
        <h3 className="font-satoshi text-xs font-black text-muted-custom uppercase tracking-widest">
          Agent Wallet
        </h3>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <Odometer
            value={availableBalance}
            className="text-3xl font-satoshi font-black text-text"
          />
          {hasPending && (
            <p className="mt-1 flex items-center gap-1 text-xs font-dm-sans text-muted-custom tabular-nums">
              <Clock className="w-3 h-3" />
              <span>
                Pending ${pendingBalance.toFixed(2)}
                {unlockLabel && (
                  <span className="ml-1 text-dim">· unlocks {unlockLabel}</span>
                )}
              </span>
            </p>
          )}
        </div>

        {availableBalance > 0 && !showTransfer && (
          <button
            onClick={() => setShowTransfer(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-yes/10 text-yes rounded-lg font-satoshi font-bold text-xs hover:bg-yes/20 transition-colors shadow-[0_2px_0_0px_rgba(45,140,255,0.3)] active:translate-y-[1px] active:shadow-[0_1px_0_0px_rgba(45,140,255,0.3)] duration-[80ms]"
          >
            Transfer to Portfolio
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {showTransfer && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-4 pt-4 border-t border-border-custom/40 overflow-hidden"
        >
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-custom text-sm">$</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0.01"
                max={availableBalance}
                className="w-full ps-7 pe-3 py-2 bg-bg border border-border-custom rounded-lg text-sm font-dm-sans tabular-nums text-text placeholder:text-dim focus:outline-none focus:border-yes/50 focus:ring-1 focus:ring-yes/20 transition-colors"
                disabled={transferring}
              />
            </div>
            <button
              onClick={handleTransferAll}
              className="px-3 py-2 text-xs font-bold text-muted-custom hover:text-text border border-border-custom rounded-lg transition-colors hover:border-yes/40"
              disabled={transferring}
            >
              All
            </button>
            <button
              onClick={handleTransfer}
              disabled={
                transferring ||
                !amount ||
                parseFloat(amount) <= 0 ||
                parseFloat(amount) > availableBalance
              }
              className="px-4 py-2 bg-yes text-white rounded-lg font-satoshi font-bold text-xs disabled:opacity-40 transition-all duration-[80ms] flex items-center gap-1.5 shadow-[0_3px_0_0px_rgba(15,60,140,0.7)] active:translate-y-[2px] active:shadow-[0_1px_0_0px_rgba(15,60,140,0.7)]"
            >
              {transferring ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : success ? (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                  <Check className="w-3 h-3" />
                </motion.div>
              ) : null}
              {success ? "Done" : "Transfer"}
            </button>
          </div>
          {error && (
            <p className="text-xs text-error mt-2 font-dm-sans">{error}</p>
          )}
          <button
            onClick={() => { setShowTransfer(false); setAmount(""); }}
            className="text-xs text-muted-custom mt-2 hover:text-text transition-colors"
            disabled={transferring}
          >
            Cancel
          </button>
        </motion.div>
      )}
    </div>
  );
}

/**
 * Render an ISO UTC timestamp in the viewer's local timezone.
 * Lebanon is UTC+2/+3, so Feb 1 00:00 UTC → "Feb 1, 2:00 AM" or "3:00 AM" local.
 * This is the mitigation for the critical UTC-confusion failure mode
 * flagged in the eng review.
 */
function formatUnlockDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    // Short form like "Feb 1, 3 AM" in the user's locale/timezone.
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
