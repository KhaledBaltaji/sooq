# Speed Oracle Worker

Streams Binance BTC/USDT 1-second klines via WebSocket and writes ticks
to Sooq's RDS Postgres: `speed_oracle_ticks` (rolling history, used by
chart RPCs) + `speed_oracle_latest` (single-row cache read by
`speed_execute_trade` / `speed_execute_cashout` / `speed_resolve_market`).

**Single persistent process.** Running >1 replica races the
`speed_oracle_latest` upsert and produces duplicate ticks. Always 1
instance.

## Stack

- Node 20 + TypeScript
- `ws` for WebSocket client
- `pg` for direct DB writes (no ORM — it's two upserts per second)
- Built-in `http` for `/health`

## Env vars

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Full Postgres connection string. Pull RDS master password from AWS Secrets Manager (`rds!db-fc910551-...`) and substitute. The worker strips `?sslmode=require` client-side and re-enables SSL with `rejectUnauthorized:false`, matching the Next app's pg pool. |
| `PORT` | no | Health endpoint port (default 3000) |
| `SENTRY_DSN` | no | If set, sustained write failures + watchdog trips alert here |

## Local dev

```bash
cp .env.example .env   # fill in DATABASE_URL
npm install
npm run dev            # runs via tsx, no build step
```

Health: `curl localhost:3000/health`

## Deploy

Sooq v1 runs the worker as a single-instance EC2 service in the same
VPC as RDS (eu-central-1). See `docs/AWS_RESOURCES.md` for the instance
ID + SSH user.

Update flow:
```bash
# from your dev machine
ssh ec2-user@<oracle-ec2-host>
cd /opt/speed-oracle
git pull
npm ci
npm run build
sudo systemctl restart speed-oracle
sudo journalctl -u speed-oracle -f --since "1 min ago"
```

Health: `curl http://<oracle-ec2-host>:3000/health` (only reachable
from inside the VPC; the systemd service binds 0.0.0.0:3000 but the
EC2 security group restricts inbound).

## Idempotency

`speed_oracle_ticks` has a unique index on `(asset, ts, source)` (mig
0008). The worker writes via `INSERT ... ON CONFLICT DO NOTHING`, so
WebSocket reconnect storms can't double-insert.

`speed_oracle_latest` has the asset as primary key — upsert via
`ON CONFLICT (asset) DO UPDATE`.

Both writes happen inside a single transaction so a partial fail rolls
back cleanly.

## Reconnect strategy

Exponential backoff capped at 30s with ±500ms jitter. Resets on
successful connect.

## Watchdog

Two timeout layers (caught a real 16-minute zombie-socket outage on
prediction-market):

- **Boot grace 30s**: if WS opens but no tick in 30s, force-reconnect.
- **Steady-state 10s**: if WS reports OPEN but no tick in 10s, force-
  reconnect (zombie sockets where TCP died silently without
  triggering close/error).

## Cost

`t4g.nano` 24/7 ≈ $3/mo (or free tier eligible).
- ~50 MB RAM idle
- <1% CPU at steady state (one WS frame parser + two upserts/sec)
- Same-VPC writes to RDS = zero egress cost
