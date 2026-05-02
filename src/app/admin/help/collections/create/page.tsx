"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSupabase } from "@/components/providers/supabase-provider";
import { IconPicker } from "@/components/admin/icon-picker";
import { slugify } from "@/lib/help-utils";
import { toast } from "sonner";

export default function CreateCollectionPage() {
  const router = useRouter();
  const supabase = useSupabase();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: "",
    slug: "",
    description: "",
    icon: "help-circle",
    sort_order: "0",
    is_published: true,
  });

  const update = (field: string, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleTitleChange = (value: string) => {
    update("title", value);
    update("slug", slugify(value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from("help_collections").insert({
      title: form.title,
      slug: form.slug,
      description: form.description || null,
      icon: form.icon,
      sort_order: parseInt(form.sort_order) || 0,
      is_published: form.is_published,
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    toast.success("Collection created");
    router.push("/admin/help");
  };

  const hasTitle = form.title.length > 0;
  const hasSlug = form.slug.length > 0;
  const hasIcon = form.icon !== "help-circle";

  return (
    <div className="px-8 md:px-12 py-10 max-w-5xl">
      {/* Breadcrumbs & Header */}
      <div className="mb-10">
        <div className="flex items-center gap-2 text-xs font-medium text-[#566166] mb-4 tracking-wider uppercase">
          <Link href="/admin/help" className="hover:text-[var(--yes)] transition-colors">Help Center</Link>
          <span className="material-symbols-outlined text-xs">chevron_right</span>
          <span className="text-[var(--yes)] font-bold">New Collection</span>
        </div>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Create Collection
        </h2>
        <p className="text-[#566166] mt-2 max-w-2xl">
          Organize help articles into a themed collection for users to browse.
        </p>
      </div>

      {/* Form Content */}
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-12 gap-8">
          {/* Left: Form Fields */}
          <div className="col-span-12 lg:col-span-8 space-y-8">
            {/* Collection Details */}
            <section className="bg-white p-8 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166] mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">info</span>
                Collection Details
              </h3>
              <div className="space-y-6">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
                    Title *
                  </label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all placeholder:text-[#a9b4b9]"
                    placeholder="Getting Started"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
                    Slug *
                  </label>
                  <input
                    type="text"
                    value={form.slug}
                    onChange={(e) => update("slug", e.target.value)}
                    className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all placeholder:text-[#a9b4b9]"
                    placeholder="getting-started"
                    required
                  />
                  <p className="text-[10px] text-[#a9b4b9] mt-1.5">URL: /help/{form.slug || "..."}</p>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
                    Description
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(e) => update("description", e.target.value)}
                    className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all min-h-[80px] placeholder:text-[#a9b4b9]"
                    placeholder="Brief description of what this collection covers..."
                    rows={3}
                  />
                </div>
              </div>
            </section>

            {/* Display & Ordering */}
            <section className="bg-white p-8 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166] mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">palette</span>
                Display & Ordering
              </h3>
              <div className="space-y-6">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
                    Icon
                  </label>
                  <IconPicker value={form.icon} onChange={(v) => update("icon", v)} />
                </div>

                <div className="grid grid-cols-2 gap-6">
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
            </section>

            {/* Actions */}
            <div className="flex items-center justify-end gap-4 pt-4">
              <Link
                href="/admin/help"
                className="px-8 py-3 text-sm font-bold text-[#2a3439] hover:bg-[#e8eff3] transition-all rounded-lg"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading || !hasTitle || !hasSlug}
                className="px-8 py-3 text-sm font-bold text-white bg-[var(--yes)] rounded-lg shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-sm">add</span>
                {loading ? "Creating..." : "Create Collection"}
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
                    className={`material-symbols-outlined text-lg ${hasTitle ? "text-[var(--yes)]" : "text-[#a9b4b9]"}`}
                    style={hasTitle ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {hasTitle ? "check_circle" : "radio_button_unchecked"}
                  </span>
                  <div className="text-xs">
                    <p className="font-bold text-[#2a3439]">Title Defined</p>
                    <p className="text-[#566166] mt-1 leading-relaxed">A clear, descriptive collection title.</p>
                  </div>
                </li>
                <li className="flex gap-3 items-start">
                  <span
                    className={`material-symbols-outlined text-lg ${hasSlug ? "text-[var(--yes)]" : "text-[#a9b4b9]"}`}
                    style={hasSlug ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {hasSlug ? "check_circle" : "radio_button_unchecked"}
                  </span>
                  <div className="text-xs">
                    <p className="font-bold text-[#2a3439]">Slug Set</p>
                    <p className="text-[#566166] mt-1 leading-relaxed">URL-friendly identifier for the collection.</p>
                  </div>
                </li>
                <li className="flex gap-3 items-start">
                  <span
                    className={`material-symbols-outlined text-lg ${hasIcon ? "text-[var(--yes)]" : "text-[#a9b4b9]"}`}
                    style={hasIcon ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    {hasIcon ? "check_circle" : "radio_button_unchecked"}
                  </span>
                  <div className="text-xs">
                    <p className="font-bold text-[#2a3439]">Icon Selected</p>
                    <p className="text-[#566166] mt-1 leading-relaxed">Choose an icon that represents the collection topic.</p>
                  </div>
                </li>
              </ul>
            </div>

            {/* Info Card */}
            <div className="relative overflow-hidden bg-[#0b0f10] rounded-xl p-6">
              <div className="relative z-10">
                <p className="text-[10px] text-[#dae2fd] font-bold uppercase tracking-widest mb-2">Help Center Tip</p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Collections group related articles together. Use clear, descriptive titles that help users find what they need quickly.
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
