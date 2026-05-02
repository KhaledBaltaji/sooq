import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

// Supabase project decommissioned post-W7 (Auth.js + RDS cutover).
// Falls back to placeholder URL/key so construction doesn't throw —
// every callsite that still uses supabase.* will fail at runtime when
// triggered, surfacing exactly what still needs migrating to API/Drizzle.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://supabase-removed.invalid";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "supabase-removed";

export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}
