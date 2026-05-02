"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useMarket } from "@/hooks/use-market";
import { AdminPinSetup } from "@/components/admin/admin-pin-setup";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import * as Sentry from "@sentry/nextjs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import type { Side } from "@/types/database";

export default function ResolveMarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const supabase = useSupabase();
  const { market, ammState, loading: marketLoading } = useMarket(id);
  const t = useTranslations("toast");
  const [outcome, setOutcome] = useState<Side | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolutionFeeRate, setResolutionFeeRate] = useState<number | null>(null);
  const [pin, setPin] = useState("");
  const [hasPin, setHasPin] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [feeLoadError, setFeeLoadError] = useState(false);

  useEffect(() => {
    const fetchFee = async () => {
      const { data, error } = await supabase
        .from("fee_config")
        .select("rate")
        .eq("fee_type", "resolution_fee")
        .single();
      if (data) {
        setResolutionFeeRate(Number(data.rate));
      } else {
        setFeeLoadError(true);
        if (error) console.error("Failed to load resolution fee:", error.message);
      }
    };
    const checkPin = async () => {
      const { data } = await supabase.rpc("admin_has_pin");
      setHasPin(!!data);
      if (!data) setShowPinSetup(true);
    };
    fetchFee();
    checkPin();
  }, [supabase]);

  const payoutPerShare = resolutionFeeRate !== null ? (1 - resolutionFeeRate).toFixed(2) : "—";

  if (marketLoading || !market) {
    return (
      <div className="flex-1 p-8 max-w-[800px]">
        <div className="animate-pulse space-y-6">
          <div className="h-4 w-32 bg-[#e8eff3] rounded" />
          <div className="h-10 w-96 bg-[#e8eff3] rounded" />
          <div className="h-64 bg-[#e8eff3] rounded-xl" />
        </div>
      </div>
    );
  }

  const handleResolve = async () => {
    if (!outcome) return;
    if (!pin || pin.length !== 6) {
      toast.error(t("enterSixDigitPin"));
      return;
    }
    setResolving(true);

    const { error } = await supabase.rpc("resolve_market", {
      p_market_id: id,
      p_outcome: outcome,
      p_pin: pin,
    });

    if (error) {
      Sentry.captureMessage("Market resolution failed", {
        level: "error",
        extra: { marketId: id, outcome, errorMessage: error.message },
        tags: { source: "admin/resolve-market" },
      });
      toast.error(error.message);
      setPin("");
    } else {
      toast.success(t("marketResolved"));
      // Fire-and-forget: dispatch resolution webhooks to affected branches
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.access_token) {
          fetch("/api/admin/dispatch-webhooks", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ market_id: id, outcome }),
          }).catch(() => {});
        }
      }).catch(() => {});
      router.push(`/admin/markets/${id}`);
    }
    setResolving(false);
    setShowConfirm(false);
  };

  return (
    <>
    <AdminPinSetup
      open={showPinSetup}
      onOpenChange={setShowPinSetup}
      onSuccess={() => { setHasPin(true); setShowPinSetup(false); }}
    />
    <div className="flex-1 p-8 max-w-[800px] space-y-8">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-[#566166]">
        <Link href="/admin/markets" className="hover:text-[var(--yes)] transition-colors">Markets</Link>
        <span className="material-symbols-outlined text-xs">chevron_right</span>
        <Link href={`/admin/markets/${id}`} className="hover:text-[var(--yes)] transition-colors">
          #{id.slice(0, 6).toUpperCase()}
        </Link>
        <span className="material-symbols-outlined text-xs">chevron_right</span>
        <span className="text-[#2a3439] font-semibold">Resolve</span>
      </div>

      {/* Header */}
      <div className="space-y-2">
        <h2 className="text-3xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Resolve Market
        </h2>
        <p className="text-[#566166] text-sm max-w-lg">{market.question_en}</p>
      </div>

      {/* Outcome Selection */}
      <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 space-y-6">
        <p className="text-sm font-semibold text-[#2a3439] font-[family-name:var(--font-inter)]">
          Select the winning outcome:
        </p>

        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setOutcome("yes")}
            className={cn(
              "py-8 rounded-xl text-center font-[family-name:var(--font-manrope)] font-bold text-xl transition-all",
              outcome === "yes"
                ? "bg-[var(--yes)]/10 border-2 border-[var(--yes)] text-[var(--yes)] shadow-[0_0_20px_rgba(45,140,255,0.15)]"
                : "bg-[#f0f4f7] border-2 border-transparent text-[#566166] hover:border-[var(--yes)]/30 hover:bg-[#e8eff3]"
            )}
          >
            YES
            <p className="text-xs font-normal font-[family-name:var(--font-inter)] mt-2 opacity-70">
              Price: {ammState ? `${Math.round(ammState.current_yes_price * 100)}%` : "—"}
            </p>
          </button>
          <button
            onClick={() => setOutcome("no")}
            className={cn(
              "py-8 rounded-xl text-center font-[family-name:var(--font-manrope)] font-bold text-xl transition-all",
              outcome === "no"
                ? "bg-[var(--error)]/10 border-2 border-[var(--error)] text-[var(--error)] shadow-[0_0_20px_rgba(159,64,61,0.15)]"
                : "bg-[#f0f4f7] border-2 border-transparent text-[#566166] hover:border-[var(--error)]/30 hover:bg-[#e8eff3]"
            )}
          >
            NO
            <p className="text-xs font-normal font-[family-name:var(--font-inter)] mt-2 opacity-70">
              Price: {ammState ? `${Math.round(ammState.current_no_price * 100)}%` : "—"}
            </p>
          </button>
        </div>

        {/* Warning */}
        <div className="bg-[#fff3cd] border border-[#ffc107]/30 rounded-xl p-4 flex items-start gap-3">
          <span className="material-symbols-outlined text-[#856404] text-lg mt-0.5">warning</span>
          <div>
            <p className="text-sm font-semibold text-[#856404]">This action is irreversible</p>
            <p className="text-xs text-[#856404]/80 mt-1">
              Resolving will pay out winning positions, settle commissions, and record platform revenue.
            </p>
          </div>
        </div>

        {/* Fee load error */}
        {feeLoadError && (
          <div className="bg-[var(--error)]/10 border border-[var(--error)]/30 rounded-xl p-4 text-sm text-[var(--error)] font-medium">
            Failed to load resolution fee rate. Cannot proceed — refresh the page or check fee_config.
          </div>
        )}

        {/* Preview Button */}
        <button
          onClick={() => setShowConfirm(true)}
          disabled={!outcome || feeLoadError || resolutionFeeRate === null}
          className={cn(
            "w-full py-3.5 rounded-lg font-bold text-sm uppercase tracking-wider transition-all flex items-center justify-center gap-2",
            outcome && !feeLoadError && resolutionFeeRate !== null
              ? "bg-[var(--yes)] text-white shadow-lg hover:shadow-xl active:scale-[0.98]"
              : "bg-[#e8eff3] text-[#a9b4b9] cursor-not-allowed"
          )}
        >
          <span className="material-symbols-outlined text-sm">task_alt</span>
          {outcome ? `Preview Resolution — ${outcome.toUpperCase()} Wins` : "Select an Outcome"}
        </button>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirm} onOpenChange={(open) => { setShowConfirm(open); if (!open) setPin(""); }}>
        <DialogContent className="bg-white rounded-2xl border-none shadow-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[var(--error)] font-[family-name:var(--font-manrope)]">
              <span className="material-symbols-outlined">error</span>
              FINAL — IRREVERSIBLE
            </DialogTitle>
            <DialogDescription className="text-[#566166] text-sm">
              You are about to resolve this market as{" "}
              <strong className={outcome === "yes" ? "text-[var(--yes)]" : "text-[var(--error)]"}>
                {outcome?.toUpperCase()}
              </strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="bg-[var(--error)]/5 border border-[var(--error)]/20 rounded-xl p-4 space-y-3">
            <p className="text-sm text-[#2a3439] font-semibold">This will:</p>
            <ul className="text-sm text-[#566166] space-y-1.5 list-none">
              <li className="flex items-center gap-2">
                <span className="material-symbols-outlined text-xs text-[var(--error)]">arrow_forward</span>
                Pay out all {outcome?.toUpperCase()} positions at ${payoutPerShare}/share
              </li>
              <li className="flex items-center gap-2">
                <span className="material-symbols-outlined text-xs text-[var(--error)]">arrow_forward</span>
                Settle all referral commissions
              </li>
              <li className="flex items-center gap-2">
                <span className="material-symbols-outlined text-xs text-[var(--error)]">arrow_forward</span>
                Record platform revenue
              </li>
              <li className="flex items-center gap-2 font-semibold text-[var(--error)]">
                <span className="material-symbols-outlined text-xs">warning</span>
                This action CANNOT be undone
              </li>
            </ul>
          </div>

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
              onClick={() => { setShowConfirm(false); setPin(""); }}
              className="px-5 py-2.5 bg-[#f0f4f7] text-[#566166] font-semibold rounded-lg hover:bg-[#e8eff3] transition-all text-sm"
            >
              Go Back
            </button>
            <button
              onClick={handleResolve}
              disabled={resolving || pin.length !== 6}
              className="px-6 py-2.5 bg-[var(--error)] text-white font-bold rounded-lg hover:opacity-90 transition-all text-sm uppercase tracking-wider disabled:opacity-50 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">gavel</span>
              {resolving ? "Resolving..." : `RESOLVE: ${outcome?.toUpperCase()} WINS`}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </>
  );
}
