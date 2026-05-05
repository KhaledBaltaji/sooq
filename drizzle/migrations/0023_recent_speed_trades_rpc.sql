-- 0023_recent_speed_trades_rpc.sql
--
-- Public read-only RPC for the home-page "Live trade tape". Returns the
-- N most recent speed trades with anonymized handles — no PII (no email,
-- no phone, no display_name, no user_id leaks past the function boundary).
--
-- Anonymization strategy: handle = 'anon-' || first 5 hex chars of the
-- user's UUID (collisions across users are acceptable; uniqueness is not
-- the goal — anonymity is). UUIDs are random, so a 5-char prefix is
-- already opaque and enumeration-proof. No external salt needed.
--
-- The RPC is SECURITY DEFINER so it can read speed_trades regardless of
-- the caller's row-level grants, but exposes ONLY the anonymized columns
-- below — never the raw user_id.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_recent_speed_trades(
  p_limit INT DEFAULT 10
) RETURNS TABLE (
  trade_id      UUID,
  created_at    TIMESTAMPTZ,
  side          public.speed_side,
  stake_usd     NUMERIC(18, 2),
  asset         TEXT,
  duration      public.speed_duration,
  who_handle    TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    t.id                                                          AS trade_id,
    t.created_at                                                  AS created_at,
    p.side                                                        AS side,
    t.amount                                                      AS stake_usd,
    m.asset                                                       AS asset,
    m.duration                                                    AS duration,
    'anon-' || substr(replace(t.user_id::text, '-', ''), 1, 5)    AS who_handle
  FROM public.speed_trades t
  JOIN public.speed_positions p ON p.id = t.position_id
  JOIN public.speed_markets   m ON m.id = t.market_id
  WHERE t.kind = 'open'
  ORDER BY t.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

COMMENT ON FUNCTION public.get_recent_speed_trades(INT) IS
  '0023: Public read-only feed for the home page Live Trade Tape. Returns at most 50 most recent OPEN trades with anonymized 5-char-UUID handles. No PII exposed.';

REVOKE ALL ON FUNCTION public.get_recent_speed_trades(INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_recent_speed_trades(INT) TO PUBLIC;

COMMIT;
