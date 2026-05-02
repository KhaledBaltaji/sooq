"use client";

import { useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useSession } from "@/lib/auth/hooks";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { Bell } from "lucide-react";
import { SignInPrompt } from "@/components/auth/sign-in-prompt";

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

export default function NotificationsPage() {
  const supabase = useSupabase();
  const { user, loading: authLoading } = useSession();
  const locale = useLocale();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    async function fetch() {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      setNotifications((data as Notification[]) || []);
      setLoading(false);
    }
    fetch();
  }, [supabase, user]);

  // Anonymous — show sign-in prompt instead of empty notifications list
  if (!authLoading && !user) {
    return (
      <SignInPrompt
        icon={Bell}
        title="Sign in to view your notifications"
        description="Get real-time alerts for market resolutions, deposits, and updates to your positions."
      />
    );
  }

  const markAsRead = async (id: string) => {
    await (supabase
      .from("notifications") as any)
      .update({ is_read: true })
      .eq("id", id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
  };

  return (
    <div className="px-md py-lg space-y-lg max-w-lg mx-auto">
      <h1 className="font-satoshi text-xl font-bold text-text">Notifications</h1>

      {loading ? (
        <div className="space-y-sm">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-elevated rounded-lg animate-pulse" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-xl">
          <Bell className="w-8 h-8 text-muted mx-auto mb-sm" />
          <p className="text-muted text-sm">No notifications</p>
        </div>
      ) : (
        <div className="space-y-xs">
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => !n.is_read && markAsRead(n.id)}
              className={cn(
                "w-full text-left px-sm py-sm rounded-lg transition-colors",
                n.is_read ? "bg-surface" : "bg-yes/5 hover:bg-yes/10"
              )}
            >
              <div className="flex items-start gap-sm">
                {!n.is_read && <span className="w-2 h-2 rounded-full bg-yes mt-1.5 flex-shrink-0" />}
                <div>
                  <p className="text-sm font-dm-sans text-text">
                    {locale === "ar" ? n.title_ar : n.title_en}
                  </p>
                  {(locale === "ar" ? n.body_ar : n.body_en) && (
                    <p className="text-xs text-muted mt-0.5">
                      {locale === "ar" ? n.body_ar : n.body_en}
                    </p>
                  )}
                  <p className="text-xs text-muted mt-1">
                    {new Date(n.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
