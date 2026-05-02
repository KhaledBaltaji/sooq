-- Seed help center with FAQ content (English + Arabic)
-- Idempotent: ON CONFLICT DO NOTHING

-- ============================================================
-- ENGLISH COLLECTIONS
-- ============================================================

INSERT INTO help_collections (id, slug, title, description, icon, sort_order, is_published)
VALUES
  ('a1000000-0000-0000-0000-000000000001', 'getting-started', 'Getting Started', 'Learn the basics of Sooq and how prediction markets work.', 'rocket', 1, true),
  ('a1000000-0000-0000-0000-000000000002', 'trading', 'Trading', 'Everything about placing trades, prices, and positions.', 'trending-up', 2, true),
  ('a1000000-0000-0000-0000-000000000003', 'deposits-withdrawals', 'Deposits & Withdrawals', 'How to fund your account and withdraw your winnings.', 'wallet', 3, true),
  ('a1000000-0000-0000-0000-000000000004', 'market-resolution', 'Market Resolution', 'How markets are settled and payouts work.', 'gavel', 4, true),
  ('a1000000-0000-0000-0000-000000000005', 'fees-pricing', 'Fees & Pricing', 'Understand the costs of trading on Sooq.', 'coins', 5, true),
  ('a1000000-0000-0000-0000-000000000006', 'agent-referrals', 'Agent & Referrals', 'Earn commissions by referring friends and building your network.', 'users', 6, true),
  ('a1000000-0000-0000-0000-000000000007', 'account-security', 'Account & Security', 'Manage your account settings and stay secure.', 'lock', 7, true),
  ('a1000000-0000-0000-0000-000000000008', 'legal-compliance', 'Legal & Compliance', 'Regulations, compliance, and how Sooq operates.', 'shield', 8, true)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- ARABIC COLLECTIONS
-- ============================================================

INSERT INTO help_collections (id, slug, title, description, icon, sort_order, is_published)
VALUES
  ('a2000000-0000-0000-0000-000000000001', 'getting-started-ar', 'البداية', 'تعرّف على أساسيات سوق وكيف تعمل أسواق التوقعات.', 'rocket', 9, true),
  ('a2000000-0000-0000-0000-000000000002', 'trading-ar', 'التداول', 'كل ما تحتاج معرفته عن التداول والأسعار والمراكز.', 'trending-up', 10, true),
  ('a2000000-0000-0000-0000-000000000003', 'deposits-withdrawals-ar', 'الإيداع والسحب', 'كيف تموّل حسابك وتسحب أرباحك.', 'wallet', 11, true),
  ('a2000000-0000-0000-0000-000000000004', 'market-resolution-ar', 'تسوية الأسواق', 'كيف يتم تسوية الأسواق وصرف الأرباح.', 'gavel', 12, true),
  ('a2000000-0000-0000-0000-000000000005', 'fees-pricing-ar', 'الرسوم والتسعير', 'تعرّف على تكاليف التداول في سوق.', 'coins', 13, true),
  ('a2000000-0000-0000-0000-000000000006', 'agent-referrals-ar', 'الوكيل والإحالات', 'اكسب عمولات من خلال دعوة أصدقائك وبناء شبكتك.', 'users', 14, true),
  ('a2000000-0000-0000-0000-000000000007', 'account-security-ar', 'الحساب والأمان', 'إدارة إعدادات حسابك والحفاظ على أمانك.', 'lock', 15, true),
  ('a2000000-0000-0000-0000-000000000008', 'legal-compliance-ar', 'القانون والامتثال', 'اللوائح والامتثال وكيف تعمل سوق.', 'shield', 16, true)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- ENGLISH ARTICLES
-- ============================================================

-- ---------- Getting Started ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a1000000-0000-0000-0000-000000000001', 'what-is-sooq', 'What is Sooq?',
'Sooq is a prediction market exchange for the Middle East and North Africa (MENA) region. It lets you trade on the outcomes of real-world events — politics, economics, sports, entertainment, and more.

## How it works

You buy **shares** in outcomes you believe will happen. If you''re right, your shares pay out. If you''re wrong, they expire worthless.

Think of it like a stock market, but instead of trading company stocks, you''re trading on questions like "Will Lebanon hold elections before June 2026?" or "Will the price of gold hit $5,000?"

## Why Sooq?

- **Real-time prices** reflect what the crowd actually believes
- **Trade in and out** anytime — you''re never locked in
- **Built for MENA** — markets that matter to our region
- **Simple fintech UX** — no trading terminal complexity', 1, true),

