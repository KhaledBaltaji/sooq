/**
 * middleware-auth-bypass.test.ts — regression test for Google OAuth on live.
 *
 * Incident: users on production (NEXT_PUBLIC_PRELAUNCH=true) could not sign in
 * with Google. Google redirects back to /auth/callback?code=... — but the
 * prelaunch gate in middleware.ts was redirecting all non-/api/ paths to
 * /shu-rayak, so the OAuth code exchange never ran.
 *
 * Fix: allowlist /auth/* in both the prelaunch and coming-soon gates.
 * This test proves the fix by asserting /auth/callback is NOT redirected.
 */

import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const ORIG_PRELAUNCH = process.env.NEXT_PUBLIC_PRELAUNCH;
const ORIG_COMING_SOON = process.env.COMING_SOON;

afterAll(() => {
  if (ORIG_PRELAUNCH === undefined) delete process.env.NEXT_PUBLIC_PRELAUNCH;
  else process.env.NEXT_PUBLIC_PRELAUNCH = ORIG_PRELAUNCH;
  if (ORIG_COMING_SOON === undefined) delete process.env.COMING_SOON;
  else process.env.COMING_SOON = ORIG_COMING_SOON;
});

describe("middleware prelaunch gate — /auth/* bypass", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_PRELAUNCH = "true";
    process.env.COMING_SOON = "false";
  });

  it("redirects / to /shu-rayak (gate is active)", async () => {
    const req = new NextRequest("https://sooq.exchange/");
    const res = await middleware(req);
    expect(res.headers.get("location") ?? "").toContain("/shu-rayak");
  });

  it("does NOT redirect /auth/callback (OAuth return path)", async () => {
    const req = new NextRequest(
      "https://sooq.exchange/auth/callback?code=fake-oauth-code"
    );
    const res = await middleware(req);
    expect(res.headers.get("location") ?? "").not.toContain("/shu-rayak");
  });

  it("does NOT redirect other /auth/* paths", async () => {
    const req = new NextRequest("https://sooq.exchange/auth/callback");
    const res = await middleware(req);
    expect(res.headers.get("location") ?? "").not.toContain("/shu-rayak");
  });

  it("does NOT redirect /api/* paths", async () => {
    const req = new NextRequest("https://sooq.exchange/api/health");
    const res = await middleware(req);
    expect(res.headers.get("location") ?? "").not.toContain("/shu-rayak");
  });
});

describe("middleware coming-soon gate — /auth/* bypass", () => {
  beforeEach(() => {
    process.env.COMING_SOON = "true";
    process.env.NEXT_PUBLIC_PRELAUNCH = "false";
  });

  it("redirects / to /coming-soon (gate is active)", async () => {
    const req = new NextRequest("https://sooq.exchange/");
    const res = await middleware(req);
    expect(res.headers.get("location") ?? "").toContain("/coming-soon");
  });

  it("does NOT redirect /auth/callback (OAuth return path)", async () => {
    const req = new NextRequest(
      "https://sooq.exchange/auth/callback?code=fake-oauth-code"
    );
    const res = await middleware(req);
    expect(res.headers.get("location") ?? "").not.toContain("/coming-soon");
  });
});
