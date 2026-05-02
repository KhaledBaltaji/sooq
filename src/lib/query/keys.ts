/**
 * Centralized query key factory for React Query.
 *
 * Why every key carries `isDemo`:
 * Demo mode uses entirely separate tables (`demo_markets`, `demo_amm_state`,
 * etc.). A live-mode cache entry must never be reused when the user enters
 * `/demo/*`, and vice versa. Keying on `isDemo` guarantees full cache isolation
 * without special-case flushing.
 *
 * Usage:
 *   queryKey: queryKeys.markets.all(isDemo)
 *   queryKey: queryKeys.markets.detail(marketId, isDemo)
 *
 * Adding a new domain? Follow the same shape: `[domain, ...args, { isDemo }]`.
 */
export const queryKeys = {
  markets: {
    all: (isDemo: boolean) => ["markets", { isDemo }] as const,
    detail: (marketId: string, isDemo: boolean) =>
      ["markets", marketId, { isDemo }] as const,
  },
  positions: {
    byUser: (userId: string, isDemo: boolean) =>
      ["positions", userId, { isDemo }] as const,
  },
  trades: {
    byMarket: (marketId: string, isDemo: boolean) =>
      ["trades", marketId, { isDemo }] as const,
  },
  priceHistory: {
    byMarket: (marketId: string, isDemo: boolean) =>
      ["price-history", marketId, { isDemo }] as const,
  },
  fees: {
    rates: () => ["fee-rates"] as const,
  },
  speedFees: {
    config: () => ["speed-fee-config"] as const,
  },
  speedSparkline: {
    by24h: (asset: string) => ["speed-sparkline-24h", asset] as const,
  },
} as const;
