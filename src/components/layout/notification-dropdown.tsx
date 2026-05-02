"use client";

import { useEffect, useState, useRef } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useSession } from "@/lib/auth/hooks";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Bell, BellOff } from "lucide-react";

interface Notification {
  id: string;
  type: string;
  title_en: string;
  title_ar: string;
  body_en: string | null;
  body_ar: string | null;
  is_read: boolean;
  created_at: string;
}

export function NotificationDropdown({ onOpen }: { onOpen?: () => void } = {}) {
  const supabase = useSupabase();
  const { user } = useSession();
  const locale = useLocale();
  const t = useTranslations("notifications");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // Fetch notifications
  useEffect(() => {
    if (!user) return;
    async function fetch() {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      setNotifications((data as Notification[]) || []);
      setLoading(false);
    }
    fetch();
  }, [supabase, user]);

  // Realtime: new notifications
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notifs-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev].slice(0, 20));
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error("Notifications realtime subscription error");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, user]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on mouse leave with a small delay (so user can move to dropdown)
  const closeTimer = useRef<NodeJS.Timeout | null>(null);
  // Listen for close events from other dropdowns
  useEffect(() => {
    const handler = () => setOpen(false);
    window.addEventListener("close-notifications", handler);
    return () => window.removeEventListener("close-notifications", handler);
  }, []);

  const handleMouseEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    window.dispatchEvent(new Event("close-profile"));
    onOpen?.();
    setOpen(true);
  };
  const handleMouseLeave = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  };

  const markAsRead = async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    const { error } = await (supabase.from("notifications") as any)
      .update({ is_read: true })
      .eq("id", id);
    if (error) {
      // Rollback optimistic update
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: false } : n))
      );
    }
  };

  const markAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    const { error } = await (supabase.from("notifications") as any)
      .update({ is_read: true })
      .in("id", unreadIds);
    if (error) {
      // Rollback
      setNotifications((prev) =>
        prev.map((n) => (unreadIds.includes(n.id) ? { ...n, is_read: false } : n))
      );
    }
  };

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return (
    <div className="relative" ref={dropdownRef} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
        className={cn(
          "p-1.5 rounded-md transition-all duration-200 relative cursor-pointer",
          open ? "text-yes bg-surface" : "text-muted-custom hover:bg-surface hover:text-text"
        )}
      >
        <Bell className={cn("w-5 h-5 transition-transform duration-200", open && "scale-110")} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-2 h-2 bg-yes rounded-full animate-pulse" />
        )}
      </button>

      {/* Dropdown */}
      <div
        className={cn(
          "absolute end-0 top-full mt-2 w-80 bg-bg border border-border-custom rounded-2xl shadow-xl z-[60] overflow-hidden",
          "transition-all duration-200 origin-top-right",
          open
            ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
            : "opacity-0 scale-95 -translate-y-1 pointer-events-none"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-custom">
          <h3 className="font-satoshi font-medium text-sm text-text">{t("title")}</h3>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-[11px] text-yes font-medium hover:underline cursor-pointer"
            >
              {t("markAllRead")}
            </button>
          )}
        </div>

        {/* Content */}
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-surface rounded-lg animate-pulse" />
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="py-10 text-center">
              <BellOff className="w-6 h-6 text-dim mx-auto mb-2" />
              <p className="text-sm text-muted-custom">{t("noNotifications")}</p>
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => !n.is_read && markAsRead(n.id)}
                className={cn(
                  "w-full text-left px-4 py-3 transition-colors border-b border-border-custom/20 last:border-0",
                  n.is_read ? "hover:bg-surface/50" : "bg-yes/[0.03] hover:bg-yes/[0.06]"
                )}
              >
                <div className="flex items-start gap-2.5">
                  {!n.is_read && (
                    <span className="w-1.5 h-1.5 rounded-full bg-yes mt-1.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-text truncate">
                        {locale === "ar" ? n.title_ar : n.title_en}
                      </p>
                      <span className="text-[10px] text-dim shrink-0">
                        {formatTime(n.created_at)}
                      </span>
                    </div>
                    {(locale === "ar" ? n.body_ar : n.body_en) && (
                      <p className="text-xs text-muted-custom mt-0.5 line-clamp-2">
                        {locale === "ar" ? n.body_ar : n.body_en}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
