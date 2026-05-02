"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// OTP verification is now handled inside the login page multi-step flow.
// This page redirects to /login for backwards compatibility.
export default function VerifyPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/login");
  }, [router]);

  return null;
}
