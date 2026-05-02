// Presigned GET URL — admin-only signed view of a deposit-proof image.
//
// Auth: only admins (deposit proofs may belong to any user).

import { NextResponse } from "next/server";
import { getViewUrl, DEPOSIT_BUCKET } from "@/lib/storage/s3";
import { requireAdminApi, authErrorToResponse } from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

export async function GET(req: Request) {
  try {
    await requireAdminApi();
    const url = new URL(req.url);
    const key = url.searchParams.get("key");

    if (!key || key.includes("..") || key.startsWith("/")) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    }

    const viewUrl = await getViewUrl({
      bucket: DEPOSIT_BUCKET,
      key,
      expiresInSeconds: 3600,
    });

    return NextResponse.json({ url: viewUrl });
  } catch (err) {
    const authResp = authErrorToResponse(err);
    if (authResp) return authResp;
    logger.error("view-url failed", { source: "api/storage/view-url" }, err);
    return NextResponse.json({ error: "Failed to issue view URL" }, { status: 500 });
  }
}
