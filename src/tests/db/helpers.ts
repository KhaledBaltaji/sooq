/**
 * Test helpers for database RPC tests.
 * These tests run against a real Supabase instance (local or remote).
 * Set SUPABASE_TEST_URL and SUPABASE_SERVICE_ROLE_KEY in .env.test
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

/** Retry an async operation with exponential backoff when rate-limited */
async function withRetry<T>(
  fn: () => Promise<T>,
  { maxRetries = 4, baseDelay = 2000 } = {}
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRateLimit = err?.message?.includes("rate limit") || err?.message?.includes("Rate limit");
      if (!isRateLimit || attempt === maxRetries) throw err;
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("withRetry: unreachable");
}

function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_TEST_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Missing SUPABASE_TEST_URL or NEXT_PUBLIC_SUPABASE_URL");
  return url;
}

function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return key;
}

// Service role client bypasses RLS
export function getServiceClient(): SupabaseClient {
  return createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw-fetch admin helpers.
//
// The SDK's `supabase.auth.admin.*` calls only accept JWT-format service-role
// keys. After a project rotates from HS256 → asymmetric (ECC) signing keys,
// the legacy JWT is rejected and the new sb_secret_… keys aren't yet wired
// through `auth.admin.*` in @supabase/supabase-js. Calling the GoTrue admin
// endpoints directly with the sb_secret_ key as a Bearer token works for
// either key format, so tests stay compatible across the migration.
// ─────────────────────────────────────────────────────────────────────────────

function adminAuthHeaders(): Record<string, string> {
  const key = getServiceRoleKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export async function adminCreateUser(input: {
  email: string;
  password: string;
  email_confirm?: boolean;
}): Promise<{ id: string; email: string }> {
  const res = await fetch(`${getSupabaseUrl()}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminAuthHeaders(),
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      email_confirm: input.email_confirm ?? true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.id) {
    const msg = body?.msg || body?.error_description || body?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return { id: body.id as string, email: body.email as string };
}

export async function adminDeleteUser(userId: string): Promise<void> {
  const res = await fetch(`${getSupabaseUrl()}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: adminAuthHeaders(),
  });
  // 404 = already deleted (idempotent cleanup); ignore.
  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.msg || body?.error_description || body?.error || `HTTP ${res.status}`;
    throw new Error(`adminDeleteUser failed: ${msg}`);
  }
}

/**
 * Create an authenticated Supabase client for a test user.
 * Uses the Admin Auth API to create a real auth user, then signs in.
 * The returned client has auth.uid() set so RPC functions work correctly.
 */
export async function createAuthenticatedClient(
  serviceClient: SupabaseClient,
  userOverrides: Record<string, unknown> = {}
): Promise<{ client: SupabaseClient; userId: string; cleanup: () => Promise<void> }> {
  const email = `test-${crypto.randomUUID()}@test.local`;
  const password = `test-password-${crypto.randomUUID()}`;

  // Create auth user via Admin API (with retry for rate limits)
  const { id: userId } = await withRetry(async () => {
    try {
      return await adminCreateUser({ email, password, email_confirm: true });
    } catch (err: any) {
      throw new Error(`Failed to create auth user: ${err?.message || "unknown"}`);
    }
  });

  // Update the users table row (created by trigger or insert manually).
  // Display name uses 12 hex chars + base36 timestamp suffix to make
  // collisions effectively impossible against accumulated fixtures.
  // (idx_users_display_name_unique is global and lower-cased.)
  const { error: upsertError } = await serviceClient.from("users").upsert({
    id: userId,
    phone: `+961${Math.floor(Math.random() * 90000000 + 10000000)}`,
    display_name: `Test User ${userId.slice(0, 12)}-${Date.now().toString(36).slice(-4)}`,
    balance_usd: 1000,
    locale: "en",
    ...userOverrides,
  });

  if (upsertError) {
    // Clean up the auth user if table insert fails
    await adminDeleteUser(userId).catch(() => {});
    throw new Error(`Failed to upsert user row: ${upsertError.message}`);
  }

  // Create a client and sign in as this user
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY for authenticated client");

  const userClient = createClient(getSupabaseUrl(), anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await withRetry(async () => {
    const { error: signInError } = await userClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      throw new Error(`Failed to sign in test user: ${signInError.message}`);
    }
  }).catch(async (err) => {
    await adminDeleteUser(userId).catch(() => {});
    throw err;
  });

  const cleanupFn = async () => {
    await adminDeleteUser(userId).catch(() => {});
  };

  return { client: userClient, userId, cleanup: cleanupFn };
}

