"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AgentDashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/referral");
  }, [router]);
  return null;
}
