"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSupabase } from "@/components/providers/supabase-provider";

const POLL_MS = 3000;
const GRACE_MS = 10000;

export function RealtimeStatus() {
  const pathname = usePathname();
  const supabase = useSupabase();
  const [showBanner, setShowBanner] = useState(false);
  const mountedAt = useRef(Date.now());
  const disconnectedSince = useRef<number | null>(null);

  useEffect(() => {
    mountedAt.current = Date.now();

    function check() {
      const now = Date.now();
      // No channels subscribed = no data to be stale about
      if (supabase.realtime.channels.length === 0) {
        disconnectedSince.current = null;
        setShowBanner(false);
        return;
      }
      if (supabase.realtime.isConnected()) {
        disconnectedSince.current = null;
        setShowBanner(false);
      } else {
        if (!disconnectedSince.current) disconnectedSince.current = now;
        const elapsed = now - disconnectedSince.current;
        const pastGrace = now - mountedAt.current > GRACE_MS;
        if (pastGrace && elapsed > GRACE_MS) setShowBanner(true);
      }
    }

    const id = setInterval(check, POLL_MS);
    const onOnline = () => check();
    const onOffline = () => {
      disconnectedSince.current = Date.now();
      setShowBanner(true);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      clearInterval(id);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [supabase]);

  if (!showBanner || pathname === "/coming-soon" || pathname === "/shu-rayak") return null;

  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-warning/90 text-warning-foreground text-center py-1.5 text-xs font-medium backdrop-blur-sm pt-safe">
      Prices may be stale — reconnecting...
    </div>
  );
}
