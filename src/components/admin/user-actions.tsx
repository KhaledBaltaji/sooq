"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/components/providers/supabase-provider";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface UserActionsProps {
  userId: string;
  isFrozen: boolean;
  agentActivated: boolean;
  activationOverride: boolean;
}

export function UserActions({ userId, isFrozen, agentActivated, activationOverride }: UserActionsProps) {
  const router = useRouter();
  const supabase = useSupabase();
  const t = useTranslations("toast");
  const [toggling, setToggling] = useState(false);
  const [togglingOverride, setTogglingOverride] = useState(false);

  const handleToggleFreeze = async () => {
    setToggling(true);
    const { error } = await supabase.rpc("toggle_user_freeze", {
      p_user_id: userId,
      p_frozen: !isFrozen,
    });

    if (error) {
      toast.error(t("failedToUpdateUser"), { description: error.message });
    } else {
      toast.success(isFrozen ? t("userUnfrozen") : t("userFrozen"));
      router.refresh();
    }
    setToggling(false);
  };

  const handleToggleActivationOverride = async () => {
    setTogglingOverride(true);
    const { data, error } = await supabase.rpc("toggle_agent_activation_override", {
      p_user_id: userId,
      p_override: !activationOverride,
    });

    if (error) {
      toast.error(t("failedToUpdateOverride"), { description: error.message });
    } else {
      const released = (data as any)?.released ?? 0;
      const msg = !activationOverride
        ? (released > 0 ? t("overrideEnabledReleased", { amount: `$${released.toFixed(2)}` }) : t("overrideEnabled"))
        : t("overrideRemoved");
      toast.success(msg);
      router.refresh();
    }
    setTogglingOverride(false);
  };

  return (
    <div className="flex gap-4">
      <button
        onClick={handleToggleFreeze}
        disabled={toggling}
        className={`flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-sm border transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
          isFrozen
            ? "border-[var(--success)] text-[var(--success)] hover:bg-[var(--success)]/5"
            : "border-[var(--error)] text-[var(--error)] hover:bg-[var(--error)]/5"
        }`}
      >
        <span className="material-symbols-outlined text-lg">
          {isFrozen ? "gpp_bad" : "shield"}
        </span>
        {isFrozen
          ? toggling ? "Unfreezing..." : "Unfreeze Account"
          : toggling ? "Freezing..." : "Freeze Account"
        }
      </button>

      {!agentActivated && (
        <button
          onClick={handleToggleActivationOverride}
          disabled={togglingOverride}
          className={`flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-sm border transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
            activationOverride
              ? "border-[var(--warning)] text-[var(--warning)] hover:bg-[var(--warning)]/5"
              : "border-[var(--yes)] text-[var(--yes)] hover:bg-[var(--yes)]/5"
          }`}
        >
          <span className="material-symbols-outlined text-lg">
            {activationOverride ? "lock_open" : "lock"}
          </span>
          {activationOverride
            ? togglingOverride ? "Removing..." : "Remove Override"
            : togglingOverride ? "Enabling..." : "Override Activation"
          }
        </button>
      )}
    </div>
  );
}