// Create a test user via service role.
// Creates an auth.users row first (FK constraint), then upserts the public users row.
export async function createTestUser(
  client: SupabaseClient,
  overrides: Record<string, unknown> = {}
) {
  const email = `test-${crypto.randomUUID()}@test.local`;
  const password = `test-password-${crypto.randomUUID()}`;

  // Create auth user so the FK constraint is satisfied (with retry for rate limits)
  const { id } = await withRetry(async () => {
    try {
      return await adminCreateUser({ email, password, email_confirm: true });
    } catch (err: any) {
      throw new Error(`createTestUser auth failed: ${err?.message || "unknown"}`);
    }
  });

  const { error } = await client.from("users").upsert({
    id,
    phone: `+961${Math.floor(Math.random() * 90000000 + 10000000)}`,
    // 12-char UUID slice + base36 timestamp — see createAuthenticatedClient note above
    display_name: `Test User ${id.slice(0, 12)}-${Date.now().toString(36).slice(-4)}`,
    balance_usd: 1000,
    locale: "en",
    ...overrides,
  });
  if (error) {
    await adminDeleteUser(id).catch(() => {});
    throw new Error(`createTestUser failed: ${error.message}`);
  }
  return id;
}

// Create a test market (V3 AMM schema)
export async function createTestMarket(
  client: SupabaseClient,
  createdBy: string,
  overrides: Record<string, unknown> = {}
) {
  const id = crypto.randomUUID();
  const now = new Date();

  // Strip V2 pool columns that callers may still pass
  const {
    pool_yes: _py,
    pool_no: _pn,
    seed_amount_yes: _sy,
    seed_amount_no: _sn,
    ...cleanOverrides
  } = overrides;

  const { error } = await client.from("markets").insert({
    id,
    question_en: "Test market?",
    question_ar: "سوق اختباري؟",
    category: "politics",
    status: "open",
    opens_at: new Date(now.getTime() - 60000).toISOString(),
    closes_at: new Date(now.getTime() + 86400000).toISOString(), // +24h
    created_by: createdBy,
    // Snapshot resolution fee at "creation" so resolve/settle/record paths use it
    // (migration 245 — admin_create_market does this; we mirror for direct inserts)
    resolution_fee_rate_snapshot: 0.01,
    ...cleanOverrides,
  });
  if (error) throw new Error(`createTestMarket failed: ${error.message}`);

  // Initialize the AMM state (V3 LMSR)
  const { error: ammError } = await client.rpc("initialize_amm", {
    p_market_id: id,
  });
  if (ammError) throw new Error(`initialize_amm failed: ${ammError.message}`);

  return id;
}

// Create a referral chain: A → B → C → D
export async function createReferralChain(client: SupabaseClient) {
  const userA = await createTestUser(client, {
    agent_level: 4,
    direct_referral_count: 60,
    agent_activated: true,
  });
  const userB = await createTestUser(client, {
    referred_by: userA,
    referral_chain: [userA],
    agent_level: 2,
    direct_referral_count: 15,
    agent_activated: true,
  });
  const userC = await createTestUser(client, {
    referred_by: userB,
    referral_chain: [userB, userA],
    agent_level: 1,
    direct_referral_count: 3,
    agent_activated: true,
  });
  const userD = await createTestUser(client, {
    referred_by: userC,
    referral_chain: [userC, userB, userA],
  });

  return { userA, userB, userC, userD };
}

// Fund a user's balance
export async function fundUser(
  client: SupabaseClient,
  userId: string,
  amount: number
) {
  await client
    .from("users")
    .update({ balance_usd: amount })
    .eq("id", userId);

  // Also insert a seed transaction for ledger consistency
  await client.from("transactions").insert({
    user_id: userId,
    type: "seed",
    amount,
    balance_after: amount,
    description: "Test funding",
  });
}

// Fund a user's agent wallet
export async function fundAgentWallet(
  client: SupabaseClient,
  userId: string,
  amount: number
) {
  await client
    .from("users")
    .update({ agent_balance_usd: amount })
    .eq("id", userId);

  // Ledger entry for consistency
  await client.from("transactions").insert({
    user_id: userId,
    type: "commission",
    amount,
    balance_after: amount,
    description: "Test agent wallet funding",
  });
}

// ============================================================
// S2 Branch System helpers
// ============================================================

