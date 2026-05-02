"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/components/providers/supabase-provider";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

export function DeleteCollectionButton({
  id,
  type,
}: {
  id: string;
  type: "collection" | "article";
}) {
  const supabase = useSupabase();
  const router = useRouter();
  const t = useTranslations("toast");
  const [confirming, setConfirming] = useState(false);

  const handleDelete = async () => {
    const table = type === "collection" ? "help_collections" : "help_articles";
    const { error } = await supabase.from(table).delete().eq("id", id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(t("itemDeleted", { item: type === "collection" ? "Collection" : "Article" }));
      router.refresh();
    }
    setConfirming(false);
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handleDelete}
          className="text-xs font-semibold text-red-500 hover:underline"
        >
          Confirm
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs text-[#566166] hover:underline"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="p-1.5 rounded-lg text-[#a9b4b9] hover:text-red-500 hover:bg-red-50 transition-all"
    >
      <span className="material-symbols-outlined text-sm">delete</span>
    </button>
  );
}
