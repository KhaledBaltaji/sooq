import { requireBranchManager } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export default async function BranchUsersPage() {
  const { branch } = await requireBranchManager();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: assignments } = await sb.from("branch_user_assignments").select("*").eq("branch_id", branch.id).order("created_at", { ascending: false }).limit(50) as { data: Record<string, any>[] | null };

  // Resolve user names
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userIds = [...new Set((assignments || []).map((a: Record<string, any>) => a.user_id as string))];
  const { data: users } = userIds.length > 0
    ? await supabase.from("users").select("id, display_name, phone, balance_usd, created_at").in("id", userIds)
    : { data: [] };
  const userMap = new Map<string, { display_name: string | null; phone: string | null; balance_usd: number; created_at: string }>();
  for (const u of users || []) {
    userMap.set(u.id, { display_name: u.display_name, phone: u.phone, balance_usd: Number(u.balance_usd), created_at: u.created_at });
  }

  return (
    <div className="p-8 max-w-[1400px]">
      <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)] mb-2">
        Users
      </h2>
      <p className="text-[#566166] mb-10">Users assigned to your branch.</p>

      <div className="overflow-x-auto rounded-xl bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#f0f4f7]">
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">User</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Phone</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Balance</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Joined</th>
              <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-[#566166]">Agent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#a9b4b9]/10">
            {(assignments || []).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-sm text-[#566166]">No users assigned yet</td>
              </tr>
            ) : (
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (assignments || []).map((a: Record<string, any>) => {
                const u = userMap.get(a.user_id);
                return (
                  <tr key={a.id} className="hover:bg-[#f0f4f7]/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-semibold text-[#2a3439]">
                      {u?.display_name || `#${(a.user_id as string).slice(0, 6).toUpperCase()}`}
                    </td>
                    <td className="px-6 py-4 text-sm text-[#566166]">{u?.phone || "—"}</td>
                    <td className="px-6 py-4 text-sm font-mono font-bold text-[#2a3439]">
                      ${u?.balance_usd.toFixed(2) || "0.00"}
                    </td>
                    <td className="px-6 py-4 text-sm text-[#566166]">
                      {u ? new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-[#566166]">
                      {a.agent_id ? `#${(a.agent_id as string).slice(0, 6)}` : "Direct"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-[#566166]">{(assignments || []).length} users shown (max 50)</p>
    </div>
  );
}
