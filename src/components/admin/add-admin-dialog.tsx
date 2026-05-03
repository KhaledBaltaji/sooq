"use client";

import { useState, useCallback } from "react";
import { AdminRoleEditor } from "./admin-role-editor";

interface UserResult {
  id: string;
  display_name: string | null;
  phone: string | null;
  is_admin: boolean;
  admin_allowed_views: string[] | null;
}

interface SearchResponse {
  users: UserResult[];
}

export function AddAdminDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(query.trim())}`);
      if (!res.ok) {
        setResults([]);
        return;
      }
      const data = (await res.json()) as SearchResponse;
      setResults(data.users ?? []);
    } finally {
      setSearching(false);
    }
  }, [query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4">
        <div className="p-6 border-b border-[#a9b4b9]/10">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold font-[family-name:var(--font-manrope)] text-[#2a3439]">
              {selectedUser ? "Set Admin Role" : "Add Admin"}
            </h3>
            <button onClick={onClose} className="p-1 text-[#717c82] hover:text-[#2a3439] transition-colors">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div className="p-6">
          {!selectedUser ? (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Search by phone or name..."
                  className="flex-1 px-4 py-2.5 rounded-lg border border-[#a9b4b9]/20 text-sm focus:outline-none focus:border-[var(--yes,#2D8CFF)] bg-[#f7f9fb]"
                />
                <button
                  onClick={handleSearch}
                  disabled={searching || !query.trim()}
                  className="px-4 py-2.5 rounded-lg bg-[var(--yes,#2D8CFF)] text-white text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-50"
                >
                  {searching ? "..." : "Search"}
                </button>
              </div>

              {results.length > 0 && (
                <div className="space-y-1">
                  {results.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => setSelectedUser(user)}
                      className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-[#f0f4f7] transition-colors text-left"
                    >
                      <div>
                        <p className="text-sm font-semibold text-[#2a3439]">
                          {user.display_name || user.phone || "Anonymous"}
                        </p>
                        {user.phone && user.display_name && (
                          <p className="text-xs text-[#717c82]">{user.phone}</p>
                        )}
                      </div>
                      {user.is_admin && (
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-[var(--yes,#2D8CFF)]/10 text-[var(--yes,#2D8CFF)] uppercase">
                          {!user.admin_allowed_views || user.admin_allowed_views.length === 0
                            ? "Super Admin"
                            : "Sub-Admin"}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {results.length === 0 && query && !searching && (
                <p className="text-center text-sm text-[#717c82] py-6">No users found</p>
              )}
            </div>
          ) : (
            <div>
              <button
                onClick={() => setSelectedUser(null)}
                className="flex items-center gap-1 text-xs font-medium text-[#566166] hover:text-[#2a3439] mb-4"
              >
                <span className="material-symbols-outlined text-sm">arrow_back</span>
                Back to search
              </button>
              <div className="flex items-center gap-3 mb-6 p-3 bg-[#f0f4f7] rounded-lg">
                <div className="w-10 h-10 rounded-lg bg-[#565e74] flex items-center justify-center text-white text-xs font-bold">
                  {(selectedUser.display_name || selectedUser.phone || "?").slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-bold text-[#2a3439]">
                    {selectedUser.display_name || selectedUser.phone || "Anonymous"}
                  </p>
                  {selectedUser.phone && selectedUser.display_name && (
                    <p className="text-xs text-[#717c82]">{selectedUser.phone}</p>
                  )}
                </div>
              </div>
              <AdminRoleEditor
                userId={selectedUser.id}
                displayName={selectedUser.display_name}
                isAdmin={selectedUser.is_admin}
                allowedViews={selectedUser.admin_allowed_views}
                onClose={onClose}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
