// Admin help article — get (GET) / update (PATCH) / delete (DELETE).

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { helpArticles, helpCollections } from "@/lib/db/schema";
import { authErrorToResponse, requireAdminApi } from "@/lib/auth/api-guards";

const SLUG_RE = /^[a-z0-9-]+$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminApi();
    const { id } = await params;
    const rows = await db
      .select({
        article: helpArticles,
        collection: helpCollections,
      })
      .from(helpArticles)
      .innerJoin(helpCollections, eq(helpArticles.collectionId, helpCollections.id))
      .where(eq(helpArticles.id, id))
      .limit(1);
    if (!rows.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    throw err;
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminApi();
    const { id } = await params;
    const body = await req.json();
    const update: Record<string, unknown> = {};

    if (body.slug !== undefined) {
      const slug = String(body.slug).trim();
      if (!SLUG_RE.test(slug)) {
        return NextResponse.json(
          { error: "Slug must be lowercase letters, digits, and hyphens." },
          { status: 400 }
        );
      }
      update.slug = slug;
    }
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title)
        return NextResponse.json({ error: "Title required" }, { status: 400 });
      update.title = title;
    }
    if (body.content !== undefined) update.content = String(body.content);
    if (body.collection_id !== undefined) {
      update.collectionId = String(body.collection_id);
    }
    if (body.sort_order !== undefined && Number.isFinite(Number(body.sort_order))) {
      update.sortOrder = Number(body.sort_order);
    }
    if (typeof body.is_published === "boolean") {
      update.isPublished = body.is_published;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const updated = await db
      .update(helpArticles)
      .set(update)
      .where(eq(helpArticles.id, id))
      .returning();

    if (!updated.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ article: updated[0] });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    if (err instanceof Error && err.message.includes("duplicate key")) {
      return NextResponse.json(
        { error: "An article with that slug already exists in this collection." },
        { status: 409 }
      );
    }
    throw err;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminApi();
    const { id } = await params;
    const deleted = await db
      .delete(helpArticles)
      .where(eq(helpArticles.id, id))
      .returning();
    if (!deleted.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    throw err;
  }
}
