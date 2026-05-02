// Canonical list of admin views — used by sidebar, guards, middleware, and role editor

export const ADMIN_VIEWS = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "markets", label: "Markets", icon: "analytics" },
  { key: "users", label: "Users", icon: "group" },
  { key: "fees", label: "Fees", icon: "payments" },
  { key: "finance", label: "Finance", icon: "account_balance" },
  { key: "amm", label: "AMM Risk", icon: "monitoring" },
  { key: "agents", label: "Agents", icon: "smart_toy" },
  { key: "branches", label: "Branches", icon: "store" },
  { key: "stats", label: "Stats", icon: "bar_chart" },
  { key: "accounting", label: "Accounting", icon: "receipt_long" },
  { key: "alerts", label: "Alerts", icon: "notifications_active" },
  { key: "logs", label: "System Logs", icon: "bug_report" },
  { key: "help", label: "Help Center", icon: "help_center" },
] as const;

export type AdminViewKey = (typeof ADMIN_VIEWS)[number]["key"];

export function isSuperAdmin(allowedViews: string[] | null | undefined): boolean {
  return !allowedViews || allowedViews.length === 0;
}

export function canAccessView(allowedViews: string[] | null | undefined, viewKey: string): boolean {
  if (isSuperAdmin(allowedViews)) return true;
  return allowedViews!.includes(viewKey);
}

export function getViewKeyFromPathname(pathname: string): string {
  // /admin → dashboard, /admin/markets/123 → markets, /admin/users/abc → users
  const segments = pathname.replace(/^\/admin\/?/, "").split("/");
  return segments[0] || "dashboard";
}

export function getFirstAllowedPath(allowedViews: string[] | null | undefined): string {
  if (isSuperAdmin(allowedViews)) return "/admin";
  const firstKey = allowedViews![0];
  return firstKey === "dashboard" ? "/admin" : `/admin/${firstKey}`;
}
