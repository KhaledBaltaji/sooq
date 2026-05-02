import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function getAnonClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default async function ShortMarketRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { code } = await params;
  const query = await searchParams;
  const supabase = getAnonClient();

  const { data: market } = await supabase
    .from("markets")
    .select("id")
    .eq("short_code", code)
    .single();

  if (!market) {
    redirect("/");
  }

  // Preserve query params (e.g., ?ref=abc123)
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) qs.set(key, value);
  }
  const queryString = qs.toString();
  redirect(`/market/${market.id}${queryString ? `?${queryString}` : ""}`);
}
