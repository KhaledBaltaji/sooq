"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createBrowserClient } from "@supabase/ssr";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface EditMarketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  market: {
    id: string;
    question_en: string;
    description_en: string | null;
    description_ar: string | null;
    closes_at: string;
    opens_at: string;
    keywords?: string[];
    image_url?: string | null;
  };
}

export function EditMarketDialog({ open, onOpenChange, market }: EditMarketDialogProps) {
  const router = useRouter();
  const t = useTranslations("toast");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    description_en: market.description_en || "",
    description_ar: market.description_ar || "",
    closes_at: market.closes_at ? new Date(market.closes_at).toISOString().slice(0, 16) : "",
    keywords: (market.keywords || []).join(", "),
    image_url: market.image_url || "",
  });

  useEffect(() => {
    if (open) {
      setForm({
        description_en: market.description_en || "",
        description_ar: market.description_ar || "",
        closes_at: market.closes_at ? new Date(market.closes_at).toISOString().slice(0, 16) : "",
        keywords: (market.keywords || []).join(", "),
        image_url: market.image_url || "",
      });
      setImagePreview(null);
    }
  }, [open, market]);

  const update = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Invalid file type. Use JPG, PNG, or WebP.");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      toast.error("Image too large. Max 5MB.");
      return;
    }

    setUploading(true);
    setImagePreview(URL.createObjectURL(file));

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from("market-images")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (error) {
      toast.error("Image upload failed: " + error.message);
      setImagePreview(null);
      setUploading(false);
      return;
    }

    const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/market-images/${path}`;
    setForm((f) => ({ ...f, image_url: publicUrl }));
    setUploading(false);
  };

  const removeImage = () => {
    setForm((f) => ({ ...f, image_url: "" }));
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const keywords = form.keywords
        ? [...new Set(form.keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean))]
        : [];

      const { error } = await supabase.rpc("admin_update_market", {
        p_market_id: market.id,
        p_description_en: form.description_en || null,
        p_description_ar: form.description_ar || null,
        p_closes_at: form.closes_at ? new Date(form.closes_at).toISOString() : null,
        p_keywords: keywords,
        p_image_url: form.image_url || null,
      });

      if (error) throw error;

      toast.success(t("marketUpdated"));
      onOpenChange(false);
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update market";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white rounded-2xl border-none shadow-2xl max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-manrope)] text-[#2a3439]">
            Edit Market
          </DialogTitle>
          <DialogDescription className="text-[#566166] text-sm">
            Update description, close date, or keywords. Questions cannot be changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Question (read-only) */}
          <div className="bg-[#f0f4f7] rounded-xl p-4">
            <p className="text-[10px] font-bold text-[#566166] uppercase tracking-wider mb-1">Question</p>
            <p className="text-sm font-semibold text-[#2a3439]">{market.question_en}</p>
          </div>

          {/* Description EN */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
              Description (English)
            </label>
            <textarea
              value={form.description_en}
              onChange={(e) => update("description_en", e.target.value)}
              className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all min-h-[80px] placeholder:text-[#a9b4b9]"
              placeholder="Resolution criteria, context..."
              rows={3}
            />
          </div>

          {/* Description AR */}
          <div dir="rtl">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2 text-right">
              الوصف (بالعربية)
            </label>
            <textarea
              value={form.description_ar}
              onChange={(e) => update("description_ar", e.target.value)}
              className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm text-right focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all min-h-[80px] placeholder:text-[#a9b4b9]"
              placeholder="معايير الحل والسياق..."
              rows={3}
            />
          </div>

          {/* Close Date */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
              Close Date/Time
            </label>
            <input
              type="datetime-local"
              value={form.closes_at}
              onChange={(e) => update("closes_at", e.target.value)}
              className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 transition-all"
            />
          </div>

          {/* Keywords */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
              News Feed Keywords
            </label>
            <input
              type="text"
              value={form.keywords}
              onChange={(e) => update("keywords", e.target.value)}
              className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all placeholder:text-[#a9b4b9]"
              placeholder="lebanon, president, election"
            />
            <p className="text-[10px] text-[#a9b4b9] mt-1.5">Comma-separated keywords for RSS news matching.</p>
          </div>

          {/* Cover Image */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
              Cover Image
            </label>
            {imagePreview || form.image_url ? (
              <div className="relative rounded-lg overflow-hidden bg-[#f0f4f7]">
                <div className="relative h-32">
                  <Image
                    src={imagePreview || form.image_url}
                    alt="Market cover preview"
                    fill
                    className="object-cover"
                  />
                  {uploading && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <p className="text-[10px] text-[#566166]">
                    {uploading ? "Uploading..." : "Image set"}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="text-[10px] font-bold text-[var(--yes)] hover:underline disabled:opacity-50"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      onClick={removeImage}
                      disabled={uploading}
                      className="text-[10px] font-bold text-red-500 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-24 rounded-lg border-2 border-dashed border-[#a9b4b9]/40 bg-[#f0f4f7] hover:border-[var(--yes)]/40 hover:bg-[#e8eff3] transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-xl text-[#a9b4b9]">cloud_upload</span>
                <span className="text-xs font-semibold text-[#566166]">Upload cover image</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>
        </div>

        <DialogFooter className="gap-3 pt-2">
          <button
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="px-5 py-2.5 bg-[#f0f4f7] text-[#566166] font-semibold rounded-lg hover:bg-[#e8eff3] transition-all text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-6 py-2.5 bg-[var(--yes)] text-white font-bold rounded-lg hover:opacity-90 transition-all text-sm disabled:opacity-50 flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">save</span>
            {loading ? "Saving..." : "Save Changes"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
