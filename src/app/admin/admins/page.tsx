import { eq, asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/guards";
import { isSuperAdmin } from "@/lib/admin-views";
import { AdminsPageClient } from "@/components/admin/admins-page-client";

export default async function AdminsPage() {
  const { allowedViews } = await requireAdmin();
  if (!isSuperAdmin(allowedViews)) {
    redirect("/admin");
  }

  const adminRows = await db
    .select({
      id: users.id,
      display_name: users.displayName,
      phone: users.phone,
      is_admin: users.isAdmin,
      admin_allowed_views: users.adminAllowedViews,
      created_at: users.createdAt,
    })
    .from(users)
    .where(eq(users.isAdmin, true))
    .orderBy(asc(users.createdAt));

  // AdminsPageClient expects snake_case + ISO string created_at — match the
  // shape of the old supabase response so that component doesn't need a rewrite.
  const admins = adminRows.map((a) => ({
    ...a,
    created_at: a.created_at.toISOString(),
  }));

  return (
    <div className="p-8">
      <AdminsPageClient admins={admins as never[]} />
    </div>
  );
}