('a1000000-0000-0000-0000-000000000001', 'how-prediction-markets-work', 'How do prediction markets work?',
'Prediction markets let crowds put money behind their beliefs. The resulting prices reveal what people actually think will happen.

## The basics

Every market asks a **yes-or-no question**, like "Will X happen by Y date?"

- **YES shares** pay $1.00 if the answer is yes
- **NO shares** pay $1.00 if the answer is no
- Shares trade between $0.01 and $0.99

## Reading the price

The price of a share reflects the market''s estimated probability:

- YES at **$0.70** = the market thinks there''s a **70% chance** it happens
- NO at **$0.30** = the market thinks there''s a **30% chance** it doesn''t happen

## Making money

1. **Buy low, sell high** — trade before the event happens
2. **Hold to resolution** — if you''re right, your shares pay $1.00 each

If you buy YES at $0.40 and the outcome is YES, you earn $0.60 per share in profit.', 2, true),

('a1000000-0000-0000-0000-000000000001', 'how-to-create-account', 'How do I create an account?',
'Creating a Sooq account takes less than a minute.

## Steps

1. Tap **Sign Up** on the home page
2. Choose your sign-up method: Google, phone number, or email
3. Verify your identity
4. You''re in — start exploring markets

## Requirements

- You must be **18 years or older**
- A valid email, phone number, or Google account
- An internet connection

## After sign-up

- Browse all active markets
- Deposit funds to start trading
- Set your preferred language (English or Arabic)', 3, true),

('a1000000-0000-0000-0000-000000000001', 'what-currencies', 'What currencies can I use?',
'Sooq operates in **US Dollars (USD)**. All balances, trades, and payouts are denominated in USD.

## Deposit methods

- **USDT / USDC** — stablecoin deposits via crypto wallet
- **Whish** — Lebanese mobile payment (coming soon)

## Why USD?

The US dollar provides a stable unit of account regardless of local currency fluctuations. This is especially important in regions with volatile exchange rates.', 4, true),

('a1000000-0000-0000-0000-000000000001', 'available-countries', 'Is Sooq available in Lebanon / my country?',
'Sooq is launching first in **Lebanon** and expanding across the MENA region.

## Currently available

- Lebanon

## Coming soon

- Jordan
- UAE
- Saudi Arabia
- Egypt
- And more MENA countries

## Access

Sooq is a web application that works on any device with a modern browser. No app download is required — just visit the site and start trading.', 5, true),

('a1000000-0000-0000-0000-000000000001', 'lebanese-lira', 'Can I use Lebanese Lira (LBP)?',
'Currently, Sooq operates exclusively in **US Dollars (USD)**. We do not accept direct LBP deposits.

## Why not LBP?

Due to exchange rate volatility and banking restrictions in Lebanon, USD provides a more stable and reliable trading experience for all users.

## How to fund your account

You can deposit using stablecoins (USDT/USDC) which are pegged 1:1 to the US dollar. Mobile payment options are coming soon.', 6, true)

ON CONFLICT (collection_id, slug) DO NOTHING;

-- ---------- Trading ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a1000000-0000-0000-0000-000000000002', 'how-to-trade', 'How do I place a trade?',
'Placing a trade on Sooq is simple.

## Steps

1. **Find a market** — browse or search for a question you have an opinion on
2. **Choose your side** — tap **YES** if you think it will happen, or **NO** if you think it won''t
3. **Set your amount** — use the quick-add buttons ($1, $5, $10, $100) or enter a custom amount
4. **Confirm** — swipe to confirm your trade

## After your trade

- Your position appears in your **Portfolio**
- You can sell at any time before the market resolves
- Watch the price move as other traders buy and sell', 1, true),

('a1000000-0000-0000-0000-000000000002', 'yes-and-no', 'What do YES and NO mean?',
'Every Sooq market asks a yes-or-no question.

## YES shares

Buying **YES** means you believe the event **will happen**. If the outcome is YES, each share pays $1.00.

## NO shares

Buying **NO** means you believe the event **will not happen**. If the outcome is NO, each share pays $1.00.

## Example

Market: "Will gold hit $5,000 by December 2026?"

- You buy **YES at $0.35** — you think there''s a better than 35% chance it happens
- If gold hits $5,000 → your shares pay $1.00 each (profit: $0.65 per share)
- If gold doesn''t hit $5,000 → your shares pay $0.00 (loss: $0.35 per share)', 2, true),

('a1000000-0000-0000-0000-000000000002', 'how-prices-work', 'How are prices determined?',
'Sooq uses an **Automated Market Maker (AMM)** to set prices.

## What is an AMM?

An AMM is a mathematical formula that automatically adjusts prices based on supply and demand. When more people buy YES, the YES price goes up. When more people buy NO, the NO price goes up.

## Key properties

- **Always available** — you can always buy or sell, 24/7
- **Fair pricing** — prices reflect the collective wisdom of all traders
- **Instant execution** — no need to wait for another trader to match your order

## Price range

Shares always trade between **$0.01** and **$0.99**. The YES price and NO price always add up to approximately $1.00.', 3, true),

('a1000000-0000-0000-0000-000000000002', 'selling-positions', 'Can I sell my position before the market resolves?',
'**Yes!** You can sell your shares at any time while the market is open.

## How to sell

1. Go to your **Portfolio**
2. Tap on the position you want to sell
3. Choose how many shares to sell
4. Swipe to confirm

## Why sell early?

- **Lock in profit** — if the price moved in your favor, sell to secure your gains
- **Cut losses** — if the price moved against you, sell to limit your loss
- **Change your mind** — new information might change your view

## Sell price

The sell price is determined by the AMM at the moment you sell. It may be higher or lower than your purchase price.', 4, true),

('a1000000-0000-0000-0000-000000000002', 'both-sides', 'What happens if I hold both YES and NO?',
'You **can** hold both YES and NO positions on the same market. There is no restriction.

## Why would someone do this?

- **Changed your mind** — you bought YES initially but now think NO is more likely
- **Trading the spread** — buying one side low and the other side low at different times

## Important notes

- Both trades generate separate trading fees
- Your final profit or loss is based on your **net position** at resolution
- The platform may flag unusually large both-side positions for review', 5, true),

('a1000000-0000-0000-0000-000000000002', 'trade-limits', 'What is the minimum/maximum trade amount?',
'## Minimum trade

The minimum trade amount is **$1.00**.

## Maximum trade

There is no fixed maximum, but very large trades will move the price significantly due to how the AMM works. The price impact depends on the market''s liquidity.

## Tips

- Start small to get familiar with how trading works
- Use the quick-add buttons for common amounts
- Watch the estimated shares and price impact before confirming', 6, true)

ON CONFLICT (collection_id, slug) DO NOTHING;

-- ---------- Deposits & Withdrawals ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a1000000-0000-0000-0000-000000000003', 'how-to-deposit', 'How do I deposit funds?',
'## Crypto deposits (USDT/USDC)

1. Go to your **Wallet** page
2. Tap **Deposit**
3. Choose USDT or USDC
4. Send funds to the provided wallet address
5. Your balance updates once the transaction is confirmed on-chain

## Mobile payments (coming soon)

We are working on integrating **Whish** and other local payment methods for easier deposits from Lebanon and the MENA region.

## Important

- Only send the correct token to the correct network
- Double-check the wallet address before sending
- Minimum deposit amount may apply', 1, true),

('a1000000-0000-0000-0000-000000000003', 'how-to-withdraw', 'How do I withdraw?',
'## Steps

1. Go to your **Wallet** page
2. Tap **Withdraw**
3. Enter the amount you want to withdraw
4. Provide your wallet address (for crypto withdrawals)
5. Confirm the withdrawal

## Requirements

- Your account must be verified
- You must have sufficient available balance (funds in open positions cannot be withdrawn)
- Any deposit bonus must meet the wagering requirement before withdrawal

## Processing time

Withdrawals are typically processed within 24 hours.', 2, true),

('a1000000-0000-0000-0000-000000000003', 'processing-times', 'How long do deposits/withdrawals take?',
'## Deposits

- **USDT/USDC**: Usually confirmed within 5-30 minutes, depending on network congestion
- **Mobile payments**: Instant once available

## Withdrawals

- **Processing**: Up to 24 hours for review
- **On-chain transfer**: 5-30 minutes after processing

## Delays

In rare cases, deposits or withdrawals may be delayed due to:
- Network congestion
- Security review for large amounts
- Missing or incorrect transaction details

If your transaction is delayed beyond 24 hours, contact support.', 3, true),

('a1000000-0000-0000-0000-000000000003', 'deposit-withdrawal-fees', 'What are the deposit/withdrawal fees?',
'## Deposits

Sooq does not charge fees on deposits. However, you may incur network fees (gas fees) when sending crypto.

## Withdrawals

A small processing fee may apply to withdrawals to cover network transaction costs. The exact fee is shown before you confirm.

## Tips

- Batch your withdrawals to minimize fees
- Check current network fees before withdrawing — they vary by time of day', 4, true),

('a1000000-0000-0000-0000-000000000003', 'deposit-bonus', 'What is the $5 deposit bonus?',
'New users who make their first deposit of **$20 or more** receive a **$5 bonus** added to their balance.

## Eligibility

- First deposit only
- Deposit must be $20 or more
- Only for **organic users** (users who signed up without a referral link)
- Referred users do **not** receive the deposit bonus

## Wagering requirement

The $5 bonus has a **2x wagering requirement**. This means you must place at least $10 in trades before the bonus funds can be withdrawn.

## Example

You deposit $25 → you get $5 bonus → your balance is $30 → you must trade at least $10 before withdrawing the bonus portion.', 5, true)

ON CONFLICT (collection_id, slug) DO NOTHING;

-- ---------- Market Resolution ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a1000000-0000-0000-0000-000000000004', 'how-markets-resolve', 'How are markets resolved?',
'Every market on Sooq has a clear **resolution source** — the authority that determines the outcome.

## Resolution process

1. The event deadline passes or the outcome becomes known
2. Sooq''s team verifies the outcome against the stated resolution source
3. The market is resolved as **YES** or **NO**
4. Winning shares are paid out automatically

## Resolution sources

Each market page lists its specific resolution source. These include:
- Official government announcements
- Major news organizations (Reuters, AP, etc.)
- Official data releases (central banks, statistics agencies)
- Verified public records', 1, true),

('a1000000-0000-0000-0000-000000000004', 'what-happens-resolution', 'What happens when a market resolves?',
'When a market resolves:

## If you hold winning shares

Your shares automatically pay out. Each winning share pays **$0.99** (after the 1% resolution fee).

## If you hold losing shares

Your shares expire worthless — they pay $0.00.

## Timeline

- Payouts happen **instantly** when the market is resolved
- Funds are added directly to your wallet balance
- No action needed from you — it''s fully automatic

## Example

You hold 100 YES shares. The market resolves YES.
- Payout: 100 × $0.99 = **$99.00**
- The $1.00 (1%) goes to the platform as a resolution fee', 2, true),

('a1000000-0000-0000-0000-000000000004', 'voided-markets', 'What if a market is voided?',
'In rare cases, a market may be **voided** instead of resolved.

## When does this happen?

- The question becomes unanswerable (e.g., an event is cancelled)
- The resolution source is unavailable or disputed
- An error was found in the market setup

## What happens to your money?

When a market is voided, **all trades are reversed**. Every trader gets back the exact amount they spent on their shares, minus any trading fees already paid.

## Frequency

Market voiding is extremely rare. We carefully review all markets before publishing to minimize this risk.', 3, true),

('a1000000-0000-0000-0000-000000000004', 'resolution-fee', 'What is the resolution fee?',
'The resolution fee is a **1% fee** deducted from winning payouts at the time of market resolution.

## How it works

- Winning shares normally pay $1.00 each
- After the 1% resolution fee, winning shares pay **$0.99** each
- Losing shares are unaffected (they pay $0.00 regardless)

## Why?

The resolution fee helps fund the platform''s operations, including market creation, outcome verification, and customer support.

## Example

You hold 50 winning shares → payout is 50 × $0.99 = $49.50 (instead of $50.00).', 4, true)

ON CONFLICT (collection_id, slug) DO NOTHING;

-- ---------- Fees & Pricing ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a1000000-0000-0000-0000-000000000005', 'fee-overview', 'What fees does Sooq charge?',
'Sooq keeps fees simple and transparent.

## Fee summary

| Fee | Rate | When |
|-----|------|------|
| Trading fee | 0.5% | On every buy and sell |
| Resolution fee | 1% | Deducted from winning payouts |
| Cash-out fee | 0.5% | When selling positions |

## No hidden charges

- No account maintenance fees
- No deposit fees (network fees may apply)
- No inactivity fees', 1, true),

('a1000000-0000-0000-0000-000000000005', 'trading-fee', 'What is the trading fee?',
'The trading fee is **0.5%** of every trade you make.

## When is it charged?

- Every time you **buy** shares
- Every time you **sell** shares

## Example

You buy $100 worth of YES shares:
- Trading fee: $100 × 0.5% = **$0.50**
- Total cost: $100.50

## Where does it go?

The trading fee is split between the platform and your referrer (if you were referred by an agent). This is how agents earn commissions.', 2, true),

('a1000000-0000-0000-0000-000000000005', 'resolution-fee-detail', 'What is the resolution fee?',
'The resolution fee is **1%** deducted from winning share payouts.

## How it works

When a market resolves and you hold winning shares:
- Each share pays **$0.99** instead of $1.00
- The $0.01 per share is the resolution fee

## Only on wins

- If you hold **losing** shares, there is no resolution fee (shares pay $0.00)
- The fee only applies at the moment of market resolution', 3, true),

('a1000000-0000-0000-0000-000000000005', 'cash-out-fee', 'What is the cash-out fee?',
'The cash-out fee is **0.5%** applied when you sell shares back to the market before resolution.

## When is it charged?

Only when you sell (cash out) a position before the market resolves. This is separate from the standard trading fee.

## Why?

The cash-out fee compensates for the liquidity the AMM provides, allowing you to exit your position at any time.', 4, true)

ON CONFLICT (collection_id, slug) DO NOTHING;

-- ---------- Agent & Referrals ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a1000000-0000-0000-0000-000000000006', 'what-is-agent', 'What is the Agent program?',
'The Agent program lets you earn money by bringing new traders to Sooq.

## How it works

1. **Share your referral link** with friends, family, or your audience
2. When they sign up and trade, **you earn a commission** on their trading fees
3. Build a network and earn from multiple levels of referrals

## Who can be an agent?

Everyone with a Sooq account is automatically an agent. Just share your unique referral link from the **Agent Corner** page.

## What can you earn?

Your commission rate depends on your agent tier, which is based on your network''s total trading volume. Higher volume = higher commissions.', 1, true),

('a1000000-0000-0000-0000-000000000006', 'how-commissions-work', 'How do commissions work?',
'You earn a percentage of the **0.5% trading fee** paid by traders in your network.

## Commission levels

Commissions are earned on up to **3 levels** of referrals:

- **Level 1 (Direct)**: People you personally referred
- **Level 2 (Indirect)**: People your referrals referred
- **Level 3 (Deep)**: One more level down

## Example

Your direct referral places a $100 trade:
- Trading fee: $0.50
- Your L1 commission (20-45%): $0.10 - $0.225

The exact percentage depends on your agent tier.', 2, true),

('a1000000-0000-0000-0000-000000000006', 'agent-tiers', 'What are agent tiers?',
'There are **4 agent tiers** based on your network''s total trading volume.

## Tier breakdown

| Tier | Volume Required | L1 Rate | L2 Rate | L3 Rate |
|------|----------------|---------|---------|---------|
| L1 | Default | 20% | 5% | 2% |
| L2 | $10,000+ | 30% | 10% | 5% |
| L3 | $50,000+ | 40% | 12% | 6% |
| L4 | $200,000+ | 45% | 15% | 7% |

## How to level up

Your tier is based on the **total volume** traded by everyone in your network (all 3 levels combined). As your network trades more, you automatically upgrade.

## Commissions are on the trading fee

These percentages apply to the **0.5% trading fee**, not the full trade amount.', 3, true),

('a1000000-0000-0000-0000-000000000006', 'activation-gate', 'What is the activation gate?',
'Before you can receive commission payouts, you need to **activate** your agent account.

## Requirement

You need **5 qualified referrals** — people who signed up using your link and placed at least one trade.

## Before activation

Commissions are still tracked and **escrowed** (held for you). Once you activate, all escrowed commissions are released to your agent wallet.

## Why?

The activation gate ensures agents are genuinely building a network, not just creating fake accounts. It keeps the system fair for everyone.', 4, true),

('a1000000-0000-0000-0000-000000000006', 'how-to-refer', 'How do I refer someone?',
'## Steps

1. Go to **Agent Corner** in the app
2. Copy your unique referral link
3. Share it with anyone — via WhatsApp, social media, email, or in person
4. When they sign up and trade, you start earning commissions

## Your referral link

Your link is unique to your account. Anyone who signs up through it is automatically connected to your network.

## Tips for growing your network

- Share on your social media accounts
- Talk about specific markets that are interesting
- Explain how prediction markets work — education drives sign-ups
- The more active traders in your network, the more you earn', 5, true)

ON CONFLICT (collection_id, slug) DO NOTHING;

-- ---------- Account & Security ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a1000000-0000-0000-0000-000000000007', 'reset-password', 'How do I reset my password?',
'## Steps

1. Go to the **Sign In** page
2. Tap **Forgot password?**
3. Enter your email address
4. Check your email for a reset link
5. Click the link and set a new password

## Tips

- Check your spam/junk folder if you don''t see the email
- The reset link expires after 1 hour
- If you signed up with Google, you don''t have a Sooq password — just use Google Sign-In', 1, true),

('a1000000-0000-0000-0000-000000000007', 'change-language', 'How do I change my language?',
'Sooq supports **English** and **Arabic**.

## How to switch

1. Go to **Settings**
2. Find the **Language** option
3. Select your preferred language
4. The app switches instantly — no restart needed

## Default language

On your first visit, Sooq detects your browser''s language setting. You can change it at any time.

## Arabic support

When you switch to Arabic, the entire interface flips to **right-to-left (RTL)** layout. Numbers remain left-to-right for readability.', 2, true),

('a1000000-0000-0000-0000-000000000007', 'is-money-safe', 'Is my money safe?',
'We take the security of your funds seriously.

## How we protect your money

- **Separate accounts** — user funds are kept separate from platform operating funds
- **Encryption** — all data is encrypted in transit and at rest
- **Secure authentication** — multi-factor authentication available
- **Audit trail** — every transaction is logged and verifiable

## Platform security

- Built on enterprise-grade infrastructure
- Regular security audits
- 24/7 system monitoring and alerting

## Important

As with any trading platform, you should only deposit funds you can afford to lose. Prediction market trading carries risk.', 3, true),

('a1000000-0000-0000-0000-000000000007', 'contact-support', 'How do I contact support?',
'## In-app support

1. Go to **Help & Support**
2. Tap **Contact Us** or start a support chat
3. Describe your issue
4. Our team will respond as soon as possible

## What to include

- Your username or email
- A clear description of the issue
- Screenshots if applicable
- Transaction IDs for payment-related issues

## Response time

We aim to respond to all support requests within **24 hours**.', 4, true)

ON CONFLICT (collection_id, slug) DO NOTHING;

-- ---------- Legal & Compliance ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a1000000-0000-0000-0000-000000000008', 'is-it-halal', 'Is prediction market trading halal?',
'This is a question we take seriously, and we encourage you to consult with your own religious advisor.

## Our perspective

Prediction markets are **information markets** — they aggregate collective knowledge about real-world events. The price reflects what people believe will happen.

## Key distinctions

- **Not gambling**: Gambling is based on pure chance (dice, slots). Prediction markets reward knowledge, research, and informed judgment.
- **Real-world events**: Markets are based on verifiable events with real outcomes, not artificial games of chance.
- **Information value**: Prediction markets serve a public good by producing accurate probability estimates.

## Scholarly views

There are differing opinions among Islamic scholars. Some view prediction markets as similar to futures contracts (permissible under certain conditions), while others view them differently.

**We recommend consulting with a qualified scholar** who can evaluate your specific situation.', 1, true),

('a1000000-0000-0000-0000-000000000008', 'is-it-gambling', 'Is this gambling?',
'**No.** Prediction markets are fundamentally different from gambling.

## Key differences

| | Gambling | Prediction Markets |
|---|---------|-------------------|
| Outcome | Random/chance | Real-world events |
| Skill | None (slots, roulette) | Research, knowledge |
| Information | No useful information produced | Produces probability estimates |
| Trading | One-time bet | Can buy and sell anytime |

## What makes Sooq different

- Markets are based on **real events** with verifiable outcomes
- Prices reflect **collective intelligence** — the wisdom of the crowd
- You can **exit anytime** — you''re never locked into a position
- Successful trading rewards **knowledge and research**

## Regulatory classification

Prediction markets are classified as **information markets** or **event contracts** in most jurisdictions, distinct from gambling.', 2, true),

('a1000000-0000-0000-0000-000000000008', 'regulations-lebanon', 'What are the regulations in Lebanon?',
'## Current regulatory landscape

Lebanon does not currently have specific regulations governing prediction markets. Sooq operates under general commercial regulations.

## Our approach

We are committed to operating transparently and responsibly:

- **Clear resolution rules** for every market
- **Public resolution sources** — no ambiguity
- **User fund protection** — funds are segregated
- **Full audit trail** — every transaction is recorded
- **KYC compliance** — we verify user identities as required

## Evolving regulations

As prediction markets grow globally, regulations are developing. We actively monitor regulatory changes and will adapt our operations to comply with any new requirements.

## Responsible trading

We encourage all users to trade responsibly and within their means. Never trade more than you can afford to lose.', 3, true)

ON CONFLICT (collection_id, slug) DO NOTHING;


-- ============================================================
-- ARABIC ARTICLES
-- ============================================================

-- ---------- البداية (Getting Started) ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a2000000-0000-0000-0000-000000000001', 'what-is-sooq', 'ما هو سوق؟',
'سوق هو منصة تداول توقعات للشرق الأوسط وشمال أفريقيا. يتيح لك التداول على نتائج أحداث حقيقية — سياسة، اقتصاد، رياضة، ترفيه، والمزيد.

## كيف يعمل

تشتري **أسهم** في النتائج التي تعتقد أنها ستحدث. إذا كنت محقاً، تحصل على أرباح. إذا كنت مخطئاً، تخسر قيمة الأسهم.

فكّر فيه كسوق أسهم، لكن بدلاً من تداول أسهم الشركات، تتداول على أسئلة مثل "هل سيعقد لبنان انتخابات قبل يونيو 2026؟" أو "هل سيصل سعر الذهب إلى 5,000 دولار؟"

## لماذا سوق؟

- **أسعار لحظية** تعكس ما يعتقده الناس فعلاً
- **تداول في أي وقت** — لست مقيداً أبداً
- **مصمم لمنطقة الشرق الأوسط** — أسواق تهم منطقتنا
- **تجربة بسيطة** — بدون تعقيدات منصات التداول', 1, true),

('a2000000-0000-0000-0000-000000000001', 'how-prediction-markets-work', 'كيف تعمل أسواق التوقعات؟',
'أسواق التوقعات تتيح للناس وضع أموالهم وراء معتقداتهم. الأسعار الناتجة تكشف ما يعتقد الناس فعلاً أنه سيحدث.

## الأساسيات

كل سوق يطرح **سؤال نعم أو لا**، مثل "هل سيحدث X بحلول تاريخ Y؟"

- أسهم **نعم** تدفع $1.00 إذا كانت الإجابة نعم
- أسهم **لا** تدفع $1.00 إذا كانت الإجابة لا
- الأسهم تتداول بين $0.01 و $0.99

## قراءة السعر

سعر السهم يعكس احتمالية السوق المقدّرة:

- نعم بسعر **$0.70** = السوق يعتقد أن هناك **احتمال 70%** أن يحدث
- لا بسعر **$0.30** = السوق يعتقد أن هناك **احتمال 30%** أن لا يحدث

## كسب المال

1. **اشترِ بسعر منخفض، بِع بسعر مرتفع** — تداول قبل حدوث الحدث
2. **احتفظ حتى التسوية** — إذا كنت محقاً، كل سهم يدفع $1.00', 2, true),

('a2000000-0000-0000-0000-000000000001', 'how-to-create-account', 'كيف أنشئ حساباً؟',
'إنشاء حساب في سوق يستغرق أقل من دقيقة.

## الخطوات

1. اضغط على **إنشاء حساب** في الصفحة الرئيسية
2. اختر طريقة التسجيل: جوجل، رقم الهاتف، أو البريد الإلكتروني
3. تحقق من هويتك
4. أنت جاهز — ابدأ باستكشاف الأسواق

## المتطلبات

- يجب أن يكون عمرك **18 سنة أو أكثر**
- بريد إلكتروني صالح، رقم هاتف، أو حساب جوجل
- اتصال بالإنترنت

## بعد التسجيل

- تصفح جميع الأسواق النشطة
- أودع أموالاً لبدء التداول
- اختر لغتك المفضلة (العربية أو الإنجليزية)', 3, true),

('a2000000-0000-0000-0000-000000000001', 'what-currencies', 'ما العملات التي يمكنني استخدامها؟',
'سوق يعمل بالـ**دولار الأمريكي (USD)**. جميع الأرصدة والتداولات والأرباح بالدولار.

## طرق الإيداع

- **USDT / USDC** — إيداع عملات مستقرة عبر محفظة كريبتو
- **Whish** — الدفع عبر الهاتف اللبناني (قريباً)

## لماذا الدولار؟

الدولار الأمريكي يوفر وحدة حساب مستقرة بغض النظر عن تقلبات العملات المحلية. هذا مهم بشكل خاص في المناطق ذات أسعار الصرف المتقلبة.', 4, true),

('a2000000-0000-0000-0000-000000000001', 'available-countries', 'هل سوق متاح في لبنان / بلدي؟',
'سوق ينطلق أولاً في **لبنان** ويتوسع في منطقة الشرق الأوسط.

## متاح حالياً

- لبنان

## قريباً

- الأردن
- الإمارات
- السعودية
- مصر
- ودول أخرى في المنطقة

## الوصول

سوق هو تطبيق ويب يعمل على أي جهاز بمتصفح حديث. لا حاجة لتنزيل تطبيق — فقط زُر الموقع وابدأ التداول.', 5, true),

('a2000000-0000-0000-0000-000000000001', 'lebanese-lira', 'هل يمكنني استخدام الليرة اللبنانية؟',
'حالياً، سوق يعمل حصرياً بالـ**دولار الأمريكي (USD)**. لا نقبل إيداعات مباشرة بالليرة اللبنانية.

## لماذا لا الليرة؟

بسبب تقلبات سعر الصرف والقيود المصرفية في لبنان، الدولار يوفر تجربة تداول أكثر استقراراً وموثوقية لجميع المستخدمين.

## كيف تموّل حسابك

يمكنك الإيداع باستخدام العملات المستقرة (USDT/USDC) المرتبطة بالدولار بنسبة 1:1. خيارات الدفع عبر الهاتف قادمة قريباً.', 6, true)

ON CONFLICT (collection_id, slug) DO NOTHING;

-- ---------- التداول (Trading) ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a2000000-0000-0000-0000-000000000002', 'how-to-trade', 'كيف أتداول؟',
'التداول على سوق بسيط.

## الخطوات

1. **ابحث عن سوق** — تصفح أو ابحث عن سؤال لديك رأي فيه
2. **اختر جانبك** — اضغط **نعم** إذا تعتقد أنه سيحدث، أو **لا** إذا تعتقد أنه لن يحدث
3. **حدد المبلغ** — استخدم الأزرار السريعة ($1، $5، $10، $100) أو أدخل مبلغاً مخصصاً
4. **أكّد** — اسحب للتأكيد

## بعد التداول

- مركزك يظهر في **محفظتك**
- يمكنك البيع في أي وقت قبل تسوية السوق
- راقب السعر وهو يتحرك مع تداول الآخرين', 1, true),

('a2000000-0000-0000-0000-000000000002', 'yes-and-no', 'ماذا يعني نعم ولا؟',
'كل سوق في سوق يطرح سؤال نعم أو لا.

## أسهم نعم

شراء **نعم** يعني أنك تعتقد أن الحدث **سيحدث**. إذا كانت النتيجة نعم، كل سهم يدفع $1.00.

## أسهم لا

شراء **لا** يعني أنك تعتقد أن الحدث **لن يحدث**. إذا كانت النتيجة لا، كل سهم يدفع $1.00.

## مثال

السوق: "هل سيصل الذهب إلى $5,000 بحلول ديسمبر 2026؟"

- تشتري **نعم بسعر $0.35** — تعتقد أن الاحتمال أعلى من 35%
- إذا وصل الذهب لـ $5,000 ← أسهمك تدفع $1.00 لكل سهم (ربح: $0.65)
- إذا لم يصل ← أسهمك تدفع $0.00 (خسارة: $0.35)', 2, true),

('a2000000-0000-0000-0000-000000000002', 'how-prices-work', 'كيف تُحدد الأسعار؟',
'سوق يستخدم **صانع سوق آلي (AMM)** لتحديد الأسعار.

## ما هو صانع السوق الآلي؟

صانع السوق الآلي هو صيغة رياضية تعدّل الأسعار تلقائياً بناءً على العرض والطلب. عندما يشتري المزيد من الناس نعم، يرتفع سعر نعم. عندما يشتري المزيد لا، يرتفع سعر لا.

## خصائص رئيسية

- **متاح دائماً** — يمكنك الشراء أو البيع على مدار الساعة
- **تسعير عادل** — الأسعار تعكس الحكمة الجماعية لجميع المتداولين
- **تنفيذ فوري** — لا حاجة لانتظار متداول آخر

## نطاق السعر

الأسهم تتداول دائماً بين **$0.01** و **$0.99**. سعر نعم وسعر لا يساويان تقريباً $1.00 معاً.', 3, true),

('a2000000-0000-0000-0000-000000000002', 'selling-positions', 'هل يمكنني بيع مركزي قبل التسوية؟',
'**نعم!** يمكنك بيع أسهمك في أي وقت أثناء فتح السوق.

## كيف تبيع

1. اذهب إلى **محفظتك**
2. اضغط على المركز الذي تريد بيعه
3. اختر عدد الأسهم للبيع
4. اسحب للتأكيد

## لماذا تبيع مبكراً؟

- **تأمين الربح** — إذا تحرك السعر لصالحك
- **تقليل الخسائر** — إذا تحرك السعر ضدك
- **تغيير رأيك** — معلومات جديدة قد تغير وجهة نظرك

## سعر البيع

سعر البيع يحدده صانع السوق الآلي لحظة البيع. قد يكون أعلى أو أقل من سعر الشراء.', 4, true),

('a2000000-0000-0000-0000-000000000002', 'both-sides', 'ماذا يحدث إذا امتلكت نعم ولا معاً؟',
'**يمكنك** امتلاك أسهم نعم ولا في نفس السوق. لا يوجد قيود.

## لماذا قد يفعل شخص ذلك؟

- **تغيير الرأي** — اشتريت نعم في البداية لكن الآن تعتقد أن لا أكثر احتمالاً
- **تداول الفارق** — شراء جانب بسعر منخفض في أوقات مختلفة

## ملاحظات مهمة

- كلا التداولين يولّدان رسوم تداول منفصلة
- ربحك أو خسارتك النهائية تعتمد على **مركزك الصافي** عند التسوية', 5, true),

('a2000000-0000-0000-0000-000000000002', 'trade-limits', 'ما هو الحد الأدنى/الأقصى للتداول؟',
'## الحد الأدنى

الحد الأدنى للتداول هو **$1.00**.

## الحد الأقصى

لا يوجد حد أقصى ثابت، لكن التداولات الكبيرة جداً ستحرك السعر بشكل ملحوظ بسبب طريقة عمل صانع السوق الآلي.

## نصائح

- ابدأ بمبالغ صغيرة للتعرف على آلية التداول
- استخدم أزرار المبالغ السريعة
- راقب الأسهم المقدّرة وتأثير السعر قبل التأكيد', 6, true)

ON CONFLICT (collection_id, slug) DO NOTHING;

-- ---------- الإيداع والسحب (Deposits & Withdrawals) ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a2000000-0000-0000-0000-000000000003', 'how-to-deposit', 'كيف أودع أموالاً؟',
'## إيداع كريبتو (USDT/USDC)

1. اذهب إلى صفحة **المحفظة**
2. اضغط **إيداع**
3. اختر USDT أو USDC
4. أرسل الأموال إلى عنوان المحفظة المقدّم
5. رصيدك يتحدث بمجرد تأكيد المعاملة

## الدفع عبر الهاتف (قريباً)

نعمل على دمج **Whish** وطرق دفع محلية أخرى.

## مهم

- أرسل فقط العملة الصحيحة إلى الشبكة الصحيحة
- تحقق من عنوان المحفظة قبل الإرسال
- قد يوجد حد أدنى للإيداع', 1, true),

('a2000000-0000-0000-0000-000000000003', 'how-to-withdraw', 'كيف أسحب أموالي؟',
'## الخطوات

1. اذهب إلى صفحة **المحفظة**
2. اضغط **سحب**
3. أدخل المبلغ المراد سحبه
4. أدخل عنوان محفظتك
5. أكّد السحب

## المتطلبات

- حسابك يجب أن يكون موثقاً
- يجب أن يكون لديك رصيد كافٍ متاح (الأموال في المراكز المفتوحة لا يمكن سحبها)
- أي مكافأة إيداع يجب أن تستوفي شرط التداول قبل السحب

## وقت المعالجة

السحوبات تُعالج عادةً خلال 24 ساعة.', 2, true),

('a2000000-0000-0000-0000-000000000003', 'processing-times', 'كم تستغرق عمليات الإيداع والسحب؟',
'## الإيداعات

- **USDT/USDC**: عادةً تتأكد خلال 5-30 دقيقة حسب ازدحام الشبكة
- **الدفع عبر الهاتف**: فوري عند توفره

## السحوبات

- **المعالجة**: حتى 24 ساعة للمراجعة
- **التحويل**: 5-30 دقيقة بعد المعالجة

## التأخيرات

في حالات نادرة، قد تتأخر العمليات بسبب:
- ازدحام الشبكة
- مراجعة أمنية للمبالغ الكبيرة
- تفاصيل معاملة مفقودة أو غير صحيحة

إذا تأخرت معاملتك أكثر من 24 ساعة، تواصل مع الدعم.', 3, true),

('a2000000-0000-0000-0000-000000000003', 'deposit-withdrawal-fees', 'ما هي رسوم الإيداع والسحب؟',
'## الإيداعات

سوق لا يفرض رسوماً على الإيداعات. لكن قد تتحمل رسوم الشبكة (Gas) عند إرسال الكريبتو.

## السحوبات

قد يُطبق رسم معالجة صغير على السحوبات لتغطية تكاليف معاملات الشبكة. الرسم الدقيق يظهر قبل التأكيد.

## نصائح

- اجمع سحوباتك لتقليل الرسوم
- تحقق من رسوم الشبكة الحالية قبل السحب', 4, true),

('a2000000-0000-0000-0000-000000000003', 'deposit-bonus', 'ما هي مكافأة الإيداع بقيمة $5؟',
'المستخدمون الجدد الذين يقومون بأول إيداع بقيمة **$20 أو أكثر** يحصلون على **مكافأة $5** تُضاف إلى رصيدهم.

## الأهلية

- الإيداع الأول فقط
- الإيداع يجب أن يكون $20 أو أكثر
- فقط للمستخدمين **العضويين** (الذين سجلوا بدون رابط إحالة)
- المستخدمون المُحالون **لا** يحصلون على المكافأة

## شرط التداول

مكافأة الـ $5 لها **شرط تداول مضاعف (2x)**. يجب أن تتداول بمبلغ $10 على الأقل قبل سحب أموال المكافأة.

## مثال

تودع $25 ← تحصل على مكافأة $5 ← رصيدك $30 ← يجب أن تتداول بـ $10 على الأقل قبل سحب جزء المكافأة.', 5, true)

ON CONFLICT (collection_id, slug) DO NOTHING;

-- ---------- تسوية الأسواق (Market Resolution) ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a2000000-0000-0000-0000-000000000004', 'how-markets-resolve', 'كيف يتم تسوية الأسواق؟',
'كل سوق في سوق له **مصدر تسوية** واضح — الجهة التي تحدد النتيجة.

## عملية التسوية

1. يمر الموعد النهائي أو تُعرف النتيجة
2. فريق سوق يتحقق من النتيجة مقابل مصدر التسوية المحدد
3. يتم تسوية السوق كـ **نعم** أو **لا**
4. أسهم الفائزين تُدفع تلقائياً

## مصادر التسوية

كل صفحة سوق تذكر مصدر التسوية الخاص بها، بما في ذلك:
- إعلانات حكومية رسمية
- منظمات إخبارية كبرى (رويترز، AP، إلخ)
- بيانات رسمية (البنوك المركزية، هيئات الإحصاء)
- سجلات عامة موثقة', 1, true),

('a2000000-0000-0000-0000-000000000004', 'what-happens-resolution', 'ماذا يحدث عند تسوية السوق؟',
'عند تسوية السوق:

## إذا كنت تملك أسهماً رابحة

أسهمك تُدفع تلقائياً. كل سهم رابح يدفع **$0.99** (بعد رسم التسوية 1%).

## إذا كنت تملك أسهماً خاسرة

أسهمك تنتهي بلا قيمة — تدفع $0.00.

## الجدول الزمني

- الدفعات تحدث **فوراً** عند تسوية السوق
- الأموال تُضاف مباشرة إلى رصيد محفظتك
- لا حاجة لأي إجراء منك — كل شيء تلقائي

## مثال

تملك 100 سهم نعم. السوق يُسوّى نعم.
- الدفع: 100 × $0.99 = **$99.00**
- الـ $1.00 (1%) تذهب للمنصة كرسم تسوية', 2, true),

('a2000000-0000-0000-0000-000000000004', 'voided-markets', 'ماذا لو أُلغي السوق؟',
'في حالات نادرة، قد يتم **إلغاء** السوق بدلاً من تسويته.

## متى يحدث هذا؟

- السؤال أصبح غير قابل للإجابة (مثلاً، تم إلغاء الحدث)
- مصدر التسوية غير متاح أو متنازع عليه
- تم اكتشاف خطأ في إعداد السوق

## ماذا يحدث لأموالك؟

عند إلغاء السوق، **جميع التداولات تُعكس**. كل متداول يسترد المبلغ الذي أنفقه على أسهمه، ناقص أي رسوم تداول مدفوعة مسبقاً.

## التكرار

إلغاء الأسواق نادر جداً. نراجع جميع الأسواق بعناية قبل النشر لتقليل هذا الاحتمال.', 3, true),

('a2000000-0000-0000-0000-000000000004', 'resolution-fee', 'ما هو رسم التسوية؟',
'رسم التسوية هو **1%** يُخصم من أرباح الأسهم الرابحة عند تسوية السوق.

## كيف يعمل

- الأسهم الرابحة عادةً تدفع $1.00 لكل سهم
- بعد رسم التسوية 1%، تدفع **$0.99** لكل سهم
- الأسهم الخاسرة لا تتأثر (تدفع $0.00 في كل الأحوال)

## لماذا؟

رسم التسوية يساعد في تمويل عمليات المنصة، بما في ذلك إنشاء الأسواق والتحقق من النتائج ودعم العملاء.

## مثال

تملك 50 سهماً رابحاً ← الدفع هو 50 × $0.99 = $49.50 (بدلاً من $50.00).', 4, true)

ON CONFLICT (collection_id, slug) DO NOTHING;

-- ---------- الرسوم والتسعير (Fees & Pricing) ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a2000000-0000-0000-0000-000000000005', 'fee-overview', 'ما هي الرسوم التي يفرضها سوق؟',
'سوق يحافظ على رسوم بسيطة وشفافة.

## ملخص الرسوم

| الرسم | النسبة | متى |
|-------|--------|-----|
| رسم التداول | 0.5% | على كل عملية شراء وبيع |
| رسم التسوية | 1% | يُخصم من أرباح الأسهم الرابحة |
| رسم الصرف | 0.5% | عند بيع المراكز |

## بدون رسوم مخفية

- لا رسوم صيانة حساب
- لا رسوم إيداع (قد تُطبق رسوم الشبكة)
- لا رسوم عدم نشاط', 1, true),

('a2000000-0000-0000-0000-000000000005', 'trading-fee', 'ما هو رسم التداول؟',
'رسم التداول هو **0.5%** من كل تداول تقوم به.

## متى يُفرض؟

- كل مرة **تشتري** أسهماً
- كل مرة **تبيع** أسهماً

## مثال

تشتري أسهم نعم بقيمة $100:
- رسم التداول: $100 × 0.5% = **$0.50**
- التكلفة الإجمالية: $100.50

## أين يذهب؟

رسم التداول يُقسم بين المنصة والوكيل الذي أحالك (إن وُجد). هكذا يكسب الوكلاء عمولاتهم.', 2, true),

('a2000000-0000-0000-0000-000000000005', 'resolution-fee-detail', 'ما هو رسم التسوية؟',
'رسم التسوية هو **1%** يُخصم من دفعات الأسهم الرابحة.

## كيف يعمل

عندما يُسوّى السوق وتملك أسهماً رابحة:
- كل سهم يدفع **$0.99** بدلاً من $1.00
- الـ $0.01 لكل سهم هو رسم التسوية

## فقط على الأرباح

- إذا كنت تملك أسهماً **خاسرة**، لا يوجد رسم تسوية
- الرسم يُطبق فقط عند لحظة تسوية السوق', 3, true),

('a2000000-0000-0000-0000-000000000005', 'cash-out-fee', 'ما هو رسم الصرف؟',
'رسم الصرف هو **0.5%** يُطبق عند بيع الأسهم قبل التسوية.

## متى يُفرض؟

فقط عند بيع (صرف) مركز قبل تسوية السوق. هذا منفصل عن رسم التداول العادي.

## لماذا؟

رسم الصرف يعوّض السيولة التي يوفرها صانع السوق الآلي، مما يتيح لك الخروج من مركزك في أي وقت.', 4, true)

ON CONFLICT (collection_id, slug) DO NOTHING;

-- ---------- الوكيل والإحالات (Agent & Referrals) ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a2000000-0000-0000-0000-000000000006', 'what-is-agent', 'ما هو برنامج الوكيل؟',
'برنامج الوكيل يتيح لك كسب المال من خلال جلب متداولين جدد إلى سوق.

## كيف يعمل

1. **شارك رابط الإحالة** مع الأصدقاء والعائلة أو جمهورك
2. عندما يسجلون ويتداولون، **تكسب عمولة** على رسوم تداولهم
3. ابنِ شبكة واكسب من مستويات متعددة

## من يمكنه أن يكون وكيلاً؟

كل من لديه حساب في سوق هو وكيل تلقائياً. فقط شارك رابط الإحالة الخاص بك من صفحة **ركن الوكيل**.

## كم يمكنك أن تكسب؟

نسبة عمولتك تعتمد على مستوى وكالتك، المبني على حجم تداول شبكتك الإجمالي.', 1, true),

('a2000000-0000-0000-0000-000000000006', 'how-commissions-work', 'كيف تعمل العمولات؟',
'تكسب نسبة من **رسم التداول 0.5%** الذي يدفعه المتداولون في شبكتك.

## مستويات العمولة

تُكسب العمولات على حتى **3 مستويات** من الإحالات:

- **المستوى 1 (مباشر)**: الأشخاص الذين أحلتهم شخصياً
- **المستوى 2 (غير مباشر)**: الأشخاص الذين أحالهم من أحلتهم
- **المستوى 3 (عميق)**: مستوى إضافي واحد

## مثال

إحالتك المباشرة تتداول بـ $100:
- رسم التداول: $0.50
- عمولتك L1 (20-45%): $0.10 - $0.225

النسبة الدقيقة تعتمد على مستوى وكالتك.', 2, true),

('a2000000-0000-0000-0000-000000000006', 'agent-tiers', 'ما هي مستويات الوكيل؟',
'هناك **4 مستويات للوكيل** بناءً على حجم تداول شبكتك الإجمالي.

## تفاصيل المستويات

| المستوى | الحجم المطلوب | L1 | L2 | L3 |
|---------|--------------|-----|-----|-----|
| L1 | افتراضي | 20% | 5% | 2% |
| L2 | $10,000+ | 30% | 10% | 5% |
| L3 | $50,000+ | 40% | 12% | 6% |
| L4 | $200,000+ | 45% | 15% | 7% |

## كيف تترقى

مستواك يعتمد على **الحجم الإجمالي** للتداول من كل شبكتك (المستويات الثلاثة). كلما تداولت شبكتك أكثر، تترقى تلقائياً.

## العمولات على رسم التداول

هذه النسب تُطبق على **رسم التداول 0.5%**، وليس على مبلغ التداول الكامل.', 3, true),

('a2000000-0000-0000-0000-000000000006', 'activation-gate', 'ما هو شرط التفعيل؟',
'قبل أن تستلم دفعات العمولات، تحتاج لـ**تفعيل** حساب وكالتك.

## المتطلب

تحتاج **5 إحالات مؤهلة** — أشخاص سجلوا برابطك وأجروا تداولاً واحداً على الأقل.

## قبل التفعيل

العمولات لا تزال تُتبع وتُحفظ **في الضمان** (محجوزة لك). بمجرد التفعيل، جميع العمولات المحجوزة تُصرف إلى محفظة وكالتك.

## لماذا؟

شرط التفعيل يضمن أن الوكلاء يبنون شبكة حقيقية، وليس مجرد إنشاء حسابات وهمية.', 4, true),

('a2000000-0000-0000-0000-000000000006', 'how-to-refer', 'كيف أحيل شخصاً؟',
'## الخطوات

1. اذهب إلى **ركن الوكيل** في التطبيق
2. انسخ رابط الإحالة الخاص بك
3. شاركه مع أي شخص — عبر واتساب أو وسائل التواصل أو البريد الإلكتروني أو شخصياً
4. عندما يسجلون ويتداولون، تبدأ بكسب العمولات

## رابط الإحالة

رابطك فريد لحسابك. أي شخص يسجل من خلاله يرتبط تلقائياً بشبكتك.

## نصائح لتنمية شبكتك

- شارك على حساباتك في وسائل التواصل الاجتماعي
- تحدث عن أسواق محددة مثيرة للاهتمام
- اشرح كيف تعمل أسواق التوقعات — التثقيف يدفع التسجيل
- كلما زاد عدد المتداولين النشطين في شبكتك، كلما كسبت أكثر', 5, true)

ON CONFLICT (collection_id, slug) DO NOTHING;

-- ---------- الحساب والأمان (Account & Security) ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a2000000-0000-0000-0000-000000000007', 'reset-password', 'كيف أعيد تعيين كلمة المرور؟',
'## الخطوات

1. اذهب إلى صفحة **تسجيل الدخول**
2. اضغط **نسيت كلمة المرور؟**
3. أدخل بريدك الإلكتروني
4. تحقق من بريدك لرابط إعادة التعيين
5. اضغط الرابط وعيّن كلمة مرور جديدة

## نصائح

- تحقق من مجلد الرسائل غير المرغوب فيها
- رابط إعادة التعيين ينتهي بعد ساعة واحدة
- إذا سجلت بجوجل، لا تملك كلمة مرور في سوق — فقط استخدم تسجيل الدخول بجوجل', 1, true),

('a2000000-0000-0000-0000-000000000007', 'change-language', 'كيف أغيّر اللغة؟',
'سوق يدعم **العربية** و**الإنجليزية**.

## كيفية التبديل

1. اذهب إلى **الإعدادات**
2. ابحث عن خيار **اللغة**
3. اختر لغتك المفضلة
4. التطبيق يتبدل فوراً — لا حاجة لإعادة التشغيل

## اللغة الافتراضية

عند زيارتك الأولى، سوق يكتشف لغة متصفحك. يمكنك تغييرها في أي وقت.

## دعم العربية

عند التبديل للعربية، الواجهة بالكامل تنقلب إلى تخطيط **من اليمين إلى اليسار (RTL)**. الأرقام تبقى من اليسار إلى اليمين للقراءة.', 2, true),

('a2000000-0000-0000-0000-000000000007', 'is-money-safe', 'هل أموالي آمنة؟',
'نأخذ أمان أموالك بجدية.

## كيف نحمي أموالك

- **حسابات منفصلة** — أموال المستخدمين منفصلة عن أموال تشغيل المنصة
- **تشفير** — جميع البيانات مشفرة أثناء النقل والتخزين
- **مصادقة آمنة** — المصادقة متعددة العوامل متاحة
- **سجل تدقيق** — كل معاملة مسجلة وقابلة للتحقق

## أمان المنصة

- مبنية على بنية تحتية من مستوى المؤسسات
- تدقيقات أمنية منتظمة
- مراقبة وتنبيهات على مدار الساعة

## مهم

كما هو الحال مع أي منصة تداول، يجب أن تودع فقط أموالاً يمكنك تحمل خسارتها.', 3, true),

('a2000000-0000-0000-0000-000000000007', 'contact-support', 'كيف أتواصل مع الدعم؟',
'## الدعم داخل التطبيق

1. اذهب إلى **المساعدة والدعم**
2. اضغط **تواصل معنا** أو ابدأ محادثة دعم
3. اوصف مشكلتك
4. فريقنا سيرد في أقرب وقت ممكن

## ما يجب تضمينه

- اسم المستخدم أو البريد الإلكتروني
- وصف واضح للمشكلة
- لقطات شاشة إن أمكن
- أرقام المعاملات للمشاكل المتعلقة بالدفع

## وقت الاستجابة

نهدف للرد على جميع طلبات الدعم خلال **24 ساعة**.', 4, true)

ON CONFLICT (collection_id, slug) DO NOTHING;

-- ---------- القانون والامتثال (Legal & Compliance) ----------

INSERT INTO help_articles (collection_id, slug, title, content, sort_order, is_published)
VALUES
('a2000000-0000-0000-0000-000000000008', 'is-it-halal', 'هل التداول في أسواق التوقعات حلال؟',
'هذا سؤال نأخذه بجدية، ونشجعك على استشارة مستشارك الديني.

## وجهة نظرنا

أسواق التوقعات هي **أسواق معلومات** — تجمع المعرفة الجماعية حول أحداث حقيقية. السعر يعكس ما يعتقد الناس أنه سيحدث.

## فروقات رئيسية

- **ليست قماراً**: القمار مبني على الحظ المحض (نرد، سلوتس). أسواق التوقعات تكافئ المعرفة والبحث والحكم المستنير.
- **أحداث حقيقية**: الأسواق مبنية على أحداث قابلة للتحقق بنتائج حقيقية، وليست ألعاب حظ مصطنعة.
- **قيمة معلوماتية**: أسواق التوقعات تخدم المصلحة العامة بإنتاج تقديرات احتمالية دقيقة.

## آراء العلماء

هناك آراء مختلفة بين العلماء المسلمين. البعض يرى أسواق التوقعات مشابهة للعقود الآجلة (مباحة بشروط معينة)، بينما يراها آخرون بشكل مختلف.

**ننصح باستشارة عالم مؤهل** يمكنه تقييم وضعك الخاص.', 1, true),

('a2000000-0000-0000-0000-000000000008', 'is-it-gambling', 'هل هذا قمار؟',
'**لا.** أسواق التوقعات مختلفة جوهرياً عن القمار.

## الفروقات الرئيسية

| | القمار | أسواق التوقعات |
|---|--------|---------------|
| النتيجة | عشوائية/حظ | أحداث حقيقية |
| المهارة | لا شيء (سلوتس، روليت) | بحث، معرفة |
| المعلومات | لا تنتج معلومات مفيدة | تنتج تقديرات احتمالية |
| التداول | رهان لمرة واحدة | شراء وبيع في أي وقت |

## ما يميز سوق

- الأسواق مبنية على **أحداث حقيقية** بنتائج قابلة للتحقق
- الأسعار تعكس **الذكاء الجماعي** — حكمة الجمهور
- يمكنك **الخروج في أي وقت** — لست مقيداً أبداً
- التداول الناجح يكافئ **المعرفة والبحث**

## التصنيف التنظيمي

أسواق التوقعات تُصنف كـ **أسواق معلومات** أو **عقود أحداث** في معظم الولايات القضائية، وهي مختلفة عن القمار.', 2, true),

('a2000000-0000-0000-0000-000000000008', 'regulations-lebanon', 'ما هي اللوائح في لبنان؟',
'## المشهد التنظيمي الحالي

لبنان لا يملك حالياً لوائح محددة تحكم أسواق التوقعات. سوق يعمل تحت اللوائح التجارية العامة.

## نهجنا

نحن ملتزمون بالعمل بشفافية ومسؤولية:

- **قواعد تسوية واضحة** لكل سوق
- **مصادر تسوية عامة** — بدون غموض
- **حماية أموال المستخدمين** — الأموال منفصلة
- **سجل تدقيق كامل** — كل معاملة مسجلة
- **الامتثال لـ KYC** — نتحقق من هويات المستخدمين حسب المطلوب

## لوائح متطورة

مع نمو أسواق التوقعات عالمياً، اللوائح تتطور. نراقب التغييرات التنظيمية بنشاط وسنكيّف عملياتنا للامتثال لأي متطلبات جديدة.

## التداول المسؤول

نشجع جميع المستخدمين على التداول بمسؤولية وضمن إمكانياتهم. لا تتداول أبداً بأكثر مما يمكنك تحمل خسارته.', 3, true)

ON CONFLICT (collection_id, slug) DO NOTHING;
