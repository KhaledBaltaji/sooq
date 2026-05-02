import { requireBranchManager } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { BranchAgentsDashboard } from "@/components/branch/branch-agents-dashboard";

export default async function BranchAgentsPage() {
  const { branch } = await requireBranchManager();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: agents } = await sb.from("branch_agents").select("*").eq("branch_id", branch.id).order("created_at", { ascending: false }) as { data: Record<string, any>[] | null };

  // Resolve user names
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userIds = [...new Set((agents || []).map((a: Record<string, any>) => a.user_id as string))];
  const { data: users } = userIds.length > 0
    ? await supabase.from("users").select("id, display_name, phone").in("id", userIds)
    : { data: [] };
  const userMap: Record<string, { display_name: string | null; phone: string | null }> = {};
  for (const u of users || []) {
    userMap[u.id] = { display_name: u.display_name, phone: u.phone };
  }

  return (
    <div className="p-8 max-w-[1400px]">
      <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)] mb-2">
        Agents
      </h2>
      <p className="text-[#566166] mb-10">Agents operating under your branch.</p>

      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <BranchAgentsDashboard
        initialAgents={(agents || []) as any[]}
        initialUserMap={userMap}
        branchId={branch.id as string}
      />
    </div>
  );
}
