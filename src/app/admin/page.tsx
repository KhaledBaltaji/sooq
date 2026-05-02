import { createClient } from "@/lib/supabase/server";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { ActivityFeedClient } from "@/components/admin/activity-feed-client";

export type EventCategory =
  | "trade"
  | "deposit"
  | "withdrawal"
  | "market"
  | "signup"
  | "commission"
  | "system";

export interface ActivityEvent {
  id: string;
  category: EventCategory;
  timestamp: string;
  icon: string;
  color: string;
  title: string;
  description: string;
  userId?: string;
  severity?: "info" | "warn" | "error" | "critical";
}

export default async function AdminDashboard() {
  const supabase = await createClient();

  const todayISO = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  // Fetch all event sources + today counts in parallel
  const [
    { data: trades },
    { data: deposits },
    { data: withdrawals },
    { data: markets },
    { data: users },
    { data: commissions },
    { data: systemLogs },
    { count: tradesToday },
    { count: signupsToday },
    { count: depositsToday },
    { count: activeMarkets },
  ] = await Promise.all([
    supabase
      .from("trades")
      .select("id, user_id, side, direction, shares, total_cost, price_per_share, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("deposits")
      .select("id, user_id, net_amount, status, currency, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("withdrawals")
      .select("id, user_id, amount, status, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("markets")
      .select("id, question_en, status, outcome, resolved_at, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("users")
      .select("id, display_name, phone, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("referral_commissions")
      .select("id, referrer_id, layer, commission_amount, status, created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("system_logs")
      .select("id, severity, source, message, created_at")
      .in("severity", ["error", "critical"])
      .order("created_at", { ascending: false })
      .limit(20),
    // Today counts
    supabase
      .from("trades")
      .select("*", { count: "exact", head: true })
      .gte("created_at", todayISO),
    supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .gte("created_at", todayISO),
    supabase
      .from("deposits")
      .select("*", { count: "exact", head: true })
      .eq("status", "confirmed")
      .gte("created_at", todayISO),
    supabase
      .from("markets")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
  ]);

  // Normalize all event sources
  const events: ActivityEvent[] = [
    ...normalizeTrades(trades || []),
    ...normalizeDeposits(deposits || []),
    ...normalizeWithdrawals(withdrawals || []),
    ...normalizeMarkets(markets || []),
    ...normalizeSignups(users || []),
    ...normalizeCommissions(commissions || []),
    ...normalizeSystemLogs(systemLogs || []),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 50);

  const todayStats = {
    trades: tradesToday ?? 0,
    signups: signupsToday ?? 0,
    deposits: depositsToday ?? 0,
    activeMarkets: activeMarkets ?? 0,
  };

  return (
    <section className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Activity Feed
        </h2>
        <p className="text-[#566166] mt-2 max-w-lg">
          Real-time platform activity across all systems.
        </p>
      </div>

      {/* Today Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <TodayStat icon="swap_vert" label="Trades Today" value={todayStats.trades} bg="bg-[#dbeafe]" iconColor="text-[#2D8CFF]" />
        <TodayStat icon="person_add" label="Signups Today" value={todayStats.signups} bg="bg-[#d1fae5]" iconColor="text-[#00E87B]" />
        <TodayStat icon="account_balance_wallet" label="Deposits Today" value={todayStats.deposits} bg="bg-[#fef3c7]" iconColor="text-[#FFB800]" />
        <TodayStat icon="analytics" label="Active Markets" value={todayStats.activeMarkets} bg="bg-[#ede9fe]" iconColor="text-[#7c3aed]" />
      </div>

      {/* Activity Feed */}
      <ActivityFeedClient events={events} />
    </section>
  );
}

/* ---- Today Stat Pill ---- */
function TodayStat({ icon, label, value, bg, iconColor }: {
  icon: string;
  label: string;
  value: number;
  bg: string;
  iconColor: string;
}) {
  return (
    <div className="bg-white p-5 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.02)] flex items-center gap-4">
      <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center`}>
        <span className={`material-symbols-outlined ${iconColor} text-xl`}>{icon}</span>
      </div>
      <div>
        <p className="text-2xl font-bold font-[family-name:var(--font-manrope)] text-[#2a3439]">{value}</p>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#717c82]">{label}</p>
      </div>
    </div>
  );
}

/* ---- Normalizers ---- */

function normalizeTrades(rows: any[]): ActivityEvent[] {
  return rows.map((t) => {
    const isBuy = t.direction === "buy";
    return {
      id: `trade-${t.id}`,
      category: "trade" as const,
      timestamp: t.created_at,
      icon: isBuy ? "trending_up" : "trending_down",
      color: isBuy ? "var(--yes)" : "var(--no)",
      title: `Trade \u2014 ${isBuy ? "Buy" : "Sell"} ${(t.side as string).toUpperCase()}`,
      description: `${Number(t.shares).toFixed(1)} shares at $${Number(t.price_per_share).toFixed(2)} (${formatCurrency(Number(t.total_cost))})`,
      userId: t.user_id,
    };
  });
}

function normalizeDeposits(rows: any[]): ActivityEvent[] {
  return rows.map((d) => {
    const status = d.status as string;
    const iconMap: Record<string, string> = { confirmed: "account_balance_wallet", pending: "hourglass_top", failed: "error" };
    const colorMap: Record<string, string> = { confirmed: "var(--success)", pending: "var(--warning)", failed: "var(--error)" };
    const labelMap: Record<string, string> = { confirmed: "Confirmed", pending: "Pending", failed: "Failed" };
    return {
      id: `deposit-${d.id}`,
      category: "deposit" as const,
      timestamp: d.created_at,
      icon: iconMap[status] || "account_balance_wallet",
      color: colorMap[status] || "var(--warning)",
      title: `Deposit ${labelMap[status] || status}`,
      description: `${formatCurrency(Number(d.net_amount))} ${d.currency || "USDT"}`,
      userId: d.user_id,
    };
  });
}

function normalizeWithdrawals(rows: any[]): ActivityEvent[] {
  return rows.map((w) => {
    const status = w.status as string;
    const iconMap: Record<string, string> = { pending: "output", approved: "check_circle", rejected: "cancel" };
    const colorMap: Record<string, string> = { pending: "var(--warning)", approved: "var(--success)", rejected: "var(--error)" };
    const labelMap: Record<string, string> = { pending: "Requested", approved: "Approved", rejected: "Rejected" };
    return {
      id: `withdrawal-${w.id}`,
      category: "withdrawal" as const,
      timestamp: w.created_at,
      icon: iconMap[status] || "output",
      color: colorMap[status] || "var(--warning)",
      title: `Withdrawal ${labelMap[status] || status}`,
      description: formatCurrency(Number(w.amount)),
      userId: w.user_id,
    };
  });
}

function normalizeMarkets(rows: any[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const m of rows) {
    const question = (m.question_en as string)?.slice(0, 60) || "Untitled market";
    // Creation event
    events.push({
      id: `market-created-${m.id}`,
      category: "market" as const,
      timestamp: m.created_at,
      icon: "add_circle",
      color: "var(--yes)",
      title: "Market Created",
      description: question,
    });
    // Resolution event (if resolved)
    if (m.status === "resolved" && m.resolved_at) {
      events.push({
        id: `market-resolved-${m.id}`,
        category: "market" as const,
        timestamp: m.resolved_at,
        icon: "gavel",
        color: "var(--success)",
        title: `Market Resolved \u2014 ${(m.outcome as string)?.toUpperCase() || "N/A"}`,
        description: question,
      });
    }
    // Voided event
    if (m.status === "voided") {
      events.push({
        id: `market-voided-${m.id}`,
        category: "market" as const,
        timestamp: m.resolved_at || m.created_at,
        icon: "block",
        color: "var(--error)",
        title: "Market Voided",
        description: question,
      });
    }
  }
  return events;
}

function normalizeSignups(rows: any[]): ActivityEvent[] {
  return rows.map((u) => ({
    id: `signup-${u.id}`,
    category: "signup" as const,
    timestamp: u.created_at,
    icon: "person_add",
    color: "#2D8CFF",
    title: "New User Signup",
    description: u.display_name || u.phone || u.id.slice(0, 8),
    userId: u.id,
  }));
}

function normalizeCommissions(rows: any[]): ActivityEvent[] {
  return rows.map((c) => ({
    id: `commission-${c.id}`,
    category: "commission" as const,
    timestamp: c.created_at,
    icon: "monetization_on",
    color: "var(--warning)",
    title: `Commission ${c.status === "escrowed" ? "Escrowed" : "Earned"}`,
    description: `${formatCurrency(Number(c.commission_amount))} (L${c.layer})`,
    userId: c.referrer_id,
  }));
}

function normalizeSystemLogs(rows: any[]): ActivityEvent[] {
  return rows.map((l) => ({
    id: `system-${l.id}`,
    category: "system" as const,
    timestamp: l.created_at,
    icon: l.severity === "critical" ? "emergency" : "warning",
    color: "var(--error)",
    title: l.severity === "critical" ? "CRITICAL" : "System Error",
    description: `${l.source}: ${(l.message as string)?.slice(0, 80)}`,
    severity: l.severity as "error" | "critical",
  }));
}
