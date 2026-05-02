-- ============================================================================
-- 344_backfill_speed_oracle_klines.sql
--
-- Backfill speed_oracle_klines from speed_oracle_ticks for the gap between
-- Push F (mig 343) deploy and the new @kline_1s worker actually starting to
-- write klines.
--
-- Push F was committed at 2026-04-27T19:31:55Z but Railway is not in any
-- GitHub Actions workflow, so the worker only redeployed manually ~70 minutes
-- later. During that window, speed_oracle_klines was empty for all assets,
-- which made the price chart on long-duration markets (24h, 1h) render
-- almost-empty timelines because get_speed_klines (mig 343) only had a few
-- minutes of data.
--
-- speed_oracle_ticks has been written continuously since mig 313 (Phase 6c),
-- so we have hours of price points already. This migration synthesizes
-- 1-second OHLC rows from those ticks for every second-bucket that has at
-- least one tick but no existing kline row.
--
-- Idempotent: ON CONFLICT DO NOTHING via the (asset, ts, source) unique
-- index from mig 343. Running this twice is a no-op. The subquery filter
-- on `ts < earliest existing kline` means we never overwrite anything the
-- worker has already written, only fill the historical gap.
--
-- Note: synthesized klines may have lower fidelity than live klines because
-- speed_oracle_ticks captures @trade events (pre-Push-F) at ~3-5/sec, so a
-- 1-second bucket has 3-5 samples. Binance's own 1-second klines are built
-- from every trade in the bucket (potentially hundreds). For chart rendering
-- this is fine — visually indistinguishable past the right edge.
-- ============================================================================

INSERT INTO speed_oracle_klines (asset, source, ts, open_price, high_price, low_price, close_price, volume)
SELECT
  asset,
  source,
  bucket_ts AS ts,
  (array_agg(price ORDER BY tick_ts ASC))[1]  AS open_price,
  MAX(price)                                  AS high_price,
  MIN(price)                                  AS low_price,
  (array_agg(price ORDER BY tick_ts DESC))[1] AS close_price,
  0                                           AS volume
FROM (
  SELECT
    t.asset,
    t.source,
    date_trunc('second', t.ts) AS bucket_ts,
    t.price,
    t.ts AS tick_ts
  FROM speed_oracle_ticks t
  WHERE t.ts < (
    SELECT COALESCE(MIN(k.ts), now())
    FROM speed_oracle_klines k
    WHERE k.asset = t.asset
  )
) bucketed
GROUP BY asset, source, bucket_ts
ON CONFLICT (asset, ts, source) DO NOTHING;
