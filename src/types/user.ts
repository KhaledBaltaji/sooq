// Slim User type for client-side use. Matches the snake_case shape returned
// by /api/users/me (Drizzle camelCase converted at the API boundary).
//
// Server-side code uses the Drizzle-inferred types from @/lib/db/schema.

export interface User {
  id: string;
  name: string | null;
  email: string | null;
  email_verified: string | null;
  image: string | null;
  phone: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  locale: string;
  balance_usd: number;
  is_admin: boolean;
  is_frozen: boolean;
  admin_allowed_views: string[] | null;
  created_at: string;
  updated_at: string;
}
