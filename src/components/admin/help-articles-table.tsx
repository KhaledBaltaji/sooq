"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSupabase } from "@/components/providers/supabase-provider";
import { toast } from "sonner";
import type { HelpArticle } from "@/types/help";

interface HelpArticlesTableProps {
  articles: HelpArticle[];
  collectionId: string;
}

export function HelpArticlesTable({ articles: initialArticles, collectionId }: HelpArticlesTableProps) {
  const supabase = useSupabase();
  const router = useRouter();
  const [articles, setArticles] = useState(initialArticles);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const togglePublish = async (article: HelpArticle) => {
    setTogglingId(article.id);
    const newStatus = !article.is_published;
    setArticles((prev) =>
      prev.map((a) => (a.id === article.id ? { ...a, is_published: newStatus } : a))
    );

    const { error } = await supabase
      .from("help_articles")
      .update({ is_published: newStatus, updated_at: new Date().toISOString() })
      .eq("id", article.id);

    if (error) {
      toast.error(error.message);
      setArticles((prev) =>
        prev.map((a) => (a.id === article.id ? { ...a, is_published: !newStatus } : a))
      );
    }
    setTogglingId(null);
  };

  const moveArticle = async (article: HelpArticle, direction: "up" | "down") => {
    const sorted = [...articles].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((a) => a.id === article.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const other = sorted[swapIdx];
    const newOrder = other.sort_order;
    const otherNewOrder = article.sort_order;

    setArticles((prev) =>
      prev.map((a) => {
        if (a.id === article.id) return { ...a, sort_order: newOrder };
        if (a.id === other.id) return { ...a, sort_order: otherNewOrder };
        return a;
      })
    );

    const [r1, r2] = await Promise.all([
      supabase.from("help_articles").update({ sort_order: newOrder }).eq("id", article.id),
      supabase.from("help_articles").update({ sort_order: otherNewOrder }).eq("id", other.id),
    ]);

    if (r1.error || r2.error) {
      toast.error("Failed to reorder");
      router.refresh();
    }
  };

  const deleteArticle = async (id: string) => {
    const { error } = await supabase.from("help_articles").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      setArticles((prev) => prev.filter((a) => a.id !== id));
      toast.success("Article deleted");
    }
    setDeletingId(null);
  };

  const sorted = [...articles].sort((a, b) => a.sort_order - b.sort_order);

  if (sorted.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="px-6 py-16 text-center">
          <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">article</span>
          <p className="text-sm font-medium text-[#566166]">No articles yet</p>
          <p className="text-xs text-[#a9b4b9] mt-1">Create your first article in this collection</p>
          <Link
            href={`/admin/help/articles/create?collection=${collectionId}`}
            className="inline-flex items-center gap-2 mt-4 px-5 py-2.5 bg-[var(--yes)] text-white text-sm font-semibold rounded-lg hover:bg-[var(--yes)]/90 transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            New Article
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#f0f4f7] text-left">
              <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest w-10">#</th>
              <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Title</th>
              <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Slug</th>
              <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Status</th>
              <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Updated</th>
              <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#a9b4b9]/10">
            {sorted.map((article, i) => (
              <tr
                key={article.id}
                className={`hover:bg-[#f0f4f7]/50 transition-colors group ${i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""}`}
              >
                <td className="px-6 py-5 text-sm tabular-nums text-[#566166]">{article.sort_order}</td>
                <td className="px-6 py-5">
                  <Link
                    href={`/admin/help/articles/${article.id}/edit`}
                    className="text-sm font-semibold text-[#2a3439] hover:text-[var(--yes)] transition-colors"
                  >
                    {article.title}
                  </Link>
                </td>
                <td className="px-6 py-5 font-mono text-xs text-[#566166]">{article.slug}</td>
                <td className="px-6 py-5">
                  <button
                    onClick={() => togglePublish(article)}
                    disabled={togglingId === article.id}
                    className={`flex items-center gap-1.5 text-[11px] font-bold transition-colors ${
                      article.is_published ? "text-emerald-600 hover:text-emerald-700" : "text-[var(--warning)] hover:text-amber-600"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      article.is_published ? "bg-emerald-500" : "bg-[var(--warning)]"
                    }`} />
                    {article.is_published ? "PUBLISHED" : "DRAFT"}
                  </button>
                </td>
                <td className="px-6 py-5 text-xs text-[#566166]">
                  {new Date(article.updated_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-5">
                  <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* Move up */}
                    <button
                      onClick={() => moveArticle(article, "up")}
                      disabled={i === 0}
                      className="p-1.5 rounded-lg text-[#a9b4b9] hover:text-[#2a3439] hover:bg-[#e8eff3] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move up"
                    >
                      <span className="material-symbols-outlined text-sm">arrow_upward</span>
                    </button>
                    {/* Move down */}
                    <button
                      onClick={() => moveArticle(article, "down")}
                      disabled={i === sorted.length - 1}
                      className="p-1.5 rounded-lg text-[#a9b4b9] hover:text-[#2a3439] hover:bg-[#e8eff3] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move down"
                    >
                      <span className="material-symbols-outlined text-sm">arrow_downward</span>
                    </button>
                    {/* Edit */}
                    <Link
                      href={`/admin/help/articles/${article.id}/edit`}
                      className="p-1.5 rounded-lg text-[#a9b4b9] hover:text-[#2a3439] hover:bg-[#e8eff3] transition-all"
                      title="Edit"
                    >
                      <span className="material-symbols-outlined text-sm">edit</span>
                    </Link>
                    {/* Delete */}
                    {deletingId === article.id ? (
                      <div className="flex items-center gap-2 ml-1">
                        <button
                          onClick={() => deleteArticle(article.id)}
                          className="text-xs font-semibold text-red-500 hover:underline"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="text-xs text-[#566166] hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeletingId(article.id)}
                        className="p-1.5 rounded-lg text-[#a9b4b9] hover:text-red-500 hover:bg-red-50 transition-all"
                        title="Delete"
                      >
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
