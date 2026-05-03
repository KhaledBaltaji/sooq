"use client";

// Small client buttons used by the admin help pages — wrap the
// DELETE call + a confirm() dialog so the parent server pages stay
// async-server-component shaped.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

export function DeleteCollectionButton({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    if (
      !confirm(
        `Delete collection "${title}"? This will also delete every article inside it. This cannot be undone.`
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/help/collections/${id}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        alert(body.error ?? "Delete failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="p-2 rounded-md text-[#717c82] hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
      aria-label="Delete"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}

export function DeleteArticleButton({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    if (!confirm(`Delete article "${title}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/help/articles/${id}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        alert(body.error ?? "Delete failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="p-2 rounded-md text-[#717c82] hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
      aria-label="Delete"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
