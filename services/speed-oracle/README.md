# Speed Oracle Worker

Streams Binance BTC/USDT trades via WebSocket and writes ticks to Supabase
`speed_oracle_ticks` (rolling history) + upserts `speed_oracle_latest` (cache
read by `speed_execute_trade` / `speed_execute_cashout` / `speed_resolve_market`).

Single persistent process. Running >1 replica produces duplicate ticks and
races the latest cache — keep `numReplicas = 1` forever.

## Stack

- Node 20 + TypeScript
- `ws` for WebSocket client
- `@supabase/supabase-js` for DB writes
- Built-in `http` for `/health`

## Env vars

| Var | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | `https://zzebptrztuwnqlxxmjuo.supabase.co` (staging) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key (NOT anon) |
| `PORT` | no | Health endpoint port. Railway sets automatically. |

## Local dev

```bash
cp .env.example .env  # then fill in your local Supabase URL + service-role key
npm install
npm run dev           # runs via tsx, no build step
```

Health endpoint: `http://localhost:3000/health`

## Deploy to Railway

**Staging auto-deploys on push to `staging` via
[deploy-oracle-staging.yml](../../.github/workflows/deploy-oracle-staging.yml)**.
Any change under `services/speed-oracle/**` triggers it. The workflow
runs `railway up` and polls `/health` until the worker reports healthy.
Manual `railway up` is no longer needed for staging.

The workflow needs one GitHub secret:
- `RAILWAY_TOKEN_STAGING` — generate via Railway dashboard → Project Settings → Tokens

The health URL is hardcoded inline in the workflow file (it's a public Railway
endpoint, not a secret). When the production worker lands, add a parallel
`RAILWAY_TOKEN_PRODUCTION` secret and a sibling `deploy-oracle-production.yml`.

### One-time Railway setup (already done on staging)

```bash
railway login
railway init   # creates a new Railway project from this directory

# Set env vars
railway variables set SUPABASE_URL=https://zzebptrztuwnqlxxmjuo.supabase.co
railway variables set SUPABASE_SERVICE_ROLE_KEY=<staging service role key>

# First deploy (subsequent deploys go through GitHub Actions)
railway up
```

Railway uses the Dockerfile in this directory (`railway.toml` declares
`builder = "DOCKERFILE"`). Healthcheck path is `/health`.

## Health endpoint

`GET /health` returns 200 if the WebSocket is connected and the most
recent tick is <5s old. Returns 503 otherwise.

```json
{
  "healthy": true,
  "connected": true,
  "last_tick_age_sec": 1,
  "ticks_since_start": 4327,
  "reconnect_attempts": 0,
  "last_error": null
}
```

## Reconnect strategy

Exponential backoff capped at 30s with ±500ms jitter. Resets on successful
connect. After 10 retries (max ~30s delay), keeps retrying at the cap.

## Idempotency

`speed_oracle_ticks` has `UNIQUE (asset, ts, source)`. Worker uses upsert
with `ignoreDuplicates: true`, so reconnect storms won't error on dupes.

## Cost (Railway)

This worker uses minimal CPU and memory:
- ~50 MB RAM idle
- <1% CPU at steady state (one WebSocket frame parser + two upserts/sec)
- ~5 GB egress/mo from Supabase writes (well under free tier)

Should run within Railway's $5/mo Hobby tier.
