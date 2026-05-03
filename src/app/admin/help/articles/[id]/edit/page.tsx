export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { helpArticles, helpCollections } from "@/lib/db/schema";
import { HelpArticleForm } from "@/components/admin/help-article-form";

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const articleRow = await db
    .select()
    .from(helpArticles)
    .where(eq(helpArticles.id, id))
    .limit(1);
  if (!articleRow.length) notFound();
  const a = articleRow[0];

  const collections = await db
    .select({
      id: helpCollections.id,
      title: helpCollections.title,
      slug: helpCollections.slug,
    })
    .from(helpCollections)
    .orderBy(asc(helpCollections.sortOrder));

  return (
    <div className="p-8 space-y-8">
      <Link
        href={`/admin/help/collections/${a.collectionId}/edit`}
        className="inline-flex items-center gap-1.5 text-sm text-[#566166] hover:text-[#2a3439] transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to collection
      </Link>
      <h2 className="text-3xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
        Edit article
      </h2>
      <HelpArticleForm
        mode="edit"
        collections={collections}
        initial={{
          id: a.id,
          collection_id: a.collectionId,
          slug: a.slug,
          title: a.title,
          content: a.content,
          sort_order: a.sortOrder,
          is_published: a.isPublished,
        }}
      />
    </div>
  );
}
