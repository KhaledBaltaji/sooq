// Auth server actions for Sooq Speed.
//
// W3 stripped the LMSR / branches / multi-level commission referral resolver
// that previously lived here. Sooq Speed v1 ships without referrals — re-add
// in a later phase via a fresh spec.

"use server";

import { signOut as authSignOut } from "@/auth";

export async function signOut() {
  await authSignOut({ redirectTo: "/login" });
}