// Create a test branch
export async function createTestBranch(
  client: SupabaseClient,
  managerUserId: string,
  overrides: Record<string, unknown> = {}
) {
  const id = crypto.randomUUID();
  const code = `test-${id.slice(0, 8)}`;

  const { error } = await client.from("branches").insert({
    id,
    branch_code: code,
    name: `Test Branch ${code}`,
    status: "active",
    manager_user_id: managerUserId,
    yes_markup_pct: 0.05,
    no_markup_pct: 0.05,
    branch_fee_rate: 0.05,
    pool_balance: 0,
    ...overrides,
  });
  if (error) throw new Error(`createTestBranch failed: ${error.message}`);
  return { id, code };
}

// Create a test commission branch (book_type='commission' with all capital fields zero)
export async function createTestCommissionBranch(
  client: SupabaseClient,
  managerUserId: string,
  overrides: Record<string, unknown> = {}
) {
  const id = crypto.randomUUID();
  // Commission slug format: 3-20 chars, lowercase alphanum + hyphen. Use uuid hex chunks to satisfy.
  const code = overrides.branch_code as string | undefined
    ?? `cb-${id.replace(/-/g, "").slice(0, 10)}`;

  const { error } = await client.from("branches").insert({
    id,
    branch_code: code,
    name: `Test Commission Branch ${code}`,
    status: "active",
    manager_user_id: managerUserId,
    book_type: "commission",
    yes_markup_pct: 0,
    no_markup_pct: 0,
    branch_fee_rate: 0,
    exit_fee_pct: 0,
    pool_balance: 0,
    worst_case_total: 0,
    pending_payouts: 0,
    ...overrides,
  });
  if (error) throw new Error(`createTestCommissionBranch failed: ${error.message}`);
  return { id, code };
}

// Create a test branch agent
export async function createTestBranchAgent(
  client: SupabaseClient,
  branchId: string,
  userId: string,
  overrides: Record<string, unknown> = {}
) {
  const id = crypto.randomUUID();

  // Try with status column first (migration 231+), fall back without it
  const baseData = { id, branch_id: branchId, user_id: userId, agent_type: "commission", rate: 0.1, ...overrides };
  const { error } = await client.from("branch_agents").insert({ ...baseData, status: "approved" });
  if (error?.message?.includes("status")) {
    // status column doesn't exist yet — retry without it
    const { error: retryErr } = await client.from("branch_agents").insert(baseData);
    if (retryErr) throw new Error(`createTestBranchAgent failed: ${retryErr.message}`);
  } else if (error) {
    throw new Error(`createTestBranchAgent failed: ${error.message}`);
  }
  return id;
}

// Assign a user to a branch
export async function assignUserToBranch(
  client: SupabaseClient,
  userId: string,
  branchId: string,
  agentId?: string
) {
  const { error } = await client.from("branch_user_assignments").insert({
    user_id: userId,
    branch_id: branchId,
    agent_id: agentId || null,
  });
  if (error) throw new Error(`assignUserToBranch failed: ${error.message}`);
}

// Fund a branch pool
export async function fundBranchPool(
  client: SupabaseClient,
  branchId: string,
  amount: number
) {
  // Update cached balance
  await client
    .from("branches")
    .update({ pool_balance: amount })
    .eq("id", branchId);

  // Write ledger entry
  await client.from("branch_pools").insert({
    branch_id: branchId,
    type: "credit",
    amount,
    balance_after: amount,
    description: "Test branch pool funding",
  });
}

// Execute a branch trade via service client (bypasses auth for testing)
export async function executeBranchTrade(
  client: SupabaseClient,
  params: {
    marketId: string;
    branchId: string;
    side: string;
    amount?: number;
    sharesToSell?: number;
    idempotencyKey?: string;
  }
) {
  const { data, error } = await client.rpc("execute_branch_trade", {
    p_market_id: params.marketId,
    p_branch_id: params.branchId,
    p_side: params.side,
    p_amount: params.amount || null,
    p_shares_to_sell: params.sharesToSell || null,
    p_idempotency_key: params.idempotencyKey || null,
  });
  return { data, error };
}

// ============================================================
// Demo Mode helpers (migration 263-265)
// ============================================================

/**
 * Create a demo market with scheduled outcome + AMM state. Mirrors createTestMarket
 * for demo_markets. Returns the market id. Uses service-role client (bypasses RLS).
 */
