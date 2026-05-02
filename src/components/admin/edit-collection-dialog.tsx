"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/components/providers/supabase-provider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { IconPicker } from "@/components/admin/icon-picker";
import { toast } from "sonner";

interface EditCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: {
    id: string;
    title: string;
    slug: string;
    description: string | null;
    icon: string;
    sort_order: number;
    is_published: boolean;
  };
}

export function EditCollectionDialog({ open, onOpenChange, collection }: EditCollectionDialogProps) {
  const router = useRouter();
  const supabase = useSupabase();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: collection.title,
    slug: collection.slug,
    description: collection.description || "",
    icon: collection.icon,
    sort_order: String(collection.sort_order),
    is_published: collection.is_published,
  });

  useEffect(() => {
    if (open) {
      setForm({
        title: collection.title,
        slug: collection.slug,
        description: collection.description || "",
        icon: collection.icon,
        sort_order: String(collection.sort_order),
        is_published: collection.is_published,
      });
    }
  }, [open, collection]);

  const update = (field: string, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleSave = async () => {
    setLoading(true);
    const { error } = await supabase
      .from("help_collections")
      .update({
        title: form.title,
        slug: form.slug,
        description: form.description || null,
        icon: form.icon,
        sort_order: parseInt(form.sort_order) || 0,
        is_published: form.is_published,
        updated_at: new Date().toISOString(),
      })
      .eq("id", collection.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Collection updated");
      onOpenChange(false);
      router.refresh();
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white rounded-2xl border-none shadow-2xl max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-manrope)] text-[#2a3439]">
            Edit Collection
          </DialogTitle>
          <DialogDescription className="text-[#566166] text-sm">
            Update collection details, icon, and publishing status.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Title */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
              Title *
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all placeholder:text-[#a9b4b9]"
              required
            />
          </div>

          {/* Slug */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
              Slug *
            </label>
            <input
              type="text"
              value={form.slug}
              onChange={(e) => update("slug", e.target.value)}
              className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all placeholder:text-[#a9b4b9]"
              required
            />
            <p className="text-[10px] text-[#a9b4b9] mt-1.5">URL: /help/{form.slug}</p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all min-h-[80px] placeholder:text-[#a9b4b9]"
              placeholder="Brief description of this collection..."
              rows={3}
            />
          </div>

          {/* Icon */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
              Icon
            </label>
            <IconPicker value={form.icon} onChange={(v) => update("icon", v)} />
          </div>

          {/* Sort Order & Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
                Sort Order
              </label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => update("sort_order", e.target.value)}
                className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 transition-all"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
                Status
              </label>
              <button
                type="button"
                onClick={() => update("is_published", !form.is_published)}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold transition-all w-full ${
                  form.is_published
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${
                  form.is_published ? "bg-emerald-500" : "bg-amber-500"
                }`} />
                {form.is_published ? "Published" : "Draft"}
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={() => onOpenChange(false)}
            className="px-6 py-2.5 text-sm font-bold text-[#2a3439] hover:bg-[#e8eff3] transition-all rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading || !form.title || !form.slug}
            className="px-6 py-2.5 text-sm font-bold text-white bg-[var(--yes)] rounded-lg hover:bg-[var(--yes)]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">save</span>
            {loading ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
