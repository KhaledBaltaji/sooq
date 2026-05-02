# Opening Price Feature — Market Creation

## Context

Today, every market starts at 50/50. That's wrong when consensus clearly favors one side — it overpays correct bettors and maxes operator exposure at `b × ln(2) ≈ 0.693b`. Letting admins set an opening price lets the market start at an honest probability and bounds operator loss at `b × |ln(p)|` when consensus wins.

At p=0.70, worst-case loss if consensus wins drops ~50% (0.693b → 0.357b). Trade-off: if consensus is WRONG, loss grows (0.693b → 1.204b at p=0.7). So this only pays off when the admin's prior is informed.

## Scope

**In:**
- New column `markets.opening_price DECIMAL(5,4) DEFAULT 0.5000 NOT NULL` with `CHECK (opening_price BETWEEN 0.05 AND 0.95)`.
- `admin_create_market` accepts `p_opening_price DECIMAL DEFAULT 0.5`. Seeds `amm_state.q_yes` or `q_no` accordingly. Pre-minted shares are operator inventory, not retail.
- Admin create-market form gets a number input + a one-line preview of the math (`"Pre-mint ~847 YES shares at b=1000"`).
- Tests: price-math correctness, boundary validation, integration via the existing test market factory.

**Out (explicit non-goals):**
- Editing opening price after creation (markets are `status='open'` at creation — no draft window today).
- Demo markets. Keep demo RPC untouched; demo always starts 50/50 for simplicity.
- Automated consensus/news-driven pricing. Admin types the number.
- Changes to `get_amm_risk_snapshot` (retail-only, unaffected).
- Changes to `seed_pnl` accounting. Current formula is cash-collected minus payout-owed; pre-minted shares flow through naturally. Flagged as a follow-up if numbers look off.

## Formulas

Let `p = opening_price`, `b = liquidity_param`. Seed exactly one side:

```
if p >= 0.5:
  q_yes = b × ln(p / (1 - p))
  q_no  = 0
else:
  q_yes = 0
  q_no  = b × ln((1 - p) / p)
```

Verification: `lmsr_price(b, q_yes, q_no, 'yes') = p` exactly.

At p=0.5 both sides seed 0 — identical to current behavior. Safe default.

## Migration 279 — SQL skeleton

```sql
-- 279_market_opening_price.sql

BEGIN;

-- 1. Add column with safe default (existing markets get 0.5 = current behavior)
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS opening_price DECIMAL(5,4) NOT NULL DEFAULT 0.5000
    CHECK (opening_price BETWEEN 0.05 AND 0.95);

COMMENT ON COLUMN markets.opening_price IS
  'Initial market price set at creation. AMM pre-mints shares to this price. Range 0.05-0.95 to prevent certainty markets.';

-- 2. admin_create_market — new p_opening_price param
CREATE OR REPLACE FUNCTION admin_create_market(
  p_question_en TEXT,
  p_question_ar TEXT,
  p_description_en TEXT DEFAULT NULL,
  p_description_ar TEXT DEFAULT NULL,
  p_category TEXT DEFAULT 'politics',
  p_keywords TEXT[] DEFAULT '{}',
  p_liquidity_param DECIMAL DEFAULT NULL,
  p_opens_at TIMESTAMPTZ DEFAULT now(),
  p_closes_at TIMESTAMPTZ DEFAULT now() + interval '7 days',
  p_image_url TEXT DEFAULT NULL,
  p_opening_price DECIMAL DEFAULT 0.5
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID;
  v_market_id UUID;
  v_b DECIMAL;
  v_q_yes DECIMAL;
  v_q_no DECIMAL;
  v_yes_price DECIMAL;
  v_no_price DECIMAL;
  v_resolution_fee_rate DECIMAL;
BEGIN
  -- (all existing validation — admin check, question validation, etc.)

  -- Validate opening_price in allowed range
  IF p_opening_price < 0.05 OR p_opening_price > 0.95 THEN
    RAISE EXCEPTION 'opening_price must be between 0.05 and 0.95 (got %)', p_opening_price;
  END IF;

  -- Compute liquidity_param (existing logic unchanged)
  -- Compute resolution_fee_rate snapshot (existing logic unchanged)

  -- Pre-mint shares to reach the opening price
  IF p_opening_price >= 0.5 THEN
    v_q_yes := v_b * ln(p_opening_price / (1 - p_opening_price));
    v_q_no  := 0;
  ELSE
    v_q_yes := 0;
    v_q_no  := v_b * ln((1 - p_opening_price) / p_opening_price);
  END IF;

  -- Insert market with opening_price + snapshot
  INSERT INTO markets (
    question_en, question_ar, description_en, description_ar,
    category, keywords, amm_liquidity_param, opens_at, closes_at,
    created_by, status, image_url, resolution_fee_rate_snapshot, opening_price
  ) VALUES (
    p_question_en, p_question_ar, p_description_en, p_description_ar,
    p_category, p_keywords, v_b, p_opens_at, p_closes_at,
    v_admin_id, 'open', p_image_url, v_resolution_fee_rate, p_opening_price
  )
  RETURNING id INTO v_market_id;

  -- Initialize AMM with pre-minted state
  v_yes_price := lmsr_price(v_b, v_q_yes, v_q_no, 'yes');
  v_no_price  := lmsr_price(v_b, v_q_yes, v_q_no, 'no');

  INSERT INTO amm_state (
    market_id, liquidity_param, q_yes, q_no,
    current_yes_price, current_no_price,
    retail_shares_yes, retail_shares_no, retail_net_cash
  ) VALUES (
    v_market_id, v_b, v_q_yes, v_q_no,
    v_yes_price, v_no_price,
    0, 0, 0  -- retail columns stay 0 — pre-mint is operator inventory
  );

  RETURN jsonb_build_object('market_id', v_market_id, 'opening_price', p_opening_price);
END;
$$;

COMMIT;
```

