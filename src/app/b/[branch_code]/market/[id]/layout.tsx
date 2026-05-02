import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function getAnonClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://sooq.exchange")
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ branch_code: string; id: string }>;
}): Promise<Metadata> {
  const { branch_code, id } = await params;
  const supabase = getAnonClient();

  // Metadata only consumes question + branch name; dropping unused fetches
  // (unique_traders/total_volume/prices/closes_at/status/category) to keep
  // volume + trader counts out of user-facing paths entirely.
  const [{ data: market }, { data: branch }] = await Promise.all([
    supabase
      .from("markets")
      .select("question_en")
      .eq("id", id)
      .single(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("branches")
      .select("name")
      .eq("branch_code", branch_code)
      .single() as Promise<{ data: { name: string } | null }>,
  ]);

  if (!market) {
    return {
      title: "Market Not Found | Sooq Exchange",
    };
  }

  const branchName = branch?.name ?? branch_code;
  const question = market.question_en;
  const description = `Trade on ${branchName}, powered by Sooq.`;

  const baseUrl = getBaseUrl();
  // Hourly cache-bust — WhatsApp caches OG images aggressively
  const hourBucket = Math.floor(Date.now() / 3600000);
  const ogImageUrl = `${baseUrl}/api/og/branch/${branch_code}/${id}?v=${hourBucket}`;
  const marketUrl = `${baseUrl}/b/${branch_code}/market/${id}`;

  return {
    title: `${question} | ${branchName}`,
    description,
    openGraph: {
      title: question,
      description,
      url: marketUrl,
      type: "website",
      siteName: `${branchName} | Sooq`,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 1200,
          alt: question,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: question,
      description,
      images: [ogImageUrl],
    },
  };
}

export default function BranchMarketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
