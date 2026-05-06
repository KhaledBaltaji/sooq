// Sooq Drizzle schema — surviving tables after W2/W3/W4 strips.
//
// Mirrors the post-strip Postgres schema (see supabase/migrations/364–366
// for the strip migrations). This file is the source of truth for Drizzle
// Kit; raw SQL migrations under supabase/migrations/ remain authoritative
// until W7 when the service migration cuts over.
//
// For brevity, this captures the major data-model tables. Internal speed
// telemetry tables (oracle_ticks, exposure_live, external_book_snapshots)
// are not modelled here yet — they're written by Postgres-side code only,
// not the application layer. They get added in W7 if needed.

import {
  pgTable,
  uuid,
  text,
  numeric,
  boolean,
  timestamp,
  integer,
  jsonb,
  pgEnum,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================================================
// Enums
// ============================================================================

// Mig 369: enum mirrors the DB type (which has 5m / 15m / 1h / 24h — keeping
// historical values for FK integrity). User-facing SpeedDuration type narrows
// to '5m' | '1h' (mig 361 + 363 + 369). Trade RPC rejects 15m / 24h at runtime.
export const speedDuration = pgEnum("speed_duration", ["5m", "15m", "1h", "24h"]);
export const speedSide = pgEnum("speed_side", ["over", "under"]);
export const speedMarketStatus = pgEnum("speed_market_status", [
  "open",
  "resolving",
  "resolved",
  "voided",
]);
export const speedMarketOutcome = pgEnum("speed_market_outcome", [
  "over",
  "under",
  "at_strike",
]);
export const speedPositionStatus = pgEnum("speed_position_status", [
  "open",
  "won",
  "lost",
  "cashed_out",
  "refunded",
]);
export const speedTradeKind = pgEnum("speed_trade_kind", ["open", "cashout"]);

export const transactionType = pgEnum("transaction_type", [
  "deposit",
  "withdrawal",
  "speed_stake",
  "speed_cashout",
  "speed_payout",
  "speed_refund",
  "admin_credit",
  "admin_debit",
]);

export const depositStatus = pgEnum("deposit_status", [
  "pending",
  "verified",
  "rejected",
  "expired",
]);

export const withdrawalStatus = pgEnum("withdrawal_status", [
  "pending",
  "approved",
  "rejected",
  "sent",
]);

// ============================================================================
// Users + auth (Auth.js v5 schema, extended with Sooq fields)
// ============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Auth.js standard fields
    name: text("name"),
    email: text("email"),
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    image: text("image"),
    // Sooq fields
    phone: text("phone"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    locale: text("locale").notNull().default("en"),
    balanceUsd: numeric("balance_usd", { precision: 18, scale: 6 })
      .notNull()
      .default("0"),
    isAdmin: boolean("is_admin").notNull().default(false),
    isFrozen: boolean("is_frozen").notNull().default(false),
    adminAllowedViews: text("admin_allowed_views").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    phoneIdx: uniqueIndex("users_phone_unique").on(t.phone),
    emailIdx: index("users_email_idx").on(t.email),
  })
);

// ---- Auth.js core tables (used by the Drizzle adapter) ----

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
    userIdx: index("accounts_user_idx").on(t.userId),
  })
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
  })
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  })
);

// ---- Sooq legacy: WhatsApp OTP via VerifyWay ----
// Used by /api/auth/{send-otp, verify-otp}. Kept separate from Auth.js's
// verificationTokens because the OTP flow has phone-specific concerns
// (rate limit, IP-based spray protection, message_id from VerifyWay).
export const otpVerifications = pgTable(
  "otp_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    messageId: text("message_id"),
    ip: text("ip"),
    attempts: integer("attempts").notNull().default(0),
    verified: boolean("verified").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    phoneExpiresIdx: index("otp_phone_expires_idx").on(t.phone, t.expiresAt),
  })
);

// ============================================================================
// Money flows
// ============================================================================

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: transactionType("type").notNull(),
    amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
    balanceAfter: numeric("balance_after", { precision: 18, scale: 6 }).notNull(),
    referenceId: uuid("reference_id"),
    description: text("description"),
    performedBy: uuid("performed_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index("transactions_user_created_idx").on(t.userId, t.createdAt),
  })
);

export const deposits = pgTable(
  "deposits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(), // '3pay' | 'whish'
    providerRef: text("provider_ref").notNull().unique(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    status: depositStatus("status").notNull().default("pending"),
    proofUrl: text("proof_url"),
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  }
);

