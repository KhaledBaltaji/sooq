// S3 client + presigned URL helpers.
//
// Region defaults to eu-central-1 (Frankfurt) per AWS_RESOURCES.md. Buckets:
//   sooq-staging-deposits  — deposit-proof images (PUT via presigned URL,
//                            GET via CloudFront with OAC).
//   sooq-staging-thumbnails — speed-mode static assets (rarely written).
//
// AWS credentials are sourced from the standard AWS env-var/SSO chain:
//   - AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (Vercel env vars)
//   - or the shared SDK chain when running locally
//
// In the v1 design we present-URL upload through the user's browser directly
// to S3 to keep our serverless function execution time small.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.AWS_REGION ?? "eu-central-1";

let _client: S3Client | null = null;
export function s3() {
  if (!_client) {
    _client = new S3Client({ region });
  }
  return _client;
}

export const DEPOSIT_BUCKET =
  process.env.AWS_S3_DEPOSITS_BUCKET ?? "sooq-staging-deposits";
export const THUMBNAIL_BUCKET =
  process.env.AWS_S3_THUMBNAILS_BUCKET ?? "sooq-staging-thumbnails";

/**
 * Generate a presigned PUT URL the browser uses to upload a file directly
 * into S3. The URL is single-use and valid for the given TTL (default 5 min).
 */
export async function getUploadUrl({
  bucket,
  key,
  contentType,
  expiresInSeconds = 300,
}: {
  bucket: string;
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<string> {
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: expiresInSeconds }
  );
}

/**
 * Generate a presigned GET URL to view an object. Default 1-hour TTL —
 * shorter than the original Supabase Storage default (also 3600s).
 */
export async function getViewUrl({
  bucket,
  key,
  expiresInSeconds = 3600,
}: {
  bucket: string;
  key: string;
  expiresInSeconds?: number;
}): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSeconds }
  );
}
