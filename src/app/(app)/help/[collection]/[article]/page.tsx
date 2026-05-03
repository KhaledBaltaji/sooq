// /help/[collection]/[article] — single article view. Renders the
// markdown content as preformatted text for now (no react-markdown
// dependency added). Admins can paste plain prose; rich formatting can
// land later.

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { helpCollections, helpArticles } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ collection: string; article: string }>;
}) {
  const { collection: collectionSlug, article: articleSlug } = await params;

  const rows = await db
    .select({
      article: helpArticles,
      collection: helpCollections,
    })
    .from(helpArticles)
    .innerJoin(helpCollections, eq(helpArticles.collectionId, helpCollections.id))
    .where(
      and(
        eq(helpArticles.slug, articleSlug),
        eq(helpCollections.slug, collectionSlug),
        eq(helpArticles.isPublished, true),
        eq(helpCollections.isPublished, true)
      )
    )
    .limit(1);

  if (!rows.length) notFound();
  const { article, collection } = rows[0];

  return (
    <main className="min-h-screen pt-12 pb-24 px-md max-w-[800px] mx-auto">
      <Link
        href={`/help/${collection.slug}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-custom hover:text-text transition-colors mb-8"
      >
        <ChevronLeft className="w-4 h-4 rtl:scale-x-[-1]" />
        {collection.title}
      </Link>

      <article className="space-y-6">
        <h1 className="font-satoshi text-3xl md:text-4xl font-black text-text tracking-tight">
          {article.title}
        </h1>
        <div className="prose-content whitespace-pre-wrap font-dm-sans text-base text-text leading-relaxed">
          {article.content}
        </div>
      </article>
    </main>
  );
}
