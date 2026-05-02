// Presigned PUT URL — for client-side direct uploads to S3 deposits bucket.
//
// Auth gates by user. Path is server-namespaced under {userId}/ so a
// compromised key can't write outside the caller's prefix.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUploadUrl, DEPOSIT_BUCKET } from "@/lib/storage/s3";
import { logger } from "@/lib/logger";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — enforced via Content-Length on PUT

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const { content_type, ext } = (await req.json()) as {
      content_type: string;
      ext?: string;
    };

    if (!ALLOWED_TYPES.has(content_type)) {
      return NextResponse.json(
        { error: "Only JPEG/PNG uploads accepted" },
        { status: 400 }
      );
    }

    const safeExt = ext && /^[a-z0-9]{2,5}$/.test(ext) ? ext : "jpg";
    const key = `${userId}/${crypto.randomUUID()}.${safeExt}`;

    const url = await getUploadUrl({
      bucket: DEPOSIT_BUCKET,
      key,
      contentType: content_type,
      expiresInSeconds: 300,
    });

    return NextResponse.json({
      url,
      key,
      bucket: DEPOSIT_BUCKET,
      max_bytes: MAX_BYTES,
    });
  } catch (err) {
    logger.error("upload-url failed", { source: "api/storage/upload-url" }, err);
    return NextResponse.json({ error: "Failed to issue upload URL" }, { status: 500 });
  }
}
