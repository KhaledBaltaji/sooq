"use client";

// W3 + W7: agent-activation gone, supabase.rpc replaced by /api/admin
// fetch wrapper.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface UserActionsProps {
  userId: string;
  isFrozen: boolean;
}

export function UserActions({ userId, isFrozen }: UserActionsProps) {
  const router = useRouter();
  const t = useTranslations("toast");
  const [toggling, setToggling] = useState(false);

  const handleToggleFreeze = async () => {
    setToggling(true);
    try {
      const res = await fetch("/api/admin/users/freeze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, frozen: !isFrozen }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to update user");
      }

      toast.success(isFrozen ? t("userUnfrozen") : t("userFrozen"));
      router.refresh();
    } catch (err) {
      toast.error(t("failedToUpdateUser"), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setToggling(false);
    }
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
          ? toggling
            ? "Unfreezing..."
            : "Unfreeze Account"
          : toggling
            ? "Freezing..."
            : "Freeze Account"}
      </button>
    </div>
  );
}
