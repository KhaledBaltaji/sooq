"use client";

import { useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { MobileTradeSheet } from "./mobile-trade-sheet";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { triggerHaptic } from "@/lib/utils";
import { MIN_DISPLAY_SHARES } from "@/lib/constants";
import { ArrowUpRight } from "lucide-react";
import { applyMarkup, toDecimalOdds, formatDecimalOdds } from "@/lib/branch-pricing";
import { useFeeRates } from "@/hooks/use-fee-rates";
import type { Market, AmmState, Position } from "@/types/market";
import type { Side } from "@/types/database";

interface MobileTradeBarProps {
  market: Market;
  ammState: AmmState;
  position?: { yes: Position | null; no: Position | null };
  onConfirm: (side: Side, amount: number, direction: "buy" | "sell") => void;
  loading?: boolean;
  branchMarkup?: { yesPct: number; noPct: number };
  displayMode?: "trading" | "betting";
}

export function MobileTradeBar({
  market,
  ammState,
  position,
  onConfirm,
  loading,
  branchMarkup,
  displayMode,
}: MobileTradeBarProps) {
  const t = useTranslations("trade");
  const feeRates = useFeeRates();
  const [tradeSide, setTradeSide] = useState<Side | null>(null);
  const [openMode, setOpenMode] = useState<"buy" | "positions">("buy");
  const touchedRef = useRef(false);

  const handlePress = useCallback((side: Side) => {
    triggerHaptic();
    setOpenMode("buy");
    setTradeSide(side);
  }, []);

  const handleCashOut = useCallback(() => {
    triggerHaptic();
    setOpenMode("positions");
    setTradeSide("yes"); // non-null to open the sheet
  }, []);

  // Mid prices for button labels
  const yesLabel = branchMarkup
    ? displayMode === "betting"
      ? formatDecimalOdds(toDecimalOdds(applyMarkup(ammState.current_yes_price, branchMarkup.yesPct), feeRates.resolution))
      : (applyMarkup(ammState.current_yes_price, branchMarkup.yesPct) * 100).toFixed(1) + "%"
    : (ammState.current_yes_price * 100).toFixed(1) + "%";
  const noLabel = branchMarkup
    ? displayMode === "betting"
      ? formatDecimalOdds(toDecimalOdds(applyMarkup(1 - ammState.current_yes_price, branchMarkup.noPct), feeRates.resolution))
      : (applyMarkup(1 - ammState.current_yes_price, branchMarkup.noPct) * 100).toFixed(1) + "%"
    : ((1 - ammState.current_yes_price) * 100).toFixed(1) + "%";

  const hasAnyPosition = !!(
    (position?.yes && position.yes.shares_held >= MIN_DISPLAY_SHARES) ||
    (position?.no && position.no.shares_held >= MIN_DISPLAY_SHARES)
  );

  return (
    <>
      {/* Fixed bottom bar — above BottomNav */}
      <div className="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-bg border-t border-border-custom px-4 pt-3 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]">
        <div className="flex gap-3">
          <button
            onTouchStart={() => {}}
            onTouchEnd={(e) => { e.preventDefault(); touchedRef.current = true; setTimeout(() => { touchedRef.current = false; }, 400); handlePress("yes"); }}
            onClick={() => { if (touchedRef.current) { touchedRef.current = false; return; } handlePress("yes"); }}
            className="flex-1 h-[52px] rounded-xl font-satoshi font-bold text-[15px] text-white bg-yes
              shadow-[0_4px_0_0px_rgba(15,60,140,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(15,60,140,0.9)]
              transition-all duration-[80ms] [-webkit-tap-highlight-color:transparent]"
          >
            {t("buyYes")} {yesLabel}
          </button>
          <button
            onTouchStart={() => {}}
            onTouchEnd={(e) => { e.preventDefault(); touchedRef.current = true; setTimeout(() => { touchedRef.current = false; }, 400); handlePress("no"); }}
            onClick={() => { if (touchedRef.current) { touchedRef.current = false; return; } handlePress("no"); }}
            className="flex-1 h-[52px] rounded-xl font-satoshi font-bold text-[15px] text-white bg-no
              shadow-[0_4px_0_0px_rgba(140,15,30,0.9)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(140,15,30,0.9)]
              transition-all duration-[80ms] [-webkit-tap-highlight-color:transparent]"
          >
            {t("buyNo")} {noLabel}
          </button>
          {hasAnyPosition && (
            <button
              onTouchStart={() => {}}
              onTouchEnd={(e) => { e.preventDefault(); touchedRef.current = true; setTimeout(() => { touchedRef.current = false; }, 400); handleCashOut(); }}
              onClick={() => { if (touchedRef.current) { touchedRef.current = false; return; } handleCashOut(); }}
              className="flex-[0.7] h-[52px] rounded-xl font-satoshi font-bold text-[13px] text-yes bg-elevated border border-yes/30
                shadow-[0_4px_0_0px_rgba(45,140,255,0.25)] active:translate-y-[3px] active:shadow-[0_1px_0_0px_rgba(45,140,255,0.25)]
                transition-all duration-[80ms] [-webkit-tap-highlight-color:transparent]
                flex items-center justify-center gap-1.5"
            >
              <ArrowUpRight className="w-4 h-4" />
              {t("closePosition")}
            </button>
          )}
        </div>
      </div>

      {/* Trade sheet */}
      <Sheet open={tradeSide !== null} onOpenChange={(open) => !open && setTradeSide(null)}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] overflow-y-auto rounded-t-2xl"
          showCloseButton={false}
        >
          <MobileTradeSheet
            market={market}
            ammState={ammState}
            position={position}
            onConfirm={(side, amount, direction) => {
              onConfirm(side, amount, direction);
              setTradeSide(null);
            }}
            loading={loading}
            initialSide={openMode === "buy" ? (tradeSide ?? undefined) : undefined}
            initialMode={openMode}
            onClose={() => setTradeSide(null)}
            branchMarkup={branchMarkup}
            displayMode={displayMode}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
