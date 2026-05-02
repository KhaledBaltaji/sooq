"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/components/providers/supabase-provider";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { MarketStatus } from "@/types/database";

interface MarketActionsProps {
  marketId: string;
  status: MarketStatus;
}

type Action = "lock" | "void" | null;

export function MarketActions({ marketId, status }: MarketActionsProps) {
  const router = useRouter();
  const supabase = useSupabase();
  const t = useTranslations("toast");
  const [action, setAction] = useState<Action>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const closeDialog = () => {
    setAction(null);
    setPin("");
    setSubmitting(false);
  };

  const handleSubmit = async () => {
    if (!action || pin.length !== 6) return;
    setSubmitting(true);

    const rpc = action === "lock" ? "lock_market" : "void_market";
    const errorKey = action === "lock" ? "failedToLockMarket" : "failedToVoidMarket";
    const successKey = action === "lock" ? "marketLocked" : "marketVoided";

    const { error } = await supabase.rpc(rpc, {
      p_market_id: marketId,
      p_pin: pin,
    });

    if (error) {
      toast.error(t(errorKey), { description: error.message });
      setPin("");
      setSubmitting(false);
    } else {
      toast.success(t(successKey));
      closeDialog();
      router.refresh();
    }
  };

  const isLock = action === "lock";
  const accent = isLock ? "var(--yes)" : "var(--error)";
  const title = isLock ? "Lock Market" : "Void Market";

  return (
    <>
      {(status === "open" || status === "closed") && (
        <button
          onClick={() => setAction("void")}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#f0f4f7] text-[#566166] font-semibold rounded-lg hover:bg-[#e8eff3] transition-all text-sm"
        >
          <span className="material-symbols-outlined text-sm">block</span>
          Void Market
        </button>
      )}
      {status === "open" && (
        <button
          onClick={() => setAction("lock")}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#2a3439] text-white font-semibold rounded-lg hover:opacity-90 transition-all text-sm"
        >
          <span className="material-symbols-outlined text-sm">lock</span>
          Lock Market
        </button>
      )}

      <Dialog open={action !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="bg-white rounded-2xl border-none shadow-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-[family-name:var(--font-manrope)]" style={{ color: accent }}>
              <span className="material-symbols-outlined">
                {isLock ? "lock" : "warning"}
              </span>
              {title}
            </DialogTitle>
            <DialogDescription className="text-[#566166] text-sm">
              {isLock
                ? "Locking will close the market to new trades. Cannot be undone."
                : "Voiding refunds all positions at cost basis and claws back commissions. Irreversible."}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl p-4 space-y-2" style={{ backgroundColor: `color-mix(in srgb, ${accent} 5%, white)`, border: `1px solid color-mix(in srgb, ${accent} 20%, transparent)` }}>
            <p className="text-sm text-[#2a3439] font-semibold">This will:</p>
            <ul className="text-sm text-[#566166] space-y-1.5 list-none">
              {isLock ? (
                <>
                  <li className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-xs" style={{ color: accent }}>arrow_forward</span>
                    Stop all new trades on this market
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-xs" style={{ color: accent }}>arrow_forward</span>
                    Set status to CLOSED (resolution still possible)
                  </li>
                </>
              ) : (
                <>
                  <li className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-xs" style={{ color: accent }}>arrow_forward</span>
                    Refund every position holder at their cost basis
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-xs" style={{ color: accent }}>arrow_forward</span>
                    Claw back all paid commissions
                  </li>
                  <li className="flex items-center gap-2 font-semibold" style={{ color: accent }}>
                    <span className="material-symbols-outlined text-xs">warning</span>
                    Cannot be reversed
                  </li>
                </>
              )}
            </ul>
          </div>

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
              onClick={closeDialog}
              className="px-5 py-2.5 bg-[#f0f4f7] text-[#566166] font-semibold rounded-lg hover:bg-[#e8eff3] transition-all text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || pin.length !== 6}
              className={cn(
                "px-6 py-2.5 text-white font-bold rounded-lg hover:opacity-90 transition-all text-sm uppercase tracking-wider disabled:opacity-50 flex items-center gap-2"
              )}
              style={{ backgroundColor: accent }}
            >
              <span className="material-symbols-outlined text-sm">
                {isLock ? "lock" : "block"}
              </span>
              {submitting ? "Working..." : title}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
