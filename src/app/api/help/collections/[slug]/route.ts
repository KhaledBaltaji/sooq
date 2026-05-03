// GET /api/help/collections/[slug] — one published collection + its
// published articles, sorted by sort_order. Public.

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { helpCollections, helpArticles } from "@/lib/db/schema";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const collectionRow = await db
    .select()
    .from(helpCollections)
    .where(
      and(eq(helpCollections.slug, slug), eq(helpCollections.isPublished, true))
    )
    .limit(1);

  if (!collectionRow.length) {
    return NextResponse.json({ error: "Collection not found" }, { status: 404 });
  }

  const c = collectionRow[0];

  const articleRows = await db
    .select()
    .from(helpArticles)
    .where(
      and(
        eq(helpArticles.collectionId, c.id),
        eq(helpArticles.isPublished, true)
      )
    )
    .orderBy(asc(helpArticles.sortOrder));

  return NextResponse.json({
    collection: {
      id: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      icon: c.icon,
      locale: c.locale,
      sort_order: c.sortOrder,
      is_published: c.isPublished,
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
    },
    articles: articleRows.map((a) => ({
      id: a.id,
      collection_id: a.collectionId,
      slug: a.slug,
      title: a.title,
      content: a.content,
      sort_order: a.sortOrder,
      is_published: a.isPublished,
      created_at: a.createdAt.toISOString(),
      updated_at: a.updatedAt.toISOString(),
    })),
  });
}
