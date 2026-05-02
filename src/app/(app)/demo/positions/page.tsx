// Demo positions page re-exports the live /trade page. Every hook it uses
// (usePositions, useExecuteTrade, useUser) is demo-aware via useDemoMode —
// they read demo_* tables and route trades to demo_execute_trade when the
// pathname starts with /demo/. The live page also routes its market links
// to /demo/market/[id] when in demo. One UI surface, no drift.
export { default } from "@/app/(app)/trade/page";
