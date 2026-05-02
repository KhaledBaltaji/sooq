"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

type ReviewAction = "approve" | "reject" | "mark_sent";

interface WithdrawalActionsProps {
  withdrawal: {
    id: string;
    amount: number;
    user_name: string;
    net_amount: number;
    status: string;
    destination?: string | null;
    destination_type?: string | null;
    network?: string | null;
    provider?: string | null;
    external_reference_id?: string | null;
  };
}

// Short human label for provider/destination_type pairing.
// Launch scope: Whish + USDT TRC20 only. Bank handling retained for legacy row safety.
const providerLabel = (w: WithdrawalActionsProps["withdrawal"]): string => {
  if (w.provider === "3pay" || w.destination_type === "crypto") {
    return w.network ? `USDT (${w.network})` : "USDT (TRC20)";
  }
  if (w.provider === "whish_manual" || w.destination_type === "whish") return "Whish";
  return "—";
};

export function WithdrawalActions({ withdrawal }: WithdrawalActionsProps) {
  const router = useRouter();
  const t = useTranslations("toast");
  const [action, setAction] = useState<ReviewAction | null>(null);
  const [loading, setLoading] = useState(false);
  const [pin, setPin] = useState("");
  const [externalRef, setExternalRef] = useState("");

  const canReview = withdrawal.status === "pending";
  const canMarkSent = withdrawal.status === "approved";

  if (!canReview && !canMarkSent) return null;

  const resetDialog = () => {
    setAction(null);
    setPin("");
    setExternalRef("");
  };

  const handleConfirm = async () => {
    if (!action || pin.length !== 6) return;
    if (action === "mark_sent" && externalRef.trim().length < 3) return;

    setLoading(true);
    try {
      const endpoint =
        action === "mark_sent"
          ? "/api/admin/withdrawal/mark-sent"
          : "/api/admin/withdrawal/review";

      const body =
        action === "mark_sent"
          ? {
              withdrawal_id: withdrawal.id,
              external_reference_id: externalRef.trim(),
              pin,
            }
          : {
              withdrawal_id: withdrawal.id,
              action,
              pin,
            };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Request failed");
      }

      toast.success(
        action === "approve"
          ? t("withdrawalApproved", { amount: formatCurrency(withdrawal.net_amount) })
          : action === "reject"
            ? t("withdrawalRejected")
            : t("withdrawalMarkedSent")
      );
      resetDialog();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t("failedToProcess");
      toast.error(message);
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  const titleText =
    action === "approve" ? "Approve"
    : action === "reject" ? "Reject"
    : action === "mark_sent" ? "Mark as Sent"
    : "";

  return (
    <>
      <div className="flex items-center justify-center gap-2">
        {canReview && (
          <>
            <button
              onClick={() => setAction("approve")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 transition-all"
            >
              <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              Approve
            </button>
            <button
              onClick={() => setAction("reject")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 active:bg-red-200 transition-all"
            >
              <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>cancel</span>
              Reject
            </button>
          </>
        )}
        {canMarkSent && (
          <button
            onClick={() => setAction("mark_sent")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 transition-all"
          >
            <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>done_all</span>
            Mark Sent
          </button>
        )}
      </div>

      <Dialog open={!!action} onOpenChange={(open) => !open && resetDialog()}>
        <DialogContent className="bg-white rounded-2xl border-none shadow-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="font-[family-name:var(--font-manrope)] text-[#2a3439]">
              {titleText} Withdrawal
            </DialogTitle>
            <DialogDescription className="text-[#566166] text-sm">
              {action === "approve" && `Approve ${formatCurrency(withdrawal.net_amount)} withdrawal for ${withdrawal.user_name}?`}
              {action === "reject" && `Reject ${formatCurrency(withdrawal.amount)} withdrawal request from ${withdrawal.user_name}?`}
              {action === "mark_sent" && `Confirm the ${formatCurrency(withdrawal.net_amount)} transfer for ${withdrawal.user_name} has been sent externally.`}
            </DialogDescription>
          </DialogHeader>

          {/* Destination summary — admin must verify before approving */}
          {(withdrawal.destination || withdrawal.destination_type) && (
            <div className="rounded-xl bg-[#f0f4f7] p-4 space-y-2">
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs font-bold text-[#566166] uppercase tracking-wider">Send to</span>
                <span className="text-xs font-semibold text-[#455367] bg-white px-2 py-0.5 rounded-full">
                  {providerLabel(withdrawal)}
                </span>
              </div>
              <p className="text-sm font-mono text-[#2a3439] break-all leading-relaxed">
                {withdrawal.destination || <span className="text-red-600 font-semibold">⚠ No destination recorded (legacy row — reject this request)</span>}
              </p>
              {withdrawal.external_reference_id && (
                <p className="text-xs text-[#566166]">
                  Prior reference: <span className="font-mono">{withdrawal.external_reference_id}</span>
                </p>
              )}
            </div>
          )}

          {/* Action-specific hint */}
          <div className={`rounded-xl p-4 flex items-start gap-3 ${
            action === "approve" ? "bg-emerald-50" :
            action === "reject" ? "bg-red-50" :
            "bg-blue-50"
          }`}>
            <span className={`material-symbols-outlined text-lg mt-0.5 ${
              action === "approve" ? "text-emerald-600" :
              action === "reject" ? "text-red-500" :
              "text-blue-600"
            }`}>
              {action === "approve" ? "info" : action === "reject" ? "warning" : "done_all"}
            </span>
            <div>
              <p className={`text-sm font-semibold ${
                action === "approve" ? "text-emerald-800" :
                action === "reject" ? "text-red-800" :
                "text-blue-800"
              }`}>
                {action === "approve" && "Ready for ops to send"}
                {action === "reject" && "Funds will be refunded"}
                {action === "mark_sent" && "Confirm external transfer complete"}
              </p>
              <p className={`text-xs mt-1 ${
                action === "approve" ? "text-emerald-700" :
                action === "reject" ? "text-red-700" :
                "text-blue-700"
              }`}>
                {action === "approve" && "Slack will be alerted so ops can send via the right rail. User will NOT receive funds until you Mark Sent afterward."}
                {action === "reject" && `${formatCurrency(withdrawal.amount)} will be returned to the user's balance.`}
                {action === "mark_sent" && "Records the external transaction reference and closes out the withdrawal."}
              </p>
            </div>
          </div>

          {/* External reference input — only for mark_sent */}
          {action === "mark_sent" && (
            <div>
              <label className="block text-xs font-bold text-[#566166] uppercase tracking-wider mb-2">
                External reference ID
              </label>
              <input
                type="text"
                value={externalRef}
                onChange={(e) => setExternalRef(e.target.value)}
                placeholder={
                  withdrawal.destination_type === "crypto" ? "Tron tx hash" :
                  "Whish transaction ID"
                }
                autoComplete="off"
                spellCheck={false}
                className="w-full h-11 bg-[#f0f4f7] border-2 border-transparent rounded-xl px-4 text-sm font-mono text-[#2a3439] focus:ring-0 focus:border-[var(--yes)] focus:outline-none transition-colors"
              />
              <p className="mt-1.5 text-xs text-[#566166]">
                Paste the reference from the actual transfer. Recorded for reconciliation.
              </p>
            </div>
          )}

          {/* Admin PIN */}
          <div className="pt-2">
            <label className="block text-xs font-bold text-[#566166] uppercase tracking-wider mb-2">Admin PIN</label>
            <div className="flex gap-2 justify-center">
              {Array.from({ length: 6 }).map((_, i) => (
                <input
                  key={i}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={pin[i] || ""}
                  onChange={(e) => {
                    const char = e.target.value;
                    if (!/^\d*$/.test(char)) return;
                    const newPin = pin.split("");
                    newPin[i] = char;
                    setPin(newPin.join("").slice(0, 6));
                    if (char && i < 5) {
                      const next = e.target.parentElement?.querySelector<HTMLInputElement>(`input:nth-child(${i + 2})`);
                      next?.focus();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !pin[i] && i > 0) {
                      const prev = (e.target as HTMLElement).parentElement?.querySelector<HTMLInputElement>(`input:nth-child(${i})`);
                      prev?.focus();
                      const newPin = pin.split("");
                      newPin[i - 1] = "";
                      setPin(newPin.join(""));
                    }
                  }}
                  className="w-11 h-13 bg-[#f0f4f7] border-2 border-transparent rounded-xl text-center text-lg font-bold text-[#2a3439] font-mono focus:ring-0 focus:border-[var(--yes)] focus:outline-none transition-colors"
                />
              ))}
            </div>
          </div>

          <DialogFooter className="gap-3 pt-2">
            <button
              onClick={resetDialog}
              disabled={loading}
              className="px-5 py-2.5 bg-[#f0f4f7] text-[#566166] font-semibold rounded-lg hover:bg-[#e8eff3] transition-all text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={
                loading
                || pin.length !== 6
                || (action === "mark_sent" && externalRef.trim().length < 3)
              }
              className={`px-6 py-2.5 font-bold rounded-lg transition-all text-sm disabled:opacity-50 flex items-center gap-2 ${
                action === "approve"
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : action === "reject"
                    ? "bg-[var(--error)] text-white hover:opacity-90"
                    : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              <span className="material-symbols-outlined text-sm">
                {action === "approve" ? "check" : action === "reject" ? "close" : "done_all"}
              </span>
              {loading ? "Processing..." : titleText}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
