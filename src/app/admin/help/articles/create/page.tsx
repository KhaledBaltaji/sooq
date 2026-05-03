// Create article — collection picker pre-fills from ?collection=<id>
// when arriving from the collection edit page.

export const dynamic = "force-dynamic";

import Link from "next/link";
import { asc } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { helpCollections } from "@/lib/db/schema";
import { HelpArticleForm } from "@/components/admin/help-article-form";

export default async function CreateArticlePage({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string }>;
}) {
  const { collection: defaultCollectionId } = await searchParams;

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
        href="/admin/help"
        className="inline-flex items-center gap-1.5 text-sm text-[#566166] hover:text-[#2a3439] transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Help center
      </Link>
      <h2 className="text-3xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
        New article
      </h2>
      {collections.length === 0 ? (
        <p className="text-sm text-[#566166]">
          You need a collection before you can create an article.{" "}
          <Link href="/admin/help/collections/create" className="text-[#2d6cdf] underline">
            Create one first.
          </Link>
        </p>
      ) : (
        <HelpArticleForm
          mode="create"
          collections={collections}
          defaultCollectionId={defaultCollectionId}
        />
      )}
    </div>
  );
}
