"use client";

// W7 cutover: TanStack Query polling against /api/notifications.
// Replaces the supabase realtime subscription that was failing CSP.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/hooks";

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title_en: string | null;
  title_ar: string | null;
  body_en: string | null;
  body_ar: string | null;
  reference_id: string | null;
  read_at: string | null;
  created_at: string;
}

interface ListResponse {
  notifications: Notification[];
}

export function useNotifications(limit = 20) {
  const { user } = useSession();

  const query = useQuery<ListResponse>({
    queryKey: ["notifications", user?.id, limit],
    queryFn: async () => {
      const res = await fetch(`/api/notifications?limit=${limit}`);
      if (!res.ok) throw new Error(`Failed to load notifications (${res.status})`);
      return res.json();
    },
    enabled: Boolean(user?.id),
    refetchInterval: 5_000,
    staleTime: 4_000,
    refetchOnWindowFocus: true,
  });

  return {
    notifications: query.data?.notifications ?? [],
    loading: query.isLoading,
  };
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      if (!res.ok) throw new Error(`Failed to mark read (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      // Invalidate the list so the bell badge refreshes.
      queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  const { user } = useSession();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) throw new Error(`Failed to mark all read (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] });
    },
  });
}
