// Demo market detail page re-exports the live market detail page. Every hook
// it uses (useMarket, useExecuteTrade, usePosition, usePriceHistory,
// useClosePosition) is demo-aware via useDemoMode — they read demo_* tables
// and route trades to demo_execute_trade automatically when pathname starts
// with /demo/. Keeping the UI in one place prevents drift between live and demo.
export { default } from "@/app/(app)/market/[id]/page";