export async function createTestDemoMarket(
  client: SupabaseClient,
  createdBy: string,
  overrides: {
    resolvesAt?: string;
    scheduledOutcome?: "yes" | "no";
    closesAt?: string;
    liquidityParam?: number;
    status?: "open" | "closed" | "resolved" | "voided" | "draft";
    questionEn?: string;
    questionAr?: string;
  } = {}
) {
  const id = crypto.randomUUID();
  const now = new Date();
  const resolvesAt =
    overrides.resolvesAt ?? new Date(now.getTime() + 86400000).toISOString();
  const closesAt = overrides.closesAt ?? resolvesAt;
  const b = overrides.liquidityParam ?? 5000;

  // demo_closes_after_opens check constraint requires opens_at < closes_at.
  // When tests pass a past closesAt (e.g. cron resolve tests), keep opens_at even earlier.
  const closesAtMs = Date.parse(closesAt);
  const opensAt = new Date(Math.min(now.getTime() - 60000, closesAtMs - 60000)).toISOString();

  const { error: marketErr } = await client.from("demo_markets").insert({
    id,
    question_en: overrides.questionEn ?? `Demo test market ${id.slice(0, 8)}?`,
    question_ar: overrides.questionAr ?? `سوق اختبار تجريبي ${id.slice(0, 8)}؟`,
    category: "politics",
    status: overrides.status ?? "open",
    amm_liquidity_param: b,
    opens_at: opensAt,
    closes_at: closesAt,
    resolves_at: resolvesAt,
    created_by: createdBy,
    resolution_fee_rate_snapshot: 0,
  });
  if (marketErr) throw new Error(`createTestDemoMarket failed: ${marketErr.message}`);

  const { error: scheduleErr } = await client
    .from("demo_market_scheduled_outcomes")
    .insert({
      market_id: id,
      scheduled_outcome: overrides.scheduledOutcome ?? "yes",
      created_by: createdBy,
    });
  if (scheduleErr)
    throw new Error(`createTestDemoMarket schedule failed: ${scheduleErr.message}`);

  const { error: ammErr } = await client.from("demo_amm_state").insert({
    market_id: id,
    liquidity_param: b,
    q_yes: 0,
    q_no: 0,
    current_yes_price: 0.5,
    current_no_price: 0.5,
  });
  if (ammErr) throw new Error(`createTestDemoMarket amm failed: ${ammErr.message}`);

  return id;
}

/** Call toggle_demo_mode(true) for a user via their authenticated client. */
export async function enableDemoMode(userClient: SupabaseClient) {
  const { data, error } = await userClient.rpc("toggle_demo_mode", {
    p_enabled: true,
  });
  if (error) throw new Error(`enableDemoMode failed: ${error.message}`);
  return data;
}

