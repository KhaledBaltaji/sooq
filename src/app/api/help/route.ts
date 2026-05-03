// GET /api/help — public list of published help collections, with article
// counts for each. Optional `locale` query param (default `en`).

import { NextResponse } from "next/server";
import { eq, and, asc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { helpCollections, helpArticles } from "@/lib/db/schema";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const locale = url.searchParams.get("locale") ?? "en";

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
      createdAt: helpCollections.createdAt,
      updatedAt: helpCollections.updatedAt,
      articleCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${helpArticles}
        WHERE ${helpArticles.collectionId} = ${helpCollections.id}
          AND ${helpArticles.isPublished} = TRUE
      )`,
    })
    .from(helpCollections)
    .where(
      and(
        eq(helpCollections.isPublished, true),
        eq(helpCollections.locale, locale)
      )
    )
    .orderBy(asc(helpCollections.sortOrder));

  return NextResponse.json({
    collections: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description,
      icon: r.icon,
      locale: r.locale,
      sort_order: r.sortOrder,
      is_published: r.isPublished,
      article_count: Number(r.articleCount ?? 0),
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    })),
  });
}
