"use client";

import { useUserContext } from "@/components/providers/user-provider";

export function useSession() {
  const { authUser, authLoading } = useUserContext();
  return { user: authUser, loading: authLoading };
}

export function useUser() {
  const { user, authUser, loading, refetch, adjustBalance } = useUserContext();
  return { user, authUser, loading, refetch, adjustBalance };
}