/** Fund a user's demo balance via service-role direct update (bypasses trigger). */
export async function fundDemo(
  client: SupabaseClient,
  userId: string,
  amount: number
) {
  const { error } = await client
    .from("users")
    .update({
      demo_balance_usd: amount,
      demo_first_enabled_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw new Error(`fundDemo failed: ${error.message}`);
}

/** Clear conversion-analytics columns for test isolation. */
export async function resetDemoConversionColumns(
  client: SupabaseClient,
  userId: string
) {
  const { error } = await client
    .from("users")
    .update({
      demo_first_trade_at: null,
      first_real_deposit_after_demo_at: null,
    })
    .eq("id", userId);
  if (error)
    throw new Error(`resetDemoConversionColumns failed: ${error.message}`);
}

/**
 * Assert that a callback produces ZERO new rows in every live-money table for
 * the given user. Filters by user_id so parallel test runs don't cross-contaminate.
 *
 * Audited from execute_trade, resolve_market, pay_trade_commissions,
 * settle_resolution_commissions, record_revenue, branch_settle_resolution.
 */
export async function assertZeroLiveWrites(
  client: SupabaseClient,
  userId: string,
  callback: () => Promise<unknown>
) {
  const tables = [
    "transactions",
    "positions",
    "trades",
    "price_alerts",
    "leader_stats",
    "commissions",
    "referral_commissions",
    "balance_history",
    "platform_revenue",
    "copy_settings",
  ] as const;

  const before: Record<string, number> = {};
  for (const t of tables) {
    const { count } = await client
      .from(t)
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    before[t] = count ?? 0;
  }

  // Also snapshot live balance_usd
  const { data: userBefore } = await client
    .from("users")
    .select("balance_usd, total_wagered")
    .eq("id", userId)
    .single();

  await callback();

  for (const t of tables) {
    const { count } = await client
      .from(t)
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    const after = count ?? 0;
    if (after !== before[t]) {
      throw new Error(
        `assertZeroLiveWrites: table ${t} grew from ${before[t]} to ${after} for user ${userId}`
      );
    }
  }

  const { data: userAfter } = await client
    .from("users")
    .select("balance_usd, total_wagered")
    .eq("id", userId)
    .single();

  if (userBefore && userAfter) {
    if (Number(userBefore.balance_usd) !== Number(userAfter.balance_usd)) {
      throw new Error(
        `assertZeroLiveWrites: balance_usd changed from ${userBefore.balance_usd} to ${userAfter.balance_usd}`
      );
    }
    if (Number(userBefore.total_wagered) !== Number(userAfter.total_wagered)) {
      throw new Error(
        `assertZeroLiveWrites: total_wagered changed from ${userBefore.total_wagered} to ${userAfter.total_wagered}`
      );
    }
  }
}

/** Cleanup helper for demo tables. Called before user cleanup. */
export async function cleanupDemo(
  client: SupabaseClient,
  userIds: string[],
  demoMarketIds: string[] = []
) {
  if (demoMarketIds.length > 0) {
    await client.from("demo_transactions").delete().in("user_id", userIds);
    await client.from("demo_trades").delete().in("market_id", demoMarketIds);
    await client.from("demo_positions").delete().in("market_id", demoMarketIds);
    await client.from("demo_amm_state").delete().in("market_id", demoMarketIds);
    await client.from("demo_market_scheduled_outcomes").delete().in("market_id", demoMarketIds);
    await client.from("demo_markets").delete().in("id", demoMarketIds);
  }
  if (userIds.length > 0) {
    await client.from("demo_transactions").delete().in("user_id", userIds);
    await client.from("demo_trades").delete().in("user_id", userIds);
    await client.from("demo_positions").delete().in("user_id", userIds);
  }
}

// Clean up test data — must cover ALL FK references to users and markets
// Order: branch tables first (FKs to trades/positions/users/markets), then core tables
export async function cleanup(
  client: SupabaseClient,
  userIds: string[],
  marketIds: string[] = [],
  branchIds: string[] = []
) {
  // Branch cleanup first (has FKs to trades, users, markets)
  if (branchIds.length > 0) {
    await client.from("credit_chain_ledger").delete().in("branch_id", branchIds);
    await client.from("branch_admin_overrides").delete().in("branch_id", branchIds);
    await client.from("branch_market_config").delete().in("branch_id", branchIds);
    await client.from("branch_trades").delete().in("branch_id", branchIds);
    await client.from("branch_pools").delete().in("branch_id", branchIds);
    await client.from("branch_user_assignments").delete().in("branch_id", branchIds);
    await client.from("branch_agents").delete().in("branch_id", branchIds);
    await client.from("branches").delete().in("id", branchIds);
  }
  if (marketIds.length > 0) {
    // Branch tables that reference markets (in case branch cleanup wasn't explicit)
    await client.from("branch_trades").delete().in("market_id", marketIds);
    await client.from("branch_market_config").delete().in("market_id", marketIds);
    await client.from("referral_commissions").delete().in("market_id", marketIds);
    await client.from("platform_revenue").delete().in("market_id", marketIds);
    await client.from("price_alerts").delete().in("market_id", marketIds);
    await client.from("trades").delete().in("market_id", marketIds);
    await client.from("positions").delete().in("market_id", marketIds);
    await client.from("market_comments").delete().in("market_id", marketIds);
    await client.from("amm_state").delete().in("market_id", marketIds);
    await client.from("markets").delete().in("id", marketIds);
  }
  if (userIds.length > 0) {
    // Branch tables that reference users (in case branch cleanup wasn't explicit)
    await client.from("branch_trades").delete().in("user_id", userIds);
    await client.from("branch_user_assignments").delete().in("user_id", userIds);
    await client.from("credit_chain_ledger").delete().in("issuer_id", userIds);
    await client.from("credit_chain_ledger").delete().in("recipient_id", userIds);
    await client.from("copy_settings").delete().in("copier_id", userIds);
    await client.from("copy_settings").delete().in("leader_id", userIds);
    await client.from("leader_stats").delete().in("user_id", userIds);
    await client.from("referral_commissions").delete().in("trader_id", userIds);
    await client.from("referral_commissions").delete().in("referrer_id", userIds);
    await client.from("transactions").delete().in("user_id", userIds);
    await client.from("deposits").delete().in("user_id", userIds);
    await client.from("withdrawals").delete().in("user_id", userIds);
    await client.from("notifications").delete().in("user_id", userIds);
    await client.from("price_alerts").delete().in("user_id", userIds);
    await client.from("user_wallets").delete().in("user_id", userIds);
    await client.from("users").delete().in("id", userIds);
    // Clean up auth users (created by createTestUser)
    for (const uid of userIds) {
      await adminDeleteUser(uid).catch(() => {});
    }
  }
}
