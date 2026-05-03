// GET /api/help/articles/[slug] — single article + its parent collection.
// Public; only returns published articles in published collections.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { helpCollections, helpArticles } from "@/lib/db/schema";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const url = new URL(req.url);
  const collectionSlug = url.searchParams.get("collection");

  if (!collectionSlug) {
    return NextResponse.json(
      { error: "?collection=<slug> query param is required" },
      { status: 400 }
    );
  }

  const rows = await db
    .select({
      article: helpArticles,
      collection: helpCollections,
    })
    .from(helpArticles)
    .innerJoin(helpCollections, eq(helpArticles.collectionId, helpCollections.id))
    .where(
      and(
        eq(helpArticles.slug, slug),
        eq(helpCollections.slug, collectionSlug),
        eq(helpArticles.isPublished, true),
        eq(helpCollections.isPublished, true)
      )
    )
    .limit(1);

  if (!rows.length) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  const { article: a, collection: c } = rows[0];
  return NextResponse.json({
    article: {
      id: a.id,
      collection_id: a.collectionId,
      slug: a.slug,
      title: a.title,
      content: a.content,
      sort_order: a.sortOrder,
      is_published: a.isPublished,
      created_at: a.createdAt.toISOString(),
      updated_at: a.updatedAt.toISOString(),
    },
    collection: {
      id: c.id,
      slug: c.slug,
      title: c.title,
      icon: c.icon,
    },
  });
}
