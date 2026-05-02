"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useSupabase } from "@/components/providers/supabase-provider";
import { ArticleRenderer } from "@/components/help/article-renderer";
import { toast } from "sonner";

export default function EditArticlePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const supabase = useSupabase();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [collections, setCollections] = useState<any[]>([]);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [form, setForm] = useState({
    title: "",
    slug: "",
    collection_id: "",
    content: "",
    sort_order: "0",
    is_published: true,
  });

  useEffect(() => {
    async function load() {
      const [{ data: article }, { data: cols }] = await Promise.all([
        supabase.from("help_articles").select("*").eq("id", id).single(),
        supabase.from("help_collections").select("id, title").order("sort_order"),
      ]);

      if (article) {
        setForm({
          title: article.title,
          slug: article.slug,
          collection_id: article.collection_id,
          content: article.content,
          sort_order: String(article.sort_order),
          is_published: article.is_published,
        });
      }
      if (cols) setCollections(cols);
      setFetching(false);
    }
    load();
  }, [id, supabase]);

  const update = (field: string, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase
      .from("help_articles")
      .update({
        title: form.title,
        slug: form.slug,
        collection_id: form.collection_id,
        content: form.content,
        sort_order: parseInt(form.sort_order) || 0,
        is_published: form.is_published,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    toast.success("Article updated");
    router.push(`/admin/help/collections/${form.collection_id}`);
  };

  const selectedCollection = collections.find((c) => c.id === form.collection_id);
  const wordCount = form.content.trim().split(/\s+/).filter(Boolean).length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  if (fetching) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-[#f0f4f7] rounded-lg w-48" />
          <div className="h-12 bg-[#f0f4f7] rounded-lg w-96" />
          <div className="h-64 bg-[#f0f4f7] rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 md:px-12 py-10 max-w-6xl">
      {/* Breadcrumbs & Header */}
      <div className="mb-10">
        <div className="flex items-center gap-2 text-xs font-medium text-[#566166] mb-4 tracking-wider uppercase">
          <Link href="/admin/help" className="hover:text-[var(--yes)] transition-colors">Help Center</Link>
          <span className="material-symbols-outlined text-xs">chevron_right</span>
          {selectedCollection && (
            <>
              <Link href={`/admin/help/collections/${form.collection_id}`} className="hover:text-[var(--yes)] transition-colors">
                {selectedCollection.title}
              </Link>
              <span className="material-symbols-outlined text-xs">chevron_right</span>
            </>
          )}
          <span className="text-[var(--yes)] font-bold">Edit Article</span>
        </div>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Edit Article
        </h2>
        <p className="text-[#566166] mt-2 max-w-2xl">
          {form.title || "Update article content, metadata, and publishing status."}
        </p>
      </div>

      {/* Form Content */}
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-12 gap-8">
          {/* Left: Form Fields */}
          <div className="col-span-12 lg:col-span-8 space-y-8">
            {/* Article Details */}
            <section className="bg-white p-8 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166] mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">info</span>
                Article Details
              </h3>
              <div className="space-y-6">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-[#566166] mb-2">
                    Collection *
                  </label>
                  <div className="relative">
                    <select
                      value={form.collection_id}
                      onChange={(e) => update("collection_id", e.target.value)}
                      className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm appearance-none focus:ring-2 focus:ring-[var(--yes)]/20 transition-all"
                      required
                    >
                      {collections.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[#566166]">expand_more</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
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
                  </div>
                </div>
              </div>
            </section>

            {/* Content Editor */}
            <section className="bg-white p-8 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166] flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg">edit_note</span>
                  Content
                </h3>
                <div className="flex bg-[#f0f4f7] rounded-lg p-1">
                  <button
                    type="button"
                    onClick={() => setTab("write")}
                    className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                      tab === "write"
                        ? "bg-white text-[#2a3439] shadow-sm"
                        : "text-[#566166] hover:text-[#2a3439]"
                    }`}
                  >
                    Write
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("preview")}
                    className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                      tab === "preview"
                        ? "bg-white text-[#2a3439] shadow-sm"
                        : "text-[#566166] hover:text-[#2a3439]"
                    }`}
                  >
                    Preview
                  </button>
                </div>
              </div>

              {tab === "write" ? (
                <div>
                  <textarea
                    value={form.content}
                    onChange={(e) => update("content", e.target.value)}
                    className="w-full bg-[#f0f4f7] border-none rounded-lg px-4 py-3 text-sm font-mono min-h-[400px] resize-y focus:ring-2 focus:ring-[var(--yes)]/20 focus:bg-white transition-all placeholder:text-[#a9b4b9]"
                    rows={20}
                  />
                  <p className="text-[10px] text-[#a9b4b9] mt-2">
                    Supports Markdown: ## Heading, **bold**, *italic*, - lists, [links](url), &gt; blockquotes
                  </p>
                </div>
              ) : (
                <div className="bg-[#f0f4f7] rounded-lg p-6 min-h-[400px]">
                  {form.content ? (
                    <ArticleRenderer content={form.content} />
                  ) : (
                    <p className="text-sm text-[#a9b4b9]">Nothing to preview yet.</p>
                  )}
                </div>
              )}
            </section>

            {/* Publishing */}
            <section className="bg-white p-8 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166] mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">publish</span>
                Publishing
              </h3>
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
            </section>

            {/* Actions */}
            <div className="flex items-center justify-end gap-4 pt-4">
              <Link
                href={`/admin/help/collections/${form.collection_id}`}
                className="px-8 py-3 text-sm font-bold text-[#2a3439] hover:bg-[#e8eff3] transition-all rounded-lg"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading || !form.title || !form.slug}
                className="px-8 py-3 text-sm font-bold text-white bg-[var(--yes)] rounded-lg shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-sm">save</span>
                {loading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>

          {/* Right: Sidebar */}
          <div className="col-span-12 lg:col-span-4 space-y-6">
            {/* Article Stats */}
            <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
              <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#566166] mb-3">Article Stats</h4>
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[#566166]">Words</span>
                  <span className="font-semibold text-[#2a3439] tabular-nums">{wordCount}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#566166]">Est. read time</span>
                  <span className="font-semibold text-[#2a3439]">{readTime} min</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#566166]">Status</span>
                  <span className={`font-semibold ${form.is_published ? "text-emerald-600" : "text-amber-600"}`}>
                    {form.is_published ? "Published" : "Draft"}
                  </span>
                </div>
              </div>
            </div>

            {/* Article Preview */}
            <div className="bg-[#e8eff3] p-6 rounded-xl">
              <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#566166] mb-4">Preview Card</h4>
              <div className="bg-white p-4 rounded-lg">
                <p className="text-sm font-semibold text-[#2a3439]">{form.title || "Article Title"}</p>
                <p className="text-xs text-[#566166] mt-1 line-clamp-3">
                  {form.content
                    ? form.content.replace(/^#{1,6}\s+.*/gm, "").replace(/[*_`#>\-]/g, "").trim().slice(0, 150) + "..."
                    : "No content yet"}
                </p>
                <p className="text-[10px] text-[#a9b4b9] mt-2 font-mono">{form.slug || "article-slug"}</p>
              </div>
            </div>

            {/* Info Card */}
            <div className="relative overflow-hidden bg-[#0b0f10] rounded-xl p-6">
              <div className="relative z-10">
                <p className="text-[10px] text-[#dae2fd] font-bold uppercase tracking-widest mb-2">Markdown Tips</p>
                <div className="text-xs text-slate-300 leading-relaxed space-y-1.5 font-mono">
                  <p>## Heading</p>
                  <p>**bold** *italic*</p>
                  <p>- bullet list</p>
                  <p>1. numbered list</p>
                  <p>[link text](url)</p>
                  <p>&gt; blockquote</p>
                </div>
              </div>
              <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
