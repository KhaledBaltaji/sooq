import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { haptic } from "ios-haptics";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Standard haptic — buttons, presets, input changes */
export function triggerHaptic() {
  haptic();
}

/** Light haptic — navigation tabs, subtle interactions */
export function triggerHapticLight() {
  haptic();
}

/** Strong haptic (double tap) — trade execution, confirmations */
export function triggerHapticConfirm() {
  haptic.confirm();
}

export function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(amount: number, decimals = 2): string {
  return amount.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatCountdown(endDate: Date | string, t?: (key: string, values?: Record<string, number>) => string): string {
  const end = typeof endDate === "string" ? new Date(endDate) : endDate;
  const now = new Date();
  const diff = end.getTime() - now.getTime();

  if (diff <= 0) return t ? t("ended") : "Ended";

  const totalDays = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (totalDays >= 30) {
    const months = Math.floor(totalDays / 30);
    const days = totalDays % 30;
    return t ? t("monthsDaysHours", { months, days, hours }) : `${months}mo ${days}d ${hours}h`;
  }
  if (totalDays > 0) return t ? t("daysHours", { days: totalDays, hours }) : `${totalDays}d ${hours}h`;
  if (hours > 0) return t ? t("hoursMinutes", { hours, minutes }) : `${hours}h ${minutes}m`;
  return t ? t("minutes", { minutes }) : `${minutes}m`;
}

/**
 * Shared relative time formatter — replaces 7 duplicate timeAgo functions.
 * Compact mode: "5m", "2h", "3d" (for tight UI like cards/feeds)
 * Full mode: "5m ago", "2h ago", "3d ago" (for trade history, comments)
 */
export function timeAgo(dateStr: string, options?: { compact?: boolean; t?: (key: string, values?: Record<string, number>) => string }): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const compact = options?.compact ?? false;
  const t = options?.t;

  if (minutes < 1) {
    if (t) return t("justNow");
    return compact ? "now" : "just now";
  }
  if (minutes < 60) {
    if (t) return compact ? t("minsCompact", { count: minutes }) : t("minsAgo", { count: minutes });
    return compact ? `${minutes}m` : `${minutes}m ago`;
  }
  if (hours < 24) {
    if (t) return compact ? t("hoursCompact", { count: hours }) : t("hoursAgo", { count: hours });
    return compact ? `${hours}h` : `${hours}h ago`;
  }
  if (t) return compact ? t("daysCompact", { count: days }) : t("daysAgo", { count: days });
  return compact ? `${days}d` : `${days}d ago`;
}

export function calculatePotentialPayout(
  amount: number,
  sidePool: number,
  otherPool: number
): number {
  if (sidePool + amount <= 0) return 0;
  const totalPool = sidePool + otherPool + amount;
  const ratio = totalPool / (sidePool + amount);
  return amount * ratio;
}

export function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function truncateAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}