export const withdrawals = pgTable(
  "withdrawals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    feeAmount: numeric("fee_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    netAmount: numeric("net_amount", { precision: 18, scale: 2 }),
    method: text("method").notNull(),
    accountDetails: jsonb("account_details"),
    status: withdrawalStatus("status").notNull().default("pending"),
    reviewerId: uuid("reviewer_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

// Crypto deposit addresses provisioned by 3pay. One row per user; addresses
// are stable for the lifetime of the user (3pay keeps mapping clientId →
// wallets server-side, so re-calls are idempotent — but caching here saves
// the round-trip on every wallet view).
export const userWallets = pgTable(
  "user_wallets",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("3pay"),
    providerUserId: text("provider_user_id"),
    walletAddressTrc20: text("wallet_address_trc20"),
    walletAddressErc20: text("wallet_address_erc20"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

// ============================================================================
// Speed mode
// ============================================================================

export const speedAssets = pgTable("speed_assets", {
  id: text("id").primaryKey(), // 'BTC', 'ETH', etc.
  displayName: text("display_name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const speedMarkets = pgTable(
  "speed_markets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    asset: text("asset")
      .notNull()
      .references(() => speedAssets.id),
    duration: speedDuration("duration").notNull(),
    strikePrice: numeric("strike_price", { precision: 24, scale: 8 }).notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    status: speedMarketStatus("status").notNull().default("open"),
    outcome: speedMarketOutcome("outcome"),
    twapAtClose: numeric("twap_at_close", { precision: 24, scale: 8 }),
    voidReason: text("void_reason"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    assetStatusIdx: index("speed_markets_asset_status_idx").on(t.asset, t.status),
    closesAtIdx: index("speed_markets_closes_at_idx").on(t.closesAt),
  })
);

export const speedPositions = pgTable(
  "speed_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    marketId: uuid("market_id")
      .notNull()
      .references(() => speedMarkets.id),
    side: speedSide("side").notNull(),
    stake: numeric("stake", { precision: 18, scale: 2 }).notNull(),
    entryPrice: numeric("entry_price", { precision: 24, scale: 8 }).notNull(),
    entryFairProb: numeric("entry_fair_prob", { precision: 6, scale: 4 }).notNull(),
    entryOfferedProb: numeric("entry_offered_prob", { precision: 6, scale: 4 }).notNull(),
    status: speedPositionStatus("status").notNull().default("open"),
    payoutAmount: numeric("payout_amount", { precision: 18, scale: 2 }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userMarketIdx: index("speed_positions_user_market_idx").on(t.userId, t.marketId),
    statusIdx: index("speed_positions_status_idx").on(t.status),
  })
);

export const speedTrades = pgTable(
  "speed_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    positionId: uuid("position_id")
      .notNull()
      .references(() => speedPositions.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    marketId: uuid("market_id")
      .notNull()
      .references(() => speedMarkets.id),
    kind: speedTradeKind("kind").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    spotPrice: numeric("spot_price", { precision: 24, scale: 8 }).notNull(),
    fairProb: numeric("fair_prob", { precision: 6, scale: 4 }).notNull(),
    offeredProb: numeric("offered_prob", { precision: 6, scale: 4 }).notNull(),
    handleFee: numeric("handle_fee", { precision: 18, scale: 6 }),
    // Mig 0028+: stores the applied cashout margin (option C profit-based formula).
    // Pre-mig-0028 rows store the old decay multiplier — semantics differ; use
    // created_at to disambiguate. Column kept under same name for backwards
    // compatibility with existing dashboards/queries.
    cashoutMultiplier: numeric("cashout_multiplier", { precision: 6, scale: 4 }),
    // Mig 0016: IV used at trade execution. NULL for pre-0016 trades.
    ivUsed: numeric("iv_used", { precision: 8, scale: 6 }),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotencyIdx: uniqueIndex("speed_trades_idempotency_user_idx").on(t.idempotencyKey, t.userId),
    userIdx: index("speed_trades_user_idx").on(t.userId),
  })
);

export const speedSettlements = pgTable(
  "speed_settlements",
  {
    positionId: uuid("position_id")
      .notNull()
      .references(() => speedPositions.id),
    marketId: uuid("market_id")
      .notNull()
      .references(() => speedMarkets.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    outcome: speedMarketOutcome("outcome").notNull(),
    payoutAmount: numeric("payout_amount", { precision: 18, scale: 2 }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.positionId] }),
    marketIdx: index("speed_settlements_market_idx").on(t.marketId),
  })
);

// ============================================================================
// Speed mode telemetry (Postgres-side reads/writes; thin app exposure)
// ============================================================================

export const speedOracleLatest = pgTable("speed_oracle_latest", {
  asset: text("asset").primaryKey().references(() => speedAssets.id),
  price: numeric("price", { precision: 24, scale: 8 }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
});

export const speedOracleTicks = pgTable(
  "speed_oracle_ticks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    asset: text("asset")
      .notNull()
      .references(() => speedAssets.id),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    price: numeric("price", { precision: 24, scale: 8 }).notNull(),
    source: text("source"),
  },
  (t) => ({
    assetTsIdx: index("speed_oracle_ticks_asset_ts_idx").on(t.asset, t.ts),
  })
);

// Mig 0029: realized volatility cache. Multi-horizon (5m, 15m, 1h, 24h, ewma).
// Written by services/speed-oracle/ at 30s cadence. Read by _speed_get_iv()
// inside speed_execute_trade and speed_execute_cashout.
export const speedVolatilityCache = pgTable(
  "speed_volatility_cache",
  {
    asset: text("asset").notNull(),
    horizon: text("horizon").notNull(),
    sigmaAnnualized: numeric("sigma_annualized", { precision: 8, scale: 6 }).notNull(),
    sampleCount: integer("sample_count"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.asset, t.horizon] }),
    computedIdx: index("speed_volatility_cache_computed_idx").on(t.computedAt),
  })
);

