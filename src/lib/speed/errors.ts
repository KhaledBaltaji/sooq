/**
 * Maps raw error strings from speed_execute_trade / speed_execute_cashout
 * (mig 0028+) onto user-visible copy + a categorical kind for analytics.
 *
 * The raw strings are produced by `RAISE EXCEPTION '...'` in the RPCs and
 * surfaced to the client via `/api/speed/{trade,cashout}` route bodies.
 * We pattern-match prefixes / substrings rather than exact equality because
 * some messages include interpolated values (rates, thresholds, etc).
 *
 * If `next-intl` translations exist for an error kind, the caller can
 * use `kind` to look them up in `messages/{en,ar}.json` under
 * `speed.errors.<kind>`. The `userMessage` returned here is the English
 * fallback used when no translation key resolves.
 */

export type SpeedErrorKind =
  // Mig 0028 pricing/cashout reject paths
  | "iv_drift"
  | "parity_drift_bucket"
  | "parity_drift"
  | "insufficient_profit"
  | "insufficient_loss"
  | "near_decided_entry"
  | "near_decided_cashout"
  | "late_window_reject"
  // Mig 0028+ caps
  | "side_cap"
  | "cluster_cap"
  | "ngr_floor"
  // Mig 0031 soft guards
  | "velocity"
  | "open_exposure"
  // Mig 0034 pricing engine v3
  | "soft_block"
  | "max_payout_cap"
  | "cashout_at_cap"
  | "limit_reached"
  | "ngr_soft_block"
  | "ngr_hard_stop"
  // Pre-existing
  | "balance"
  | "stake_range"
  | "market_closed"
  | "market_not_open"
  | "oracle_stale"
  | "frozen"
  | "duplicate"
  | "kill_switch"
  | "unauthorized"
  | "unknown";

export interface SpeedErrorMapped {
  kind: SpeedErrorKind;
  userMessage: string;
  /** True when a quote refresh is the right next action. */
  retryable: boolean;
}

/**
 * Map a raw error string from the speed RPCs into a user-friendly form.
 *
 * Matches mig 0028-0031 error strings:
 *   - `IV_DRIFT: server_iv=% client_iv=% — please retry`
 *   - `PARITY_DRIFT [seconds_left_bucket]: expected=% actual=%`
 *   - `PARITY_DRIFT [<field>]: expected=% actual=% drift=% > tol=%`
 *   - `INSUFFICIENT_PROFIT: profit too small to lock in cleanly (...)`
 *   - `INSUFFICIENT_LOSS: rounded cashout would not register a loss (...)`
 *   - `Slow down — too many bets per minute (% of % allowed)`
 *   - `Per-user open-exposure cap reached: ...`
 *   - `Cap reached on % side: max remaining $%`
 *   - `Insufficient balance`
 *   - `Speed market is not open` / `Speed market has closed`
 *   - `Oracle price stale (>%s sec); try again`
 *   - `Account is frozen`
 *   - `Speed markets are currently disabled`
 *   - `Cashout temporarily disabled — please try again shortly`
 *   - `Not authenticated`
 *   - `Market closing — no cashouts in last %s seconds`
 *   - `In last 30s, near-decided ...`
 */
