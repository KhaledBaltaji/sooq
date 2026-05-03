"use client";

// W7 cutover: TanStack Query hooks (useNotifications + useMarkNotificationRead).

import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { Bell } from "lucide-react";
import { SignInPrompt } from "@/components/auth/sign-in-prompt";
import { useSession } from "@/lib/auth/hooks";
import {
  useNotifications,
  useMarkNotificationRead,
} from "@/hooks/use-notifications";

export default function NotificationsPage() {
  const { user, loading: authLoading } = useSession();
  const locale = useLocale();
  const { notifications, loading } = useNotifications(50);
  const markRead = useMarkNotificationRead();

  if (!authLoading && !user) {
    return (
      <SignInPrompt
        icon={Bell}
        title="Sign in to view your notifications"
        description="Get real-time alerts for market resolutions, deposits, and updates to your positions."
      />
    );
  }

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
          {notifications.map((n) => {
            const isRead = Boolean(n.read_at);
            return (
              <button
                key={n.id}
                onClick={() => !isRead && markRead.mutate(n.id)}
                className={cn(
                  "w-full text-left px-sm py-sm rounded-lg transition-colors",
                  isRead ? "bg-surface" : "bg-yes/5 hover:bg-yes/10"
                )}
              >
                <div className="flex items-start gap-sm">
                  {!isRead && <span className="w-2 h-2 rounded-full bg-yes mt-1.5 flex-shrink-0" />}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