Existing markets: migration leaves their `opening_price = 0.5` (the default). No backfill of `amm_state` needed — they already have `q_yes = q_no = 0` which is consistent with `opening_price = 0.5`.

## Admin UI

`src/app/admin/markets/create/page.tsx`:

- Add `opening_price: "0.50"` to the form state.
- New input row between "Liquidity Parameter" and "Open Date":
  - Number input, step=0.01, min=0.05, max=0.95, default 0.50
  - Label: "Opening Price (YES)"
  - Helper text: e.g., "0.50 = fair coin · 0.70 = 2:1 YES favored · 0.30 = 2:1 NO favored"
  - Small inline preview: "Pre-mints ~847 YES shares at b=1000" (computed client-side)
- Pass `p_opening_price: parseFloat(form.opening_price)` to `admin_create_market` RPC.
- Demo branch (`is_demo=true`) unchanged.

## Tests

New file `src/tests/db/opening-price.test.ts`:

1. `opening_price = 0.5` → `q_yes = 0, q_no = 0`, prices both 0.50 (current behavior preserved)
2. `opening_price = 0.70` → `q_yes ≈ 0.847 × b`, `q_no = 0`, initial YES price = 0.70 (±0.001)
3. `opening_price = 0.30` → `q_yes = 0`, `q_no ≈ 0.847 × b`, initial YES price = 0.30
4. `opening_price = 0.05` → edge, still creates valid market with extreme seed
5. `opening_price = 0.95` → symmetric edge
6. `opening_price = 0.04` rejected by CHECK constraint
7. `opening_price = 0.96` rejected by CHECK constraint
8. After creation: admin can execute_trade on the market (trading still works post-seed)
9. Retail columns stay at 0 after creation (`retail_shares_yes = retail_shares_no = retail_net_cash = 0`)

Integration: update `createTestMarket` helper to accept optional `opening_price` (default 0.5 so existing tests don't change).

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `seed_pnl` on `/admin/accounting` shows weird numbers for seeded markets | Medium | Low-moderate — cosmetic confusion, not money loss | Test with an actual seeded-and-resolved market on staging before declaring done. If numbers are off, follow-up migration to adjust `get_accounting_amm`. |
| Admin types 0.99 thinking "certain" → CHECK rejects with cryptic error | High | Low | Validate in the form before submit; clear error message |
| Pre-minted shares confuse `lmsr_shares_for_cost` when retail buys | Low | Moderate | `execute_trade` math is state-agnostic — reads current `q_yes/q_no`, computes delta. Pre-minted state is just the starting point. Tests cover this. |
| Admin creates market at 0.70 but consensus is actually 0.30 → operator loses more | Certain | Depends on admin judgment | Feature design — admin bears responsibility. Warning copy in the form: "opening price should reflect your honest estimate, not a target" |

## Rollback

- Revert migration 279 on prod with `DROP COLUMN opening_price` + restore previous `admin_create_market` body.
- `amm_state` for any already-seeded markets stays as-is (shares don't disappear).
- UI rollback: revert the form change; old admins just see default 0.5 behavior.

## Critical files

| Path | Change |
|---|---|
| `supabase/migrations/279_market_opening_price.sql` | NEW — ALTER TABLE + re-define admin_create_market |
| `src/app/admin/markets/create/page.tsx` | Add form field + RPC param |
| `src/tests/db/opening-price.test.ts` | NEW — 9 tests |
| `src/tests/db/helpers.ts` | Update `createTestMarket` to accept `opening_price` |
| `supabase/schema.sql` | Regen after migration |

Out-of-scope follow-ups (not in this PR):
- `get_accounting_amm` / `seed_pnl` adjustment for non-0.5 starts (verify after first seeded resolution).
- Demo markets opening-price support.
- Market-edit UI for changing price post-creation (needs draft status or reverse-accounting).