export function mapSpeedRpcError(raw: string | null | undefined): SpeedErrorMapped {
  const msg = (raw ?? "").trim();
  if (!msg) {
    return { kind: "unknown", userMessage: "Something went wrong.", retryable: false };
  }

  // ---- Mig 0034 pricing engine v3 errors ----
  // Mig 0058 follow-up: replaced misleading "Market closing" copy with
  // honest text describing the actual condition (this side is past the
  // 0.97 ceiling). Server error string still matches both the old
  // "market closing" substring and the new SOFT_BLOCK prefix for back-
  // compat with any in-flight tickets that hit the old exception string.
  if (msg.startsWith("SOFT_BLOCK") || msg.includes("market closing — try next round")) {
    return {
      kind: "soft_block",
      userMessage: "Odds too one-sided here — try the other side.",
      retryable: false,
    };
  }
  if (msg.startsWith("MAX_PAYOUT_CAP")) {
    return {
      kind: "max_payout_cap",
      userMessage: "Stake too large for these odds — try smaller.",
      retryable: false,
    };
  }
  if (msg.startsWith("CASHOUT_AT_CAP")) {
    return {
      kind: "cashout_at_cap",
      // Copy fix (audit #3): explain WHY the user is held — the entry odds
      // are at the price ceiling, so cashout has no meaningful value. Hold
      // to settlement for the full payout instead.
      userMessage: "Stake is at the price cap — hold to settlement for full payout.",
      retryable: false,
    };
  }
  if (msg.includes("Limit reached — your max trade size")) {
    return {
      kind: "limit_reached",
      userMessage: "Limit reached — try a smaller stake or another market.",
      retryable: false,
    };
  }
  if (msg.includes("NGR hard stop") || msg.includes("Trading temporarily paused for system maintenance")) {
    return {
      kind: "ngr_hard_stop",
      userMessage: "Trading temporarily paused for system maintenance — please check back shortly.",
      retryable: true,
    };
  }

  // ---- Mig 0030 quote/execute parity drift ----
  if (msg.includes("PARITY_DRIFT [seconds_left_bucket]")) {
    return {
      kind: "parity_drift_bucket",
      userMessage: "Round window changed. Refresh and try again.",
      retryable: true,
    };
  }
  if (msg.includes("PARITY_DRIFT")) {
    return {
      kind: "parity_drift",
      userMessage: "Quote moved while you tapped. Try again.",
      retryable: true,
    };
  }

  // ---- Mig 0029 IV freshness ----
  if (msg.startsWith("IV_DRIFT")) {
    return {
      kind: "iv_drift",
      userMessage: "Price quote stale. Tap again.",
      retryable: true,
    };
  }

  // ---- Mig 0028 cashout rounding floors ----
  if (msg.startsWith("INSUFFICIENT_PROFIT")) {
    return {
      kind: "insufficient_profit",
      userMessage: "Profit too small to cash out cleanly. Hold to expiry.",
      retryable: false,
    };
  }
  if (msg.startsWith("INSUFFICIENT_LOSS")) {
    return {
      kind: "insufficient_loss",
      userMessage: "Loss too small to register. Hold to expiry.",
      retryable: false,
    };
  }

  // ---- Mig 0028 late-window blocks ----
  if (msg.includes("Market closing — no cashouts in last")) {
    return {
      kind: "late_window_reject",
      userMessage: "Cashout locked — round closing.",
      retryable: false,
    };
  }
  if (
    msg.toLowerCase().includes("near decided") ||
    msg.toLowerCase().includes("near-decided")
  ) {
    return {
      kind: "near_decided_cashout",
      userMessage: "Round near decided — let it ride.",
      retryable: false,
    };
  }

  // ---- Mig 0028+ caps ----
  if (msg.includes("Cap reached on")) {
    return {
      kind: "side_cap",
      userMessage: "Per-side cap reached on this market.",
      retryable: false,
    };
  }
  if (msg.toLowerCase().includes("strike cluster")) {
    return {
      kind: "cluster_cap",
      userMessage: "Cluster exposure cap reached on this strike.",
      retryable: false,
    };
  }
  if (msg.toLowerCase().includes("ngr floor")) {
    return {
      kind: "ngr_floor",
      userMessage: "Trading paused for the day. Try again after midnight UTC.",
      retryable: false,
    };
  }

  // ---- Mig 0031 soft guards ----
  if (msg.includes("Slow down")) {
    return {
      kind: "velocity",
      userMessage: "Slow down — too many bets per minute.",
      retryable: false,
    };
  }
  if (msg.includes("Per-user open-exposure cap reached")) {
    return {
      kind: "open_exposure",
      userMessage: "Open positions limit reached. Cash out one first.",
      retryable: false,
    };
  }

  // ---- Pre-existing checks ----
  if (msg.includes("Insufficient balance")) {
    return {
      kind: "balance",
      userMessage: "Insufficient balance.",
      retryable: false,
    };
  }
  if (msg.toLowerCase().includes("stake") && msg.includes("outside allowed range")) {
    return {
      kind: "stake_range",
      userMessage: "Stake outside allowed range.",
      retryable: false,
    };
  }
  if (msg.includes("Speed market has closed") || msg.includes("Market has closed")) {
    return {
      kind: "market_closed",
      userMessage: "Round closed. Wait for the next one.",
      retryable: false,
    };
  }
  if (
    msg.includes("Speed market is not open") ||
    msg.includes("Speed market has not opened yet")
  ) {
    return {
      kind: "market_not_open",
      userMessage: "Round not open yet.",
      retryable: false,
    };
  }
  if (msg.includes("Oracle price stale") || msg.includes("Oracle price unavailable")) {
    return {
      kind: "oracle_stale",
      userMessage: "Live price feed is stale. Try again in a moment.",
      retryable: true,
    };
  }
  if (msg.includes("Account is frozen")) {
    return {
      kind: "frozen",
      userMessage: "Account is frozen. Contact support.",
      retryable: false,
    };
  }
  if (
    msg.includes("Speed markets are currently disabled") ||
    msg.includes("Cashout temporarily disabled")
  ) {
    return {
      kind: "kill_switch",
      userMessage: "Trading temporarily paused. Try again shortly.",
      retryable: true,
    };
  }
  if (msg.includes("Duplicate") || msg.toLowerCase().includes("idempotent")) {
    return {
      kind: "duplicate",
      userMessage: "Already submitted.",
      retryable: false,
    };
  }
  if (msg.includes("Not authenticated") || msg.includes("Not authorised")) {
    return {
      kind: "unauthorized",
      userMessage: "Please sign in again.",
      retryable: false,
    };
  }

  // Default: surface the raw message but flag as unknown for analytics.
  return {
    kind: "unknown",
    userMessage: msg,
    retryable: false,
  };
}
