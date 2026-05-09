// PATCH /api/admin/markets-config/[asset]/[duration] — Phase 5E
//
// Updates one or more columns on a single (asset, duration) row in
// speed_market_config. Server-side validation:
//   1. requireAdminApi (admin role check)
//   2. Zod schema mirroring the CHECK constraints from mig 0042
//   3. Per-key whitelist — anything not in EDITABLE_COLUMNS is rejected
//
// Per Phase 2D banner on /admin/fees, these are the values that the
// trade + cashout RPCs read from speed_market_config first (with
// fee_config fallback). This endpoint is the canonical write path.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  authErrorToResponse,
  requireAdminApi,
} from "@/lib/auth/api-guards";
import { logger } from "@/lib/logger";

// All editable columns + per-column Zod validators. Mirrors mig 0042
// CHECK constraints. Server is the second line of defence; CHECK is the
// first (rejects bad values at the DB layer).
const SCHEMA = z
  .object({
    stake_min_usd: z.number().positive().max(100).optional(),
    stake_max_usd: z.number().positive().max(1_000_000).optional(),
    payout_max_usd: z.number().positive().max(10_000_000).optional(),
    cap_per_side_usd: z.number().positive().max(100_000).optional(),
    per_side_pool_pct: z.number().positive().max(1).optional(),
    per_user_open_exposure_pct: z.number().positive().max(1).optional(),
    velocity_max_per_min: z.number().int().positive().max(10_000).optional(),
    daily_handle_alert_usd: z.number().nonnegative().optional(),
    spread_pct: z.number().nonnegative().max(0.5).optional(),
    soft_block_threshold: z.number().gt(0.5).lt(1).optional(),
    soft_block_unlock: z.number().gt(0.5).lt(1).optional(),
    late_window_60s_secs: z.number().int().positive().lt(3600).optional(),
    late_window_30s_secs: z.number().int().positive().lt(3600).optional(),
    late_window_60s_mult: z.number().min(1).max(5).optional(),
    late_window_30s_mult: z.number().min(1).max(5).optional(),
    last_n_reject_secs: z.number().int().nonnegative().lt(600).optional(),
    near_decided_dist: z.number().nonnegative().max(0.5).optional(),
    cashout_winning_base: z.number().nonnegative().lt(1).optional(),
    cashout_losing_base: z.number().nonnegative().lt(1).optional(),
    cashout_saturation_coef: z.number().nonnegative().max(5).optional(),
    cashout_desperation_coef: z.number().nonnegative().max(5).optional(),
    cashout_late_winning_coef: z.number().nonnegative().max(1).optional(),
    cashout_late_losing_coef: z.number().nonnegative().max(1).optional(),
    cashout_reject_secs: z.number().int().nonnegative().lt(600).optional(),
    cashout_late_30s_imbalance: z.number().nonnegative().max(0.5).optional(),
    cashout_cap_edge_threshold: z.number().gt(0.9).lt(1).optional(),
    matrix_min_n_eff: z.number().int().positive().max(100_000).optional(),
    matrix_ci_max_width: z.number().positive().max(1).optional(),
    matrix_prior_n: z.number().int().nonnegative().max(10_000).optional(),
    matrix_calibration_window_days: z.number().int().positive().max(90).optional(),
    enabled: z.boolean().optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

const ASSET_RE = /^[A-Z]{2,10}$/;
const DURATION_RE = /^(1m|5m|15m|1h|24h)$/;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ asset: string; duration: string }> },
) {
  try {
    const admin = await requireAdminApi();
    const { asset, duration } = await params;

    if (!ASSET_RE.test(asset)) {
      return NextResponse.json({ error: "Invalid asset" }, { status: 400 });
    }
    if (!DURATION_RE.test(duration)) {
      return NextResponse.json({ error: "Invalid duration" }, { status: 400 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = SCHEMA.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid input",
          issues: parsed.error.issues.map(
            (i) => `${i.path.join(".")}: ${i.message}`,
          ),
        },
        { status: 400 },
      );
    }

    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    // Cross-column constraint check before write (matches mig 0042 CHECK)
    if (
      updates.soft_block_unlock !== undefined &&
      updates.soft_block_threshold !== undefined &&
      updates.soft_block_unlock >= updates.soft_block_threshold
    ) {
      return NextResponse.json(
        { error: "soft_block_unlock must be < soft_block_threshold" },
        { status: 400 },
      );
    }

    // Build dynamic SET clause via drizzle's sql.raw — keys are whitelisted
    // by the Zod schema above so this is safe.
    const setFragments = Object.entries(updates).map(
      ([k, v]) => sql`${sql.raw(k)} = ${v}`,
    );
    if (setFragments.length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const setClause = sql.join(setFragments, sql`, `);

    // Cascade tracking — when `enabled` is in the patch, we also touch the
    // asset gate + global feature flag so the toggle is a true master
    // switch from the admin UI perspective.
    const cascade: {
      asset_enabled?: boolean;
      gold_global_flag?: number;
      onem_global_flag?: number;
      worker_redeploy_required?: boolean;
    } = {};

    // Single transaction so toggle + cascade + audit log are atomic.
    const result = await db.transaction(async (tx) => {
      // 1. Update the per-row config
      const r = await tx.execute<{ asset: string }>(sql`
        UPDATE speed_market_config
          SET ${setClause}, updated_at = NOW()
        WHERE asset = ${asset} AND duration = ${duration}::speed_duration
        RETURNING asset, duration
      `);
      if (r.rows.length === 0) {
        throw new Error(`No speed_market_config row for ${asset} / ${duration}`);
      }

      // 2. Cascade — only when `enabled` was actually in the patch body
      if (updates.enabled !== undefined) {
        const enabling = updates.enabled === true;

        if (enabling) {
          // Turning ON: ensure ALL gates required for this market are ON
          // - speed_assets.{asset}.enabled = TRUE
          // - per-asset / per-duration global feature flag = 1
          await tx.execute(sql`
            UPDATE speed_assets SET enabled = TRUE
            WHERE id = ${asset} AND enabled = FALSE
          `);
          cascade.asset_enabled = true;

          if (asset === "GOLD") {
            await tx.execute(sql`
              UPDATE fee_config SET rate = 1
              WHERE fee_type = 'speed_gold_markets_enabled' AND rate <> 1
            `);
            cascade.gold_global_flag = 1;
            // Worker only streams PAXG if speed_assets.GOLD.enabled was TRUE
            // at boot. If asset was just flipped here, worker needs restart.
            cascade.worker_redeploy_required = true;
          }
          if (duration === "1m") {
            await tx.execute(sql`
              UPDATE fee_config SET rate = 1
              WHERE fee_type = 'speed_1m_markets_enabled' AND rate <> 1
            `);
            cascade.onem_global_flag = 1;
          }
        } else {
          // Turning OFF: only flip the per-row gate (already done above).
          // We do NOT auto-flip the asset gate or global flag because
          // OTHER markets of the same asset/duration might still be active.
          // Admin can flip those separately if they want a full asset shutdown.
          //
          // Exception: if turning OFF the only remaining enabled market for
          // an asset, the asset/global-flag stay ON but they're harmless
          // (no markets to gate; cron skips them anyway).
        }
      }

      // 3. Audit log — same transaction so no orphan logs
      await tx.execute(sql`
        INSERT INTO admin_action_log (admin_id, action, target_id, metadata)
        VALUES (
          ${admin.id}::uuid,
          'markets_config_update',
          NULL,
          ${JSON.stringify({ asset, duration, updates, cascade })}::jsonb
        )
      `);

      return r;
    });

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: `No speed_market_config row for ${asset} / ${duration}` },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      asset,
      duration,
      updated_fields: Object.keys(updates),
      cascade,
    });
  } catch (err) {
    const r = authErrorToResponse(err);
    if (r) return r;
    const msg = err instanceof Error ? err.message : "Internal error";
    logger.error(
      "markets-config PATCH failed",
      { source: "admin/markets-config" },
      err,
    );
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
