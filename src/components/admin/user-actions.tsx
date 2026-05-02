"use client";

// W3 strip: removed agent-activation override (toggle_agent_activation_override
// RPC dropped, agent_activated column dropped). Only freeze/unfreeze remains.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/components/providers/supabase-provider";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface UserActionsProps {
  userId: string;
  isFrozen: boolean;
}

export function UserActions({ userId, isFrozen }: UserActionsProps) {
  const router = useRouter();
  const supabase = useSupabase();
  const t = useTranslations("toast");
  const [toggling, setToggling] = useState(false);

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
    </div>
  );
}
