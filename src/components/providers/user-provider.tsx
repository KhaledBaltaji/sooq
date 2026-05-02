"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import * as Sentry from "@sentry/nextjs";
import { useSupabase } from "./supabase-provider";
import type { User } from "@supabase/supabase-js";
import type { User as AppUser } from "@/types/user";

interface UserContextValue {
  user: AppUser | null;
  authUser: User | null;
  loading: boolean;
  authLoading: boolean;
  refetch: () => Promise<AppUser | null>;
  adjustBalance: (delta: number) => void;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

interface UserProviderProps {
  children: ReactNode;
  initialAuthUser: User | null;
  initialProfile: AppUser | null;
}

export function UserProvider({
  children,
  initialAuthUser,
  initialProfile,
}: UserProviderProps) {
  const supabase = useSupabase();
  const [authUser, setAuthUser] = useState<User | null>(initialAuthUser);
  const [profile, setProfile] = useState<AppUser | null>(initialProfile);
  const [authLoading, setAuthLoading] = useState(!initialAuthUser && initialAuthUser !== null ? true : false);
  const [profileLoading, setProfileLoading] = useState(false);
  // Track the initial auth user ID to detect changes
  const currentAuthId = useRef(initialAuthUser?.id ?? null);

  // Initialize loading states correctly:
  // - If we have server data (initialAuthUser provided or explicitly null), no loading needed
  // - The server always provides these props, so loading starts as false
  useEffect(() => {
    // Set Sentry user on mount if we have initial data
    if (initialAuthUser) {
      Sentry.setUser({ id: initialAuthUser.id, email: initialAuthUser.email });
    }
  }, []); // eslint-disable-line

  const fetchProfile = useCallback(async () => {
    const currentUser = authUser;
    if (!currentUser) {
      setProfile(null);
      setProfileLoading(false);
      return null;
    }
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", currentUser.id)
      .single();

    if (error) {
      console.error("Failed to fetch user profile:", error.message);
      setProfileLoading(false);
      return null;
    }

    const freshProfile = data as AppUser | null;
    setProfile(freshProfile);
    setProfileLoading(false);
    return freshProfile;
  }, [supabase, authUser]);

  const adjustBalance = useCallback((delta: number) => {
    setProfile((prev: AppUser | null) =>
      prev ? { ...prev, balance_usd: Math.max(0, prev.balance_usd + delta) } : prev
    );
  }, []);

  // Auth state change listener
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const newUser = session?.user ?? null;
      setAuthUser(newUser);
      setAuthLoading(false);

      if (newUser) {
        Sentry.setUser({ id: newUser.id, email: newUser.email });
        // If user ID changed, refetch profile
        if (newUser.id !== currentAuthId.current) {
          currentAuthId.current = newUser.id;
          setProfileLoading(true);
          setProfile(null);
        }
      } else {
        Sentry.setUser(null);
        currentAuthId.current = null;
        setProfile(null);
        setProfileLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  // Profile fetch + realtime subscription (when auth user changes)
  useEffect(() => {
    if (authLoading) return;
    if (!authUser) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    // Only fetch if we don't already have a matching profile
    if (!profile || profile.id !== authUser.id) {
      fetchProfile();
    }

    // Subscribe to profile changes
    const channel = supabase
      .channel("user-profile")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "users",
          filter: `id=eq.${authUser.id}`,
        },
        (payload) => setProfile(payload.new as AppUser)
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.error("User profile realtime subscription error");
        }
      });

    // Refetch profile when tab regains focus
    let lastProfileCheck = Date.now();
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastProfileCheck > 3000
      ) {
        lastProfileCheck = Date.now();
        fetchProfile();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [authUser, authLoading, supabase, fetchProfile, profile]);

  // Re-check auth when tab regains focus (catches server-set session cookies)
  useEffect(() => {
    let lastCheck = Date.now();
    const onVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastCheck > 3000
      ) {
        lastCheck = Date.now();
        supabase.auth
          .getUser()
          .then(({ data: { user: freshUser } }) => {
            setAuthUser(freshUser);
          })
          .catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [supabase]);

  const loading = authLoading || profileLoading;

  return (
    <UserContext.Provider
      value={{ user: profile, authUser, loading, authLoading, refetch: fetchProfile, adjustBalance }}
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
