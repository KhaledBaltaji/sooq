// Admin help collections — list (GET) + create (POST).
// Admin-only. Returns drafts + published.

import { NextResponse } from "next/server";
import { asc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { helpCollections, helpArticles } from "@/lib/db/schema";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";

const SLUG_RE = /^[a-z0-9-]+$/;

export async function GET() {
  try {
    await requireAdminApi();
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
        )`,
      })
      .from(helpCollections)
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
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    throw err;
  }
}

export async function POST(req: Request) {
  try {
    await requireAdminApi();
    const body = await req.json();
    const slug = String(body.slug ?? "").trim();
    const title = String(body.title ?? "").trim();
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: "Slug must be lowercase letters, digits, and hyphens." },
        { status: 400 }
      );
    }
    if (!title) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }
    const description = body.description ? String(body.description) : null;
    const icon = body.icon ? String(body.icon) : "help-circle";
    const locale = body.locale ? String(body.locale) : "en";
    const sortOrder = Number.isFinite(Number(body.sort_order))
      ? Number(body.sort_order)
      : 0;
    const isPublished =
      typeof body.is_published === "boolean" ? body.is_published : true;

    const inserted = await db
      .insert(helpCollections)
      .values({
        slug,
        title,
        description,
        icon,
        locale,
        sortOrder,
        isPublished,
      })
      .returning();

    return NextResponse.json({ collection: inserted[0] });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    if (err instanceof Error && err.message.includes("duplicate key")) {
      return NextResponse.json(
        { error: "A collection with that slug already exists." },
        { status: 409 }
      );
    }
    throw err;
  }
}
