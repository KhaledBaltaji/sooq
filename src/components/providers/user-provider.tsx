"use client";

// User context — auth state via Auth.js useSession, profile via /api/users/me.
// W7 cutover: Supabase auth listener + realtime subscription removed.
// Profile shape stays snake_case (matches /api/users/me JSON) so existing
// components don't need rewrites.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import * as Sentry from "@sentry/nextjs";
import { useSession } from "next-auth/react";
import type { User } from "@/types/user";

interface AuthUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface UserContextValue {
  user: User | null;
  authUser: AuthUser | null;
  loading: boolean;
  authLoading: boolean;
  refetch: () => Promise<User | null>;
  adjustBalance: (delta: number) => void;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

interface UserProviderProps {
  children: ReactNode;
  initialProfile: User | null;
}

export function UserProvider({ children, initialProfile }: UserProviderProps) {
  const { data: session, status } = useSession();
  const authLoading = status === "loading";
  const authUser: AuthUser | null = session?.user
    ? {
        id: (session.user as { id?: string }).id ?? "",
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }
    : null;

  const [profile, setProfile] = useState<User | null>(initialProfile);
  const [profileLoading, setProfileLoading] = useState(false);

  // Sentry user tagging follows the session.
  useEffect(() => {
    if (authUser?.id) {
      Sentry.setUser({ id: authUser.id, email: authUser.email ?? undefined });
    } else {
      Sentry.setUser(null);
    }
  }, [authUser?.id, authUser?.email]);

  const fetchProfile = useCallback(async (): Promise<User | null> => {
    if (!authUser?.id) {
      setProfile(null);
      setProfileLoading(false);
      return null;
    }
    setProfileLoading(true);
    try {
      const res = await fetch("/api/users/me");
      if (!res.ok) {
        setProfileLoading(false);
        return null;
      }
      const data = (await res.json()) as User;
      setProfile(data);
      setProfileLoading(false);
      return data;
    } catch (err) {
      console.error("Failed to fetch /api/users/me:", err);
      setProfileLoading(false);
      return null;
    }
  }, [authUser?.id]);

  const adjustBalance = useCallback((delta: number) => {
    setProfile((prev) =>
      prev
        ? { ...prev, balance_usd: Math.max(0, prev.balance_usd + delta) }
        : prev
    );
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!authUser?.id) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    if (!profile || profile.id !== authUser.id) {
      fetchProfile();
    }

    let lastCheck = Date.now();
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastCheck > 3000
      ) {
        lastCheck = Date.now();
        fetchProfile();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authUser?.id, authLoading, fetchProfile, profile]);

  const loading = authLoading || profileLoading;

  return (
    <UserContext.Provider
      value={{
        user: profile,
        authUser,
        loading,
        authLoading,
        refetch: fetchProfile,
        adjustBalance,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUserContext() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useUserContext must be used within a UserProvider");
  }
  return context;
}
