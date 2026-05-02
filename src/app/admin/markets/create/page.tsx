"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useSupabase } from "@/components/providers/supabase-provider";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

const CATEGORIES = [
  { value: "politics", label: "Politics" },
  { value: "economy", label: "Economy" },
  { value: "sports", label: "Sports" },
  { value: "tech", label: "Tech" },
  { value: "entertainment", label: "Entertainment" },
  { value: "other", label: "Other" },
];

export default function CreateMarketPage() {
  const router = useRouter();
  const supabase = useSupabase();
  const t = useTranslations("toast");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    question_en: "",
    question_ar: "",
    description_en: "",
    description_ar: "",
    category: "politics",
    liquidity_param: "1000",
    opening_price: "0.50",
    opens_at: "",
    closes_at: "",
    image_url: "",
    is_demo: false,
    scheduled_outcome: "yes",
    resolves_at: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (form.is_demo) {
      if (!form.resolves_at) {
        toast.error("Demo markets require a resolves_at time.");
        setLoading(false);
        return;
      }
      const { error } = await supabase.rpc("admin_create_demo_market" as never, {
        p_question_en: form.question_en,
        p_question_ar: form.question_ar,
        p_description_en: form.description_en || null,
        p_description_ar: form.description_ar || null,
        p_category: form.category,
        p_keywords: [],
        p_liquidity_param: parseFloat(form.liquidity_param || "5000"),
        p_opens_at: form.opens_at || new Date().toISOString(),
        p_closes_at: form.closes_at || form.resolves_at,
        p_scheduled_outcome: form.scheduled_outcome,
        p_resolves_at: form.resolves_at,
        p_image_url: form.image_url || null,
      } as never);

      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }

      toast.success(t("marketCreated"));
      router.push("/admin/markets");
      setLoading(false);
      return;
    }

    const { error } = await supabase.rpc("admin_create_market", {
      p_question_en: form.question_en,
      p_question_ar: form.question_ar,
      p_description_en: form.description_en || null,
      p_description_ar: form.description_ar || null,
      p_category: form.category,
      p_keywords: [],
      p_liquidity_param: parseFloat(form.liquidity_param),
      p_opens_at: form.opens_at || new Date().toISOString(),
      p_closes_at: form.closes_at,
      p_image_url: form.image_url || null,
      p_opening_price: parseFloat(form.opening_price),
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    toast.success(t("marketCreated"));
    router.push("/admin/markets");
    setLoading(false);
  };

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

  const update = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const hasQuestion = form.question_en.length > 0 && form.question_ar.length > 0;
  const hasCloseDate = form.is_demo ? form.resolves_at.length > 0 : form.closes_at.length > 0;
  const hasImage = form.image_url.length > 0;

  return (
    <div className="px-8 md:px-12 py-10 max-w-5xl">
      {/* Breadcrumbs & Header */}
      <div className="mb-10">
        <div className="flex items-center gap-2 text-xs font-medium text-[#566166] mb-4 tracking-wider uppercase">
          <Link href="/admin/markets" className="hover:text-[var(--yes)] transition-colors">Markets</Link>
          <span className="material-symbols-outlined text-xs">chevron_right</span>
          <span className="text-[var(--yes)] font-bold">Initialize New Market</span>
        </div>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Create Market
        </h2>
        <p className="text-[#566166] mt-2 max-w-2xl">
          Configure a new prediction market. Ensure all parameters and liquidity bounds are accurately defined before initialization.
        </p>
      </div>

      {/* Form Content */}
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-12 gap-8">
          {/* Left: Form Fields */}
          <div className="col-span-12 lg:col-span-8 space-y-8">
            {/* Localization & Definition */}
            <section className="bg-white p-8 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166] mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">translate</span>
                Localization & Definition
              </h3>
              <div className="space-y-6">
                {/* Question English */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
                    Question (English) *
                  </label>
                  <input
                    type="text"
                    value={form.question_en}
                    onChange={(e) => update("question_en", e.target.value)}
                    className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all placeholder:text-[#a9b4b9]"
                    placeholder="Will Lebanon hold elections by 2027?"
                    required
                  />
                </div>
                {/* Question Arabic */}
                <div dir="rtl">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2 text-right">
                    السؤال (بالعربية) *
                  </label>
                  <input
                    type="text"
                    value={form.question_ar}
                    onChange={(e) => update("question_ar", e.target.value)}
                    className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm text-right focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all placeholder:text-[#a9b4b9]"
                    placeholder="هل ستجري لبنان انتخابات بحلول ٢٠٢٧؟"
                    required
                  />
                </div>
                {/* Description EN */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
                    Description (English)
                  </label>
                  <textarea
                    value={form.description_en}
                    onChange={(e) => update("description_en", e.target.value)}
                    className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all min-h-[100px] placeholder:text-[#a9b4b9]"
                    placeholder="Resolution criteria, context, and edge case handling..."
                    rows={4}
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
                    className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm text-right focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all min-h-[100px] placeholder:text-[#a9b4b9]"
                    placeholder="معايير الحل والسياق..."
                    rows={4}
                    dir="rtl"
                  />
                </div>
              </div>
            </section>

            {/* Market Image */}
            <section className="bg-white p-8 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166] mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">image</span>
                Cover Image
              </h3>

              {imagePreview || form.image_url ? (
                <div className="relative rounded-lg overflow-hidden bg-[#f0f4f7]">
                  <div className="relative h-48">
                    <Image
                      src={imagePreview || form.image_url}
                      alt="Market cover preview"
                      fill
                      className="object-cover"
                    />
                    {uploading && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between px-4 py-3">
                    <p className="text-xs text-[#566166] truncate max-w-[200px]">
                      {uploading ? "Uploading..." : "Image uploaded"}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="text-xs font-bold text-[var(--yes)] hover:underline disabled:opacity-50"
                      >
                        Change
                      </button>
                      <button
                        type="button"
                        onClick={removeImage}
                        disabled={uploading}
                        className="text-xs font-bold text-red-500 hover:underline disabled:opacity-50"
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
                  className="w-full h-48 rounded-lg border-2 border-dashed border-[#a9b4b9]/40 bg-[#f0f4f7] hover:border-[var(--yes)]/40 hover:bg-[#e8eff3] transition-all flex flex-col items-center justify-center gap-3"
                >
                  <span className="material-symbols-outlined text-3xl text-[#a9b4b9]">cloud_upload</span>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-[#566166]">Upload cover image</p>
                    <p className="text-[10px] text-[#a9b4b9] mt-1">JPG, PNG, or WebP. Max 5MB. Recommended: 1200 x 630px</p>
                  </div>
                </button>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleImageUpload}
                className="hidden"
              />
            </section>

            {/* Market Parameters */}
            <section className="bg-white p-8 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166] mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">settings_input_component</span>
                Market Parameters
              </h3>
              <div className="grid grid-cols-2 gap-6">
                {/* Category */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">Category</label>
                  <div className="relative">
                    <select
                      value={form.category}
                      onChange={(e) => update("category", e.target.value)}
                      className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm appearance-none focus:ring-2 focus:ring-[var(--yes)]/20 transition-all"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[#566166]">expand_more</span>
                  </div>
                </div>
                {/* Liquidity */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">Liquidity Parameter (b)</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={form.liquidity_param}
                      onChange={(e) => update("liquidity_param", e.target.value)}
                      min="100"
                      max="100000"
                      className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 transition-all"
                      placeholder="1000"
                      required
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#566166] uppercase">USDC</span>
                  </div>
                </div>
              </div>

              {/* Opening Price */}
              <div className="mt-6">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
                  Opening Price (YES)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={form.opening_price}
                    onChange={(e) => update("opening_price", e.target.value)}
                    min="0.05"
                    max="0.95"
                    step="0.01"
                    className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 transition-all"
                    placeholder="0.50"
                    required
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#566166] uppercase">YES</span>
                </div>
                {(() => {
                  const p = parseFloat(form.opening_price);
                  const b = parseFloat(form.liquidity_param) || 1000;
                  if (isNaN(p) || p < 0.05 || p > 0.95) {
                    return (
                      <p className="text-[10px] text-red-500 mt-1.5 font-medium">
                        Opening price must be between 0.05 and 0.95.
                      </p>
                    );
                  }
                  if (p === 0.5) {
                    return (
                      <p className="text-[10px] text-[#a9b4b9] mt-1.5">
                        Classic 50/50 start. No pre-mint, no seed exposure.
                      </p>
                    );
                  }
                  const side = p >= 0.5 ? "YES" : "NO";
                  const shares = p >= 0.5
                    ? b * Math.log(p / (1 - p))
                    : b * Math.log((1 - p) / p);
                  const seedCost = p >= 0.5
                    ? -b * Math.log(2 * (1 - p))
                    : -b * Math.log(2 * p);
                  return (
                    <p className="text-[10px] text-[#566166] mt-1.5">
                      Pre-mints <span className="font-bold text-[#2a3439]">{shares.toFixed(0)} {side}</span> shares.
                      Operator capital at risk if market resolves opposite: <span className="font-bold text-amber-700">${seedCost.toFixed(0)}</span>.
                      Set this to your honest estimate, not a target.
                    </p>
                  );
                })()}
              </div>
            </section>

            {/* Temporal Configuration */}
            <section className="bg-white p-8 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166] mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">schedule</span>
                Temporal Configuration
              </h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">Market Open Date/Time</label>
                  <input
                    type="datetime-local"
                    value={form.opens_at}
                    onChange={(e) => update("opens_at", e.target.value)}
                    className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">Market Close Date/Time *</label>
                  <input
                    type="datetime-local"
                    value={form.closes_at}
                    onChange={(e) => update("closes_at", e.target.value)}
                    className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 transition-all"
                    required={!form.is_demo}
                  />
                </div>
              </div>
            </section>

            {/* Demo Market */}
            <section className="bg-white p-8 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166] mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">science</span>
                Demo Market
              </h3>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_demo}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      is_demo: e.target.checked,
                      // Bump default liquidity to 5000 for demo
                      liquidity_param: e.target.checked ? "5000" : "1000",
                    }))
                  }
                  className="w-4 h-4 accent-amber-500"
                />
                <span className="text-sm font-semibold text-[#2a3439]">
                  Create as demo market (sandbox, auto-resolves via cron)
                </span>
              </label>

              {form.is_demo && (
                <div className="mt-6 grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
                      Scheduled Outcome *
                    </label>
                    <div className="relative">
                      <select
                        value={form.scheduled_outcome}
                        onChange={(e) => update("scheduled_outcome", e.target.value)}
                        className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm appearance-none focus:ring-2 focus:ring-amber-500/20 transition-all"
                      >
                        <option value="yes">YES</option>
                        <option value="no">NO</option>
                      </select>
                      <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[#566166]">
                        expand_more
                      </span>
                    </div>
                    <p className="text-[10px] text-[#a9b4b9] mt-1.5">
                      Admin-only; never visible to users. Cron resolves the market using this value.
                    </p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
                      Resolves At *
                    </label>
                    <input
                      type="datetime-local"
                      value={form.resolves_at}
                      onChange={(e) => update("resolves_at", e.target.value)}
                      className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-amber-500/20 transition-all"
                      required
                    />
                    <p className="text-[10px] text-[#a9b4b9] mt-1.5">
                      When the hourly cron should auto-resolve this market.
                    </p>
                  </div>
                </div>
              )}
            </section>

            {/* Actions */}
            <div className="flex items-center justify-end gap-4 pt-4">
              <Link
                href="/admin/markets"
                className="px-8 py-3 text-sm font-bold text-[#2a3439] hover:bg-[#e8eff3] transition-all rounded-lg"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading || !hasQuestion || !hasCloseDate}
                className="px-8 py-3 text-sm font-bold text-white bg-[var(--yes)] rounded-lg shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                {loading ? "Creating..." : "Create Market"}
              </button>
            </div>
          </div>

          {/* Right: Helper Sidebar */}
          <div className="col-span-12 lg:col-span-4 space-y-6">
            {/* Verification Checklist */}
            <div className="bg-[#e8eff3] p-6 rounded-xl">
              <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#566166] mb-4">Verification Checklist</h4>
              <ul className="space-y-4">
                <li className="flex gap-3 items-start">
                  <span
                    className={`material-symbols-outlined text-lg ${hasQuestion ? "text-[var(--yes)]" : "text-[#a9b4b9]"}`}
                    style={hasQuestion ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {hasQuestion ? "check_circle" : "radio_button_unchecked"}
                  </span>
                  <div className="text-xs">
                    <p className="font-bold text-[#2a3439]">Questions Defined</p>
                    <p className="text-[#566166] mt-1 leading-relaxed">Both English and Arabic market questions are required.</p>
                  </div>
                </li>
                <li className="flex gap-3 items-start">
                  <span
                    className={`material-symbols-outlined text-lg ${hasCloseDate ? "text-[var(--yes)]" : "text-[#a9b4b9]"}`}
                    style={hasCloseDate ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {hasCloseDate ? "check_circle" : "radio_button_unchecked"}
                  </span>
                  <div className="text-xs">
                    <p className="font-bold text-[#2a3439]">Close Date Set</p>
                    <p className="text-[#566166] mt-1 leading-relaxed">Market close date determines when trading ends.</p>
                  </div>
                </li>
                <li className="flex gap-3 items-start">
                  <span
                    className={`material-symbols-outlined text-lg ${parseFloat(form.liquidity_param) >= 100 ? "text-[var(--yes)]" : "text-[#a9b4b9]"}`}
                    style={parseFloat(form.liquidity_param) >= 100 ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {parseFloat(form.liquidity_param) >= 100 ? "check_circle" : "radio_button_unchecked"}
                  </span>
                  <div className="text-xs">
                    <p className="font-bold text-[#2a3439]">Liquidity Depth</p>
                    <p className="text-[#566166] mt-1 leading-relaxed">Ensure sufficient liquidity parameter (min 100) for stable pricing.</p>
                  </div>
                </li>
                <li className="flex gap-3 items-start">
                  <span
                    className={`material-symbols-outlined text-lg ${hasImage ? "text-[var(--yes)]" : "text-[#a9b4b9]"}`}
                    style={hasImage ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {hasImage ? "check_circle" : "radio_button_unchecked"}
                  </span>
                  <div className="text-xs">
                    <p className="font-bold text-[#2a3439]">Cover Image</p>
                    <p className="text-[#566166] mt-1 leading-relaxed">Optional. Replaces the default gradient on market cards.</p>
                  </div>
                </li>
              </ul>
            </div>

            {/* Info Card */}
            <div className="relative overflow-hidden bg-[#0b0f10] rounded-xl p-6">
              <div className="relative z-10">
                <p className="text-[10px] text-[#dae2fd] font-bold uppercase tracking-widest mb-2">Market Insight</p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Higher liquidity parameters (b) ensure lower price impact but require more initial capital. Default of 1000 is suitable for most markets.
                </p>
              </div>
              <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
