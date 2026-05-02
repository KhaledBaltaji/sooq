import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/guards";
import { redirect } from "next/navigation";
import { isSuperAdmin } from "@/lib/admin-views";
import { AdminsPageClient } from "@/components/admin/admins-page-client";

export default async function AdminsPage() {
  const { allowedViews } = await requireAdmin();

  // Only super admins can access this page
  if (!isSuperAdmin(allowedViews)) {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: admins } = await supabase
    .from("users")
    .select("id, display_name, phone, is_admin, admin_allowed_views, created_at")
    .eq("is_admin", true)
    .order("created_at", { ascending: true });

  return (
    <div className="p-8">
      <AdminsPageClient admins={(admins || []) as any[]} />
    </div>
  );
}
