"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/components/providers/supabase-provider";
import { toast } from "sonner";
import { ADMIN_VIEWS } from "@/lib/admin-views";

interface AdminRoleEditorProps {
  userId: string;
  displayName: string | null;
  isAdmin: boolean;
  allowedViews: string[] | null;
  onClose?: () => void;
}

export function AdminRoleEditor({ userId, displayName, isAdmin, allowedViews, onClose }: AdminRoleEditorProps) {
  const router = useRouter();
  const supabase = useSupabase();
  const [saving, setSaving] = useState(false);
  const [adminEnabled, setAdminEnabled] = useState(isAdmin);
  const [superAdmin, setSuperAdmin] = useState(!allowedViews || allowedViews.length === 0);
  const [selectedViews, setSelectedViews] = useState<string[]>(allowedViews || []);

  const toggleView = (key: string) => {
    setSelectedViews((prev) =>
      prev.includes(key) ? prev.filter((v) => v !== key) : [...prev, key]
    );
  };

  const handleSave = async () => {
    setSaving(true);

    const views = adminEnabled && !superAdmin ? selectedViews : null;

    if (adminEnabled && !superAdmin && selectedViews.length === 0) {
      toast.error("Select at least one page for sub-admin access");
      setSaving(false);
      return;
    }

    const { error } = await supabase.rpc("admin_set_admin_role", {
      p_user_id: userId,
      p_is_admin: adminEnabled,
      p_allowed_views: views,
    });

    if (error) {
      toast.error("Failed to update role", { description: error.message });
    } else {
      toast.success(
        !adminEnabled
          ? "Admin access revoked"
          : superAdmin
            ? "Promoted to Super Admin"
            : `Sub-admin set with ${selectedViews.length} page${selectedViews.length !== 1 ? "s" : ""}`
      );
      router.refresh();
      onClose?.();
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* Admin toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-[#2a3439]">Admin Access</p>
          <p className="text-xs text-[#717c82] mt-0.5">
            Grant admin panel access to {displayName || "this user"}
          </p>
        </div>
        <button
          onClick={() => setAdminEnabled(!adminEnabled)}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            adminEnabled ? "bg-[var(--yes,#2D8CFF)]" : "bg-[#a9b4b9]"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              adminEnabled ? "translate-x-6" : ""
            }`}
          />
        </button>
      </div>

      {adminEnabled && (
        <>
          {/* Super admin toggle */}
          <div className="flex items-center justify-between bg-[#f0f4f7] rounded-lg p-4">
            <div>
              <p className="text-sm font-bold text-[#2a3439]">Super Admin</p>
              <p className="text-xs text-[#717c82] mt-0.5">
                Access to all pages + manage other admins
              </p>
            </div>
            <button
              onClick={() => setSuperAdmin(!superAdmin)}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                superAdmin ? "bg-[var(--yes,#2D8CFF)]" : "bg-[#a9b4b9]"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  superAdmin ? "translate-x-6" : ""
                }`}
              />
            </button>
          </div>

          {/* Page selection grid — only for sub-admins */}
          {!superAdmin && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-[#566166] uppercase tracking-widest">
                  Allowed Pages
                </p>
                <button
                  onClick={() =>
                    setSelectedViews(
                      selectedViews.length === ADMIN_VIEWS.length
                        ? []
                        : ADMIN_VIEWS.map((v) => v.key)
                    )
                  }
                  className="text-[10px] font-bold text-[var(--yes,#2D8CFF)] hover:underline"
                >
                  {selectedViews.length === ADMIN_VIEWS.length ? "Deselect All" : "Select All"}
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {ADMIN_VIEWS.map(({ key, label, icon }) => {
                  const checked = selectedViews.includes(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleView(key)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-all text-sm ${
                        checked
                          ? "border-[var(--yes,#2D8CFF)] bg-[var(--yes,#2D8CFF)]/5 text-[var(--yes,#2D8CFF)] font-medium"
                          : "border-[#a9b4b9]/20 text-[#566166] hover:border-[#a9b4b9]/40"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">{icon}</span>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg px-6 py-3 font-semibold text-sm bg-[var(--yes,#2D8CFF)] text-white hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save Role"}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-lg px-6 py-3 font-semibold text-sm text-[#566166] hover:bg-[#f0f4f7] transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
