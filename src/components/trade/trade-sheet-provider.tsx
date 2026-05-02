"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useUser } from "@/lib/auth/hooks";
import { useAuthModal } from "@/components/auth/auth-modal-provider";
import { useDepositModal } from "@/components/wallet/deposit-modal-provider";
import { useExecuteTrade } from "@/hooks/use-execute-trade";
import { useDemoMode } from "@/hooks/use-demo-mode";
import { mapTradeError } from "@/lib/trade-utils";
import { sharesToLots, getMarketTimeState, getMaxTradeUsd } from "@/lib/market-utils";
import { MobileTradeSheet } from "@/components/market/mobile-trade-sheet";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Confetti } from "@/components/ui/confetti";
import { Loader2 } from "lucide-react";
import type { MarketWithAmm, Position, AmmState } from "@/types/market";
import type { Side } from "@/types/database";

interface TradeSheetContextValue {
  openTrade: (market: MarketWithAmm, side: Side) => void;
}

const TradeSheetContext = createContext<TradeSheetContextValue | null>(null);

export function useTradeSheet() {
  const ctx = useContext(TradeSheetContext);
  if (!ctx) throw new Error("useTradeSheet must be used within TradeSheetProvider");
  return ctx;
}

interface TradeSheetProviderProps {
  children: ReactNode;
  refetchMarkets?: () => Promise<void>;
}

const noopRefetch = async () => {};

export function TradeSheetProvider({ children, refetchMarkets = noopRefetch }: TradeSheetProviderProps) {
  const supabase = useSupabase();
  const tTrade = useTranslations("trade");
  const tToast = useTranslations("toast");
  const tMarket = useTranslations("market");
  const { user, refetch: refetchUser, adjustBalance } = useUser();
  const isDemo = useDemoMode();
  const { openLoginModal } = useAuthModal();
  const { openDepositModal } = useDepositModal();
  const { executeTrade, loading: execLoading } = useExecuteTrade();

  const [activeMarket, setActiveMarket] = useState<MarketWithAmm | null>(null);
  const [activeSide, setActiveSide] = useState<Side>("yes");
  const [position, setPosition] = useState<{ yes: Position | null; no: Position | null } | undefined>(undefined);
  const [tradeInProgress, setTradeInProgress] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  const isTrading = execLoading || tradeInProgress;

  // Defensive: fetch AMM state if missing from market object
  const fetchAmmState = useCallback(async (marketId: string) => {
    const { data } = await supabase
      .from("amm_state")
      .select("*")
      .eq("market_id", marketId)
      .single();
    if (data) {
      setActiveMarket((prev) =>
        prev?.id === marketId ? { ...prev, amm_state: data as AmmState } : prev
      );
    }
  }, [supabase]);

  // Lazy fetch position for a single market
  const fetchPosition = useCallback(async (marketId: string) => {
    if (!user) {
      setPosition(undefined);
      return;
    }
    const { data, error } = await supabase
      .from("positions")
      .select("*")
      .eq("user_id", user.id)
      .eq("market_id", marketId);

    if (error) {
      console.error("Failed to fetch position:", error);
      setPosition({ yes: null, no: null });
      return;
    }

    if (data) {
      const positions = data as Position[];
      setPosition({
        yes: positions.find((p) => p.side === "yes") ?? null,
        no: positions.find((p) => p.side === "no") ?? null,
      });
    } else {
      setPosition(undefined);
    }
  }, [supabase, user]);

  const openTrade = useCallback((market: MarketWithAmm, side: Side) => {
    if (market.status !== "open") {
      toast.error(tToast("tradeFailed"), {
        description: tTrade("errorMarketClosed"),
      });
      return;
    }
    if (getMarketTimeState(market) === "upcoming") {
      toast.error(tToast("tradeFailed"), {
        description: tTrade("errorMarketUpcoming"),
      });
      return;
    }
    setActiveMarket(market);
    setActiveSide(side);
    setPosition(undefined);
    // Fetch position in background
    fetchPosition(market.id);
    // Defensive: fetch AMM state if missing from market object
    if (!market.amm_state) {
      fetchAmmState(market.id);
    }
  }, [fetchPosition, fetchAmmState, tToast, tTrade]);

  const closeSheet = useCallback(() => {
    setActiveMarket(null);
  }, []);

  // Build an AmmState-compatible object from MarketWithAmm
  const ammState: AmmState | null = activeMarket?.amm_state
    ? (activeMarket.amm_state as AmmState)
    : null;

  const handleConfirm = useCallback(async (side: Side, amount: number, direction: "buy" | "sell") => {
    if (!activeMarket || !ammState) return;

    if (!user) {
      openLoginModal();
      return;
    }

    // Balance check for buys. Demo reads demo_balance_usd and sends broke
    // users to demo settings (reset button) instead of opening the
    // real-money deposit modal.
    if (direction === "buy") {
      const freshUser = await refetchUser();
      const u = (freshUser ?? user) as unknown as { balance_usd: number; demo_balance_usd?: number | null };
      const currentBalance = isDemo ? Number(u.demo_balance_usd ?? 0) : u.balance_usd;
      if (currentBalance <= 0 || currentBalance < amount) {
        if (isDemo) {
          toast.error(tToast("insufficientDemoBalance") ?? "Not enough demo balance", {
            description: tToast("insufficientDemoBalanceDesc") ?? "Reset your demo balance in Settings.",
          });
        } else {
          openDepositModal();
        }
        return;
      }
    }

    setTradeInProgress(true);
    try {
      const { data: result, error: tradeErr } = await executeTrade(
        activeMarket.id, side, direction, amount
      );

      if (result) {
        if (direction === "buy") adjustBalance(-amount);
        await Promise.all([refetchUser(), refetchMarkets()]);
        // Refetch position for this market
        await fetchPosition(activeMarket.id);
        setShowConfetti(true);
        closeSheet();
        toast.success(
          direction === "buy" ? tToast("tradePlaced") : tToast("positionClosed"),
          {
            description: direction === "buy"
              ? tMarket("tradePlacedDesc", { shares: sharesToLots(result.shares).toFixed(3), side: side.toUpperCase() })
              : tMarket("positionClosedDesc", { shares: sharesToLots(result.shares).toFixed(3), side: side.toUpperCase() }),
          }
        );
        if (result.price_impact_warning) {
          toast.warning(tToast("largePriceImpact"), {
            description: tMarket("largePriceImpactDesc"),
          });
        }
      } else if (tradeErr) {
        toast.error(tToast("tradeFailed"), {
          description: mapTradeError(tradeErr, tTrade, getMaxTradeUsd(ammState)),
        });
      }
    } finally {
      setTradeInProgress(false);
    }
  }, [activeMarket, ammState, user, isDemo, executeTrade, adjustBalance, refetchUser, refetchMarkets, fetchPosition, closeSheet, openLoginModal, openDepositModal, tTrade, tToast, tMarket]);

  return (
    <TradeSheetContext.Provider value={{ openTrade }}>
      {children}

      {showConfetti && <Confetti trigger={showConfetti} onComplete={() => setShowConfetti(false)} />}

      <Sheet open={activeMarket !== null} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] overflow-y-auto rounded-t-2xl"
          overlayClassName="bg-black/60"
          showCloseButton={false}
        >
          {activeMarket && ammState ? (
            <MobileTradeSheet
              market={activeMarket}
              ammState={ammState}
              position={position}
              onConfirm={handleConfirm}
              loading={isTrading}
              initialSide={activeSide}
              onClose={closeSheet}
            />
          ) : activeMarket ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-custom" />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </TradeSheetContext.Provider>
  );
}
