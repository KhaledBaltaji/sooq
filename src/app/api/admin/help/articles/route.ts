// Admin help articles — create (POST).

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { helpArticles } from "@/lib/db/schema";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";

const SLUG_RE = /^[a-z0-9-]+$/;

export async function POST(req: Request) {
  try {
    await requireAdminApi();
    const body = await req.json();
    const collectionId = String(body.collection_id ?? "").trim();
    const slug = String(body.slug ?? "").trim();
    const title = String(body.title ?? "").trim();
    const content = String(body.content ?? "");
    const sortOrder = Number.isFinite(Number(body.sort_order))
      ? Number(body.sort_order)
      : 0;
    const isPublished =
      typeof body.is_published === "boolean" ? body.is_published : true;

    if (!collectionId) {
      return NextResponse.json(
        { error: "collection_id is required" },
        { status: 400 }
      );
    }
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: "Slug must be lowercase letters, digits, and hyphens." },
        { status: 400 }
      );
    }
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const inserted = await db
      .insert(helpArticles)
      .values({ collectionId, slug, title, content, sortOrder, isPublished })
      .returning();

    return NextResponse.json({ article: inserted[0] });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    if (err instanceof Error && err.message.includes("duplicate key")) {
      return NextResponse.json(
        { error: "An article with that slug already exists in this collection." },
        { status: 409 }
      );
    }
    if (err instanceof Error && err.message.includes("foreign key")) {
      return NextResponse.json(
        { error: "Collection not found." },
        { status: 404 }
      );
    }
    throw err;
  }
}
