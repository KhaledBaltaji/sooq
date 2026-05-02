"use client";

import { useState } from "react";
import Link from "next/link";
import { isSuperAdmin } from "@/lib/admin-views";
import { AdminRoleEditor } from "./admin-role-editor";
import { AddAdminDialog } from "./add-admin-dialog";

interface AdminUser {
  id: string;
  display_name: string | null;
  phone: string | null;
  is_admin: boolean;
  admin_allowed_views: string[] | null;
  created_at: string;
}

export function AdminsPageClient({ admins }: { admins: AdminUser[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);

  return (
    <>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
            Admins
          </h2>
          <p className="text-[#566166] mt-2 max-w-lg">
            Manage admin access and page-level permissions.
          </p>
        </div>
        <button
          onClick={() => setShowAddDialog(true)}
          className="flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-sm bg-[var(--yes,#2D8CFF)] text-white hover:opacity-90 transition-all active:scale-95"
        >
          <span className="material-symbols-outlined text-lg">person_add</span>
          Add Admin
        </button>
      </div>

      {/* Admin cards */}
      <div className="space-y-4">
        {admins.map((admin) => {
          const isSuper = isSuperAdmin(admin.admin_allowed_views);
          const isEditing = editingId === admin.id;

          return (
            <div
              key={admin.id}
              className="bg-white rounded-xl overflow-hidden"
            >
              <div className="flex items-center justify-between p-6">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-lg bg-[#565e74] flex items-center justify-center text-white text-sm font-bold">
                    {(admin.display_name || admin.phone || "?").slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/admin/users/${admin.id}`}
                        className="text-sm font-bold text-[#2a3439] hover:text-[var(--yes,#2D8CFF)] transition-colors"
                      >
                        {admin.display_name || admin.phone || "Anonymous"}
                      </Link>
                      <span
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wide ${
                          isSuper
                            ? "bg-[var(--yes,#2D8CFF)] text-white"
                            : "bg-[var(--yes,#2D8CFF)]/10 text-[var(--yes,#2D8CFF)]"
                        }`}
                      >
                        {isSuper ? "Super Admin" : "Sub-Admin"}
                      </span>
                    </div>
                    {!isSuper && admin.admin_allowed_views && (
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {admin.admin_allowed_views.map((view) => (
                          <span
                            key={view}
                            className="text-[10px] font-medium px-2 py-0.5 rounded bg-[#f0f4f7] text-[#566166] capitalize"
                          >
                            {view}
                          </span>
                        ))}
                      </div>
                    )}
                    {admin.phone && admin.display_name && (
                      <p className="text-xs text-[#717c82] mt-1">{admin.phone}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setEditingId(isEditing ? null : admin.id)}
                  className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-[#566166] hover:bg-[#f0f4f7] transition-colors"
                >
                  <span className="material-symbols-outlined text-lg">
                    {isEditing ? "expand_less" : "edit"}
                  </span>
                  {isEditing ? "Close" : "Edit"}
                </button>
              </div>

              {isEditing && (
                <div className="border-t border-[#a9b4b9]/10 p-6 bg-[#f7f9fb]">
                  <AdminRoleEditor
                    userId={admin.id}
                    displayName={admin.display_name}
                    isAdmin={admin.is_admin}
                    allowedViews={admin.admin_allowed_views}
                    onClose={() => setEditingId(null)}
                  />
                </div>
              )}
            </div>
          );
        })}

        {admins.length === 0 && (
          <div className="text-center py-16">
            <span className="material-symbols-outlined text-5xl text-[#a9b4b9] mb-3 block">shield_person</span>
            <p className="text-sm font-medium text-[#566166]">No admins configured</p>
          </div>
        )}
      </div>

      <AddAdminDialog open={showAddDialog} onClose={() => setShowAddDialog(false)} />
    </>
  );
}
