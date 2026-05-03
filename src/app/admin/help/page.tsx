// Admin help center — list collections with article counts.
// Server-side fetch, then a small client component for the delete control
// per row (admin can publish/unpublish via inline toggle later).

export const dynamic = "force-dynamic";

import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { Plus, Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { helpArticles, helpCollections } from "@/lib/db/schema";
import { getHelpIcon } from "@/lib/help-utils";
import { DeleteCollectionButton } from "@/components/admin/delete-help-item";

export default async function AdminHelpPage() {
  const rows = await db
    .select({
      id: helpCollections.id,
      slug: helpCollections.slug,
      title: helpCollections.title,
      description: helpCollections.description,
      icon: helpCollections.icon,
      locale: helpCollections.locale,
      sortOrder: helpCollections.sortOrder,
      isPublished: helpCollections.isPublished,
      articleCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${helpArticles}
        WHERE ${helpArticles.collectionId} = ${helpCollections.id}
      )`,
    })
    .from(helpCollections)
    .orderBy(asc(helpCollections.sortOrder));

  const published = rows.filter((r) => r.isPublished);
  const drafts = rows.filter((r) => !r.isPublished);

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
            Help Center
          </h2>
          <p className="text-[#566166] mt-2 max-w-lg">
            Manage the public knowledge base. Collections group related
            articles; articles render at <code>/help/[collection]/[article]</code>.
          </p>
        </div>
        <Link
          href="/admin/help/collections/create"
          className="bg-[#2d6cdf] hover:bg-[#2d6cdf]/90 text-white px-6 py-3 rounded-lg flex items-center gap-2 font-semibold shadow-sm transition-all active:scale-95"
        >
          <Plus className="w-4 h-4" />
          New Collection
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Stat label="Collections" value={rows.length} />
        <Stat label="Published" value={published.length} />
        <Stat label="Drafts" value={drafts.length} />
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] divide-y divide-[#e9ecef]">
        {rows.length === 0 && (
          <div className="p-8 text-center text-[#566166]">
            No collections yet. Click <strong>New Collection</strong> to create one.
          </div>
        )}
        {rows.map((c) => {
          const Icon = getHelpIcon(c.icon);
          return (
            <div
              key={c.id}
              className="flex items-center gap-4 p-5 hover:bg-[#fafbfc]"
            >
              <div className="w-10 h-10 rounded-lg bg-[#dae2fd] flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-[#4a5167]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-[#2a3439]">{c.title}</h3>
                  <span
                    className={
                      c.isPublished
                        ? "text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded"
                        : "text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded"
                    }
                  >
                    {c.isPublished ? "Published" : "Draft"}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-[#717c82]">
                    {c.locale}
                  </span>
                </div>
                <div className="text-sm text-[#566166] mt-0.5">
                  /{c.slug} · {Number(c.articleCount ?? 0)} article
                  {Number(c.articleCount ?? 0) === 1 ? "" : "s"}
                </div>
              </div>
              <Link
                href={`/admin/help/collections/${c.id}/edit`}
                className="p-2 rounded-md text-[#717c82] hover:text-[#2a3439] hover:bg-[#f0f4f7] transition-colors"
                aria-label="Edit"
              >
                <Pencil className="w-4 h-4" />
              </Link>
              <DeleteCollectionButton id={c.id} title={c.title} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white p-6 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
      <span className="text-[10px] font-bold uppercase tracking-widest text-[#566166]">
        {label}
      </span>
      <div className="text-3xl font-extrabold text-[#2a3439] tabular-nums mt-2">
        {value}
      </div>
    </div>
  );
}
