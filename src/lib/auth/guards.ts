import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function requireAuth() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return user;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function requireBranchManager(): Promise<{ user: NonNullable<Awaited<ReturnType<Awaited<ReturnType<typeof createClient>>["auth"]["getUser"]>>["data"]["user"]>; branch: Record<string, any> }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: branch, error } = await (supabase as any)
    .from("branches")
    .select("*")
    .eq("manager_user_id", user.id)
    .limit(1)
    .single() as { data: Record<string, unknown> | null; error: unknown };

  if (error || !branch) {
    redirect("/");
  }

  return { user, branch };
}

export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("is_admin, admin_allowed_views")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) {
    redirect("/");
  }

  return { user, allowedViews: (profile.admin_allowed_views as string[] | null) };
}