// Mig 0031: per-user behavioral alerts (velocity, exposure, daily-handle).
// daily_handle is one-row-per-user-per-day (unique constraint). Read by
// /admin/fees alert feed tile.
export const speedUserAlerts = pgTable(
  "speed_user_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    alertType: text("alert_type").notNull(),
    alertDate: timestamp("alert_date", { mode: "date" }).notNull(),
    threshold: numeric("threshold", { precision: 18, scale: 2 }),
    observed: numeric("observed", { precision: 18, scale: 2 }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    recentIdx: index("speed_user_alerts_recent_idx").on(t.createdAt),
  })
);

// ============================================================================
// Config (fee rates + admin PIN/preferences)
// ============================================================================

export const feeConfig = pgTable("fee_config", {
  feeType: text("fee_type").primaryKey(),
  rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

export const adminConfig = pgTable("admin_config", {
  adminUserId: uuid("admin_user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  pinHash: text("pin_hash"),
  pinAttempts: integer("pin_attempts").notNull().default(0),
  pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),
  lastPinSetAt: timestamp("last_pin_set_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================================
// Notifications
// ============================================================================

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    titleEn: text("title_en"),
    titleAr: text("title_ar"),
    bodyEn: text("body_en"),
    bodyAr: text("body_ar"),
    referenceId: uuid("reference_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index("notifications_user_created_idx").on(t.userId, t.createdAt),
  })
);

// ============================================================================
// Help center (mig 0012)
// ============================================================================

export const helpCollections = pgTable(
  "help_collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    icon: text("icon").notNull().default("help-circle"),
    locale: text("locale").notNull().default("en"),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    localeSortIdx: index("idx_help_collections_locale").on(t.locale, t.sortOrder),
  })
);

export const helpArticles = pgTable(
  "help_articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => helpCollections.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    collectionIdx: index("idx_help_articles_collection").on(t.collectionId, t.sortOrder),
    collectionSlugUq: uniqueIndex("help_articles_collection_id_slug_unique").on(
      t.collectionId,
      t.slug
    ),
  })
);

// ============================================================================
// Type exports for application use
// ============================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Deposit = typeof deposits.$inferSelect;
export type Withdrawal = typeof withdrawals.$inferSelect;
export type UserWallet = typeof userWallets.$inferSelect;
export type SpeedMarket = typeof speedMarkets.$inferSelect;
export type SpeedPosition = typeof speedPositions.$inferSelect;
export type NewSpeedPosition = typeof speedPositions.$inferInsert;
export type SpeedTrade = typeof speedTrades.$inferSelect;
export type SpeedVolatilityCache = typeof speedVolatilityCache.$inferSelect;
export type NewSpeedVolatilityCache = typeof speedVolatilityCache.$inferInsert;
export type SpeedUserAlert = typeof speedUserAlerts.$inferSelect;
export type NewSpeedUserAlert = typeof speedUserAlerts.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type HelpCollection = typeof helpCollections.$inferSelect;
export type NewHelpCollection = typeof helpCollections.$inferInsert;
export type HelpArticle = typeof helpArticles.$inferSelect;
export type NewHelpArticle = typeof helpArticles.$inferInsert;
