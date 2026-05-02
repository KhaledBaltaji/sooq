import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { getHelpIcon } from "@/lib/help-utils";
import { DeleteCollectionButton } from "@/components/admin/delete-help-item";

export default async function AdminHelpPage() {
  const supabase = await createClient();

  const { data: collections } = await supabase
    .from("help_collections")
    .select("*, help_articles(count)")
    .order("sort_order");

  const items = (collections || []).map((c: any) => ({
    ...c,
    article_count: c.help_articles?.[0]?.count || 0,
  }));

  const published = items.filter((c: any) => c.is_published);
  const drafts = items.filter((c: any) => !c.is_published);

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
            Help Center
          </h2>
          <p className="text-[#566166] mt-2 max-w-lg">
            Manage help collections and articles for platform users.
          </p>
        </div>
        <Link
          href="/admin/help/collections/create"
          className="bg-[var(--yes)] hover:bg-[var(--yes)]/90 text-white px-6 py-3 rounded-lg flex items-center gap-2 font-semibold shadow-sm transition-all active:scale-95"
        >
          <span className="material-symbols-outlined text-lg">add</span>
          New Collection
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-[#dae2fd] rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-[#4a5167] text-lg">library_books</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Collections</span>
          </div>
          <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">{items.length}</p>
          <p className="text-xs text-[#566166] mt-1">{published.length} published, {drafts.length} drafts</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-emerald-600 text-lg">article</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">Total Articles</span>
          </div>
          <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] text-[#2a3439]">
            {items.reduce((s: number, c: any) => s + c.article_count, 0)}
          </p>
          <p className="text-xs text-[#566166] mt-1">Across all collections</p>
        </div>

        <div className="bg-[#0b0f10] text-white p-6 rounded-xl relative overflow-hidden">
          <div className="relative z-10">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Status</span>
            <p className="text-2xl font-extrabold font-[family-name:var(--font-manrope)] mt-2">
              {items.length === 0 ? "Empty" : drafts.length > 0 ? "Has Drafts" : "All Live"}
            </p>
            <p className="text-xs text-slate-400 mt-1">Help center content status</p>
          </div>
          <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/5 rounded-full blur-3xl" />
        </div>
      </div>

      {/* Collections Table */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-[#566166] text-lg">folder</span>
          <h3 className="text-sm font-bold uppercase tracking-widest text-[#566166]">Collections</h3>
        </div>

        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          {items.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <span className="material-symbols-outlined text-4xl text-[#a9b4b9] mb-3 block">help_center</span>
              <p className="text-sm font-medium text-[#566166]">No collections yet</p>
              <p className="text-xs text-[#a9b4b9] mt-1">Create your first help collection to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#f0f4f7] text-left">
                    <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest w-10">Icon</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Title</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Slug</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Articles</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest">Status</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-right">Order</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-[#566166] uppercase tracking-widest text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#a9b4b9]/10">
                  {items.map((c: any, i: number) => {
                    const Icon = getHelpIcon(c.icon);
                    return (
                      <tr
                        key={c.id}
                        className={`hover:bg-[#f0f4f7]/50 transition-colors group ${i % 2 === 1 ? "bg-[#f0f4f7]/20" : ""}`}
                      >
                        <td className="px-6 py-5">
                          <div className="w-8 h-8 bg-[#f0f4f7] rounded-lg flex items-center justify-center">
                            <Icon className="w-4 h-4 text-[#566166]" />
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          <Link
                            href={`/admin/help/collections/${c.id}`}
                            className="text-sm font-semibold text-[#2a3439] hover:text-[var(--yes)] transition-colors"
                          >
                            {c.title}
                          </Link>
                        </td>
                        <td className="px-6 py-5 font-mono text-xs text-[#566166]">{c.slug}</td>
                        <td className="px-6 py-5 text-right text-sm tabular-nums text-[#566166]">{c.article_count}</td>
                        <td className="px-6 py-5">
                          <div className={`flex items-center gap-1.5 text-[11px] font-bold ${
                            c.is_published ? "text-emerald-600" : "text-[var(--warning)]"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              c.is_published ? "bg-emerald-500" : "bg-[var(--warning)]"
                            }`} />
                            {c.is_published ? "PUBLISHED" : "DRAFT"}
                          </div>
                        </td>
                        <td className="px-6 py-5 text-right text-sm tabular-nums text-[#566166]">{c.sort_order}</td>
                        <td className="px-6 py-5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Link
                              href={`/admin/help/collections/${c.id}/edit`}
                              className="p-1.5 rounded-lg text-[#a9b4b9] hover:text-[#2a3439] hover:bg-[#e8eff3] transition-all opacity-0 group-hover:opacity-100"
                            >
                              <span className="material-symbols-outlined text-sm">edit</span>
                            </Link>
                            <DeleteCollectionButton id={c.id} type="collection" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
