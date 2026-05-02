// Manual deposit submission (Whish flow). Caller has already uploaded the
// proof image to S3 via /api/storage/upload-url and is now POSTing the
// resulting key. We insert a `pending` deposit row for admin review.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { deposits } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { proof_key } = (await req.json()) as { proof_key: string };
    if (!proof_key || typeof proof_key !== "string") {
      return NextResponse.json(
        { error: "proof_key required" },
        { status: 400 }
      );
    }
    // Defense in depth — the upload-url route already namespaces uploads
    // under {userId}/ but we re-verify here so a stolen key from another
    // user can't be replayed.
    if (!proof_key.startsWith(`${session.user.id}/`)) {
      return NextResponse.json({ error: "Invalid proof key" }, { status: 400 });
    }

    // provider_ref must be unique. Manual deposits have no upstream
    // identifier, so we synthesize one.
    const providerRef = `whish_manual:${crypto.randomUUID()}`;

    const [row] = await db
      .insert(deposits)
      .values({
        userId: session.user.id,
        provider: "whish",
        providerRef,
        amount: "0", // amount is determined at admin review (they verify the receipt)
        currency: "LBP",
        status: "pending",
        proofUrl: proof_key,
        rawPayload: { source: "whish_manual" },
      })
      .returning({ id: deposits.id });

    return NextResponse.json({ deposit_id: row?.id, status: "pending" });
  } catch (err) {
    logger.error("manual deposit submit failed", { source: "api/deposit/manual" }, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
