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
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = getAnonClient();

  // Only fetch what metadata actually consumes. Previously fetched unique_traders,
  // total_volume, prices, closes_at, status, category and never used any of them —
  // removed to stop surfacing volume/trader counts anywhere in the user-facing path.
  const { data: market } = await supabase
    .from("markets")
    .select("question_en")
    .eq("id", id)
    .single();

  if (!market) {
    return {
      title: "Market Not Found | Sooq Exchange",
    };
  }

  const question = market.question_en;
  const description = "Trade politics, news and events now on Sooq";

  const baseUrl = getBaseUrl();
  // Hourly cache-bust — WhatsApp caches OG images aggressively
  const hourBucket = Math.floor(Date.now() / 3600000);
  const ogImageUrl = `${baseUrl}/api/og/${id}?v=${hourBucket}`;
  const marketUrl = `${baseUrl}/market/${id}`;
  const updatedTime = new Date(hourBucket * 3600000).toISOString();

  return {
    title: `${question} | Sooq`,
    description,
    openGraph: {
      title: question,
      description,
      url: marketUrl,
      type: "website",
      siteName: "Sooq Exchange",
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 1200,
          alt: question,
          type: "image/png",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: question,
      description,
      images: [ogImageUrl],
    },
    other: {
      "og:updated_time": updatedTime,
    },
  };
}

export default function MarketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
