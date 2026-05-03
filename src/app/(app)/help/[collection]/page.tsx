// /help/[collection] — single collection landing showing its articles
// list. Server-rendered via Drizzle. Article click → /help/[c]/[a].

import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { helpCollections, helpArticles } from "@/lib/db/schema";
import { getHelpIcon, extractPreview } from "@/lib/help-utils";

export const dynamic = "force-dynamic";

export default async function HelpCollectionPage({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection: slug } = await params;

  const collectionRow = await db
    .select()
    .from(helpCollections)
    .where(
      and(eq(helpCollections.slug, slug), eq(helpCollections.isPublished, true))
    )
    .limit(1);

  if (!collectionRow.length) notFound();

  const c = collectionRow[0];
  const articles = await db
    .select()
    .from(helpArticles)
    .where(
      and(
        eq(helpArticles.collectionId, c.id),
        eq(helpArticles.isPublished, true)
      )
    )
    .orderBy(asc(helpArticles.sortOrder));

  const Icon = getHelpIcon(c.icon);

  return (
    <main className="min-h-screen pt-12 pb-24 px-md max-w-[900px] mx-auto">
      <Link
        href="/help"
        className="inline-flex items-center gap-1.5 text-sm text-muted-custom hover:text-text transition-colors mb-8"
      >
        <ChevronLeft className="w-4 h-4 rtl:scale-x-[-1]" />
        Back to help
      </Link>

      <header className="flex flex-col items-start gap-4 mb-12">
        <div className="w-12 h-12 rounded-xl bg-yes/10 flex items-center justify-center">
          <Icon className="w-6 h-6 text-yes" />
        </div>
        <div>
          <h1 className="font-satoshi text-3xl md:text-4xl font-black text-text tracking-tight mb-2">
            {c.title}
          </h1>
          {c.description && (
            <p className="text-sm text-muted-custom max-w-2xl">{c.description}</p>
          )}
        </div>
      </header>

      {articles.length > 0 ? (
        <section className="flex flex-col gap-3">
          {articles.map((a) => (
            <Link
              key={a.id}
              href={`/help/${c.slug}/${a.slug}`}
              className="block bg-surface border border-border-custom p-5 rounded-xl hover:bg-elevated transition-all"
            >
              <h2 className="font-satoshi text-base font-bold text-text mb-1">
                {a.title}
              </h2>
              {a.content && (
                <p className="font-dm-sans text-sm text-muted-custom line-clamp-2">
                  {extractPreview(a.content, 200)}
                </p>
              )}
            </Link>
          ))}
        </section>
      ) : (
        <p className="text-sm text-muted-custom">
          No articles in this collection yet.
        </p>
      )}
    </main>
  );
}
