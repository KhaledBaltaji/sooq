// Edit a collection — also lists its articles with create/edit/delete
// shortcuts. Mirrors the prediction-market collection-detail flow.

export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { ChevronLeft, Plus, Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { helpArticles, helpCollections } from "@/lib/db/schema";
import { HelpCollectionForm } from "@/components/admin/help-collection-form";
import { DeleteArticleButton } from "@/components/admin/delete-help-item";

export default async function EditCollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const collection = await db
    .select()
    .from(helpCollections)
    .where(eq(helpCollections.id, id))
    .limit(1);
  if (!collection.length) notFound();

  const articles = await db
    .select()
    .from(helpArticles)
    .where(eq(helpArticles.collectionId, id))
    .orderBy(asc(helpArticles.sortOrder));

  const c = collection[0];

  return (
    <div className="p-8 space-y-12">
      <Link
        href="/admin/help"
        className="inline-flex items-center gap-1.5 text-sm text-[#566166] hover:text-[#2a3439] transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Help center
      </Link>

      <section className="space-y-4">
        <h2 className="text-3xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Edit collection
        </h2>
        <HelpCollectionForm
          mode="edit"
          initial={{
            id: c.id,
            slug: c.slug,
            title: c.title,
            description: c.description,
            icon: c.icon,
            locale: c.locale,
            sort_order: c.sortOrder,
            is_published: c.isPublished,
          }}
        />
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-[#2a3439]">
            Articles ({articles.length})
          </h3>
          <Link
            href={`/admin/help/articles/create?collection=${c.id}`}
            className="bg-[#2d6cdf] hover:bg-[#2d6cdf]/90 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-semibold"
          >
            <Plus className="w-4 h-4" />
            New article
          </Link>
        </div>
        <div className="bg-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] divide-y divide-[#e9ecef]">
          {articles.length === 0 && (
            <div className="p-6 text-center text-sm text-[#566166]">
              No articles yet.
            </div>
          )}
          {articles.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-4 p-4 hover:bg-[#fafbfc]"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-semibold text-[#2a3439]">{a.title}</h4>
                  <span
                    className={
                      a.isPublished
                        ? "text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded"
                        : "text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded"
                    }
                  >
                    {a.isPublished ? "Published" : "Draft"}
                  </span>
                </div>
                <div className="text-xs text-[#566166] mt-0.5 font-mono">
                  /{c.slug}/{a.slug}
                </div>
              </div>
              <Link
                href={`/admin/help/articles/${a.id}/edit`}
                className="p-2 rounded-md text-[#717c82] hover:text-[#2a3439] hover:bg-[#f0f4f7]"
                aria-label="Edit"
              >
                <Pencil className="w-4 h-4" />
              </Link>
              <DeleteArticleButton id={a.id} title={a.title} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
