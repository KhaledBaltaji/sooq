import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { HelpArticlesTable } from "@/components/admin/help-articles-table";
import { CollectionDetailClient } from "./collection-detail-client";

export default async function AdminCollectionArticlesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: collection } = await supabase
    .from("help_collections")
    .select("*")
    .eq("id", id)
    .single();

  if (!collection) {
    return (
      <div className="p-8">
        <p className="text-[#566166]">Collection not found</p>
      </div>
    );
  }

  const { data: articles } = await supabase
    .from("help_articles")
    .select("*")
    .eq("collection_id", id)
    .order("sort_order");

  const allArticles = articles || [];
  const published = allArticles.filter((a: any) => a.is_published);
  const drafts = allArticles.filter((a: any) => !a.is_published);
  return (
    <div className="p-8 space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs font-medium text-[#566166] tracking-wider uppercase">
        <Link href="/admin/help" className="hover:text-[var(--yes)] transition-colors">Help Center</Link>
        <span className="material-symbols-outlined text-xs">chevron_right</span>
        <span className="text-[var(--yes)] font-bold">{collection.title}</span>
      </div>

      {/* Header with Edit Dialog */}
      <CollectionDetailClient collection={collection} collectionId={id} />

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-[#dae2fd] rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-[#4a5167] text-lg">article</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Articles</span>
          </div>
          <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">{allArticles.length}</p>
          <p className="text-xs text-[#566166] mt-1">{published.length} published, {drafts.length} drafts</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-emerald-600 text-lg">
                {collection.is_published ? "check_circle" : "edit_note"}
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Status</span>
          </div>
          <div className={`flex items-center gap-1.5 text-lg font-extrabold font-[family-name:var(--font-manrope)] ${
            collection.is_published ? "text-emerald-600" : "text-[var(--warning)]"
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              collection.is_published ? "bg-emerald-500" : "bg-[var(--warning)]"
            }`} />
            {collection.is_published ? "Published" : "Draft"}
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-[#f0f4f7] rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-[#566166] text-lg">link</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Slug</span>
          </div>
          <p className="text-sm font-mono text-[#2a3439] truncate">{collection.slug}</p>
          <p className="text-xs text-[#566166] mt-1">/help/{collection.slug}</p>
        </div>

        <div className="relative overflow-hidden bg-[#0b0f10] text-white p-6 rounded-xl">
          <div className="relative z-10">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Sort Order</span>
            <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] mt-2">
              #{collection.sort_order}
            </p>
            <p className="text-xs text-slate-400 mt-1">Position in help center</p>
          </div>
          <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
        </div>
      </div>

      {/* Articles Table */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-[#566166] text-lg">description</span>
          <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166]">Articles</h3>
        </div>

        <HelpArticlesTable articles={allArticles} collectionId={id} />
      </section>
    </div>
  );
}
