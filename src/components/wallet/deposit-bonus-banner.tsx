"use client";

import { useCallback, useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useSession } from "@/lib/auth/hooks";
import { useTranslations } from "next-intl";
import { Gift, X, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

// Eligibility gate (mirrors server-side claim_deposit_bonus RPC guards):
//   - User is NOT referred (organic signup only — anti-farming)
//   - User has NOT already claimed the bonus
//   - User has at least one CONFIRMED deposit of $20 or more
// We compute locally before rendering so the banner never shows for an
// ineligible user. The RPC is the authoritative gate — if our check missed
// something (race condition on deposit confirmation, etc.) the RPC still
// enforces and returns an error.

export function DepositBonusBanner({ className }: { className?: string }) {
  const supabase = useSupabase();
  const { user } = useSession();
  const t = useTranslations("wallet");
  const [state, setState] = useState<"checking" | "eligible" | "ineligible" | "claiming" | "claimed" | "dismissed">("checking");
  const [bonusAmount, setBonusAmount] = useState(5);

  const check = useCallback(async () => {
    if (!user) return;
    const { data: userRow, error: userErr } = await supabase
      .from("users")
      .select("deposit_bonus_claimed, referred_by")
      .eq("id", user.id)
      .maybeSingle();
    if (userErr || !userRow) {
      setState("ineligible");
      return;
    }
    if (userRow.deposit_bonus_claimed) {
      setState("ineligible");
      return;
    }
    if (userRow.referred_by) {
      setState("ineligible");
      return;
    }
    const { data: firstDep } = await supabase
      .from("deposits")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "confirmed")
      .gte("amount", 20)
      .limit(1)
      .maybeSingle();
    setState(firstDep ? "eligible" : "ineligible");
  }, [supabase, user]);

  useEffect(() => {
    void check();
  }, [check]);

  const handleClaim = async () => {
    setState("claiming");
    const { data, error } = await supabase.rpc("claim_deposit_bonus" as never);
    if (error) {
      toast.error(error.message);
      setState("eligible");
      return;
    }
    const result = data as { bonus_amount?: number } | null;
    if (result?.bonus_amount) setBonusAmount(Number(result.bonus_amount));
    toast.success(t("bonusClaimed", { amount: formatCurrency(result?.bonus_amount ?? 5) }));
    setState("claimed");
  };

  if (state === "checking" || state === "ineligible" || state === "dismissed") {
    return null;
  }

  if (state === "claimed") {
    return (
      <div className={`relative rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-center gap-3 ${className ?? ""}`}>
        <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
          <Check className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-emerald-900 font-dm-sans">
            {t("bonusClaimedTitle", { amount: formatCurrency(bonusAmount) })}
          </p>
          <p className="text-xs text-emerald-700 mt-0.5">
            {t("bonusClaimedSubtitle")}
          </p>
        </div>
      </div>
    );
  }

  // state === "eligible" or "claiming"
  return (
    <div className={`relative rounded-xl bg-gradient-to-r from-yes/10 to-emerald-50 border border-yes/30 p-4 flex items-center gap-3 ${className ?? ""}`}>
      <div className="w-10 h-10 rounded-full bg-yes flex items-center justify-center flex-shrink-0">
        <Gift className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text font-dm-sans">
          {t("bonusAvailableTitle", { amount: formatCurrency(bonusAmount) })}
        </p>
        <p className="text-xs text-muted-custom mt-0.5">
          {t("bonusAvailableSubtitle")}
        </p>
      </div>
      <button
        onClick={handleClaim}
        disabled={state === "claiming"}
        className="flex-shrink-0 h-9 px-4 rounded-lg bg-yes hover:bg-yes/90 text-white font-dm-sans font-semibold text-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
      >
        {state === "claiming" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {state === "claiming" ? t("processing") : t("claimBonus")}
      </button>
      <button
        onClick={() => setState("dismissed")}
        className="flex-shrink-0 w-7 h-7 rounded-full text-muted-custom hover:bg-black/5 flex items-center justify-center"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
