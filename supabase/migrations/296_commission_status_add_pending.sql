-- ============================================================
-- 296: Commission Branch Phase B part 1 — add 'pending' to commission_status enum
--
-- Context: we're switching commissions from a 30-day monthly lock (mig 250)
-- to release-at-resolution. A commission earned on a trade during an open
-- market stays `pending` until the market resolves; at that moment it flips
-- to `credited` (and the agent's wallet is incremented). If the market
-- voids, the pending commission flips to `voided` (no balance ever changed).
--
-- Mig 297 adds the state transitions (function body changes). This mig just
-- adds the enum value so 297 can reference it.
--
-- NOTE: ALTER TYPE ... ADD VALUE is unwrapped (no BEGIN/COMMIT) per Postgres
-- requirement — the new value cannot be used in the same transaction that
-- creates it. IF NOT EXISTS guards against double-apply.
-- ============================================================

ALTER TYPE commission_status ADD VALUE IF NOT EXISTS 'pending';
