"use client";

import { useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SwipeToConfirm } from "@/components/ui/swipe-to-confirm";
import { Button } from "@/components/ui/button";
import { Odometer } from "@/components/ui/odometer";
import { useClosePosition } from "@/hooks/use-close-position";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { sharesToLots } from "@/lib/market-utils";
// useMediaQuery hook is inline below (useMediaQueryFallback)

interface ClosePositionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketId: string;
  side: string;
  shares: number;
  onComplete?: () => void;
}

function useMediaQueryFallback(query: string): boolean {
  // Simple SSR-safe media query hook
  if (typeof window === "undefined") return false;
  return window.matchMedia(query).matches;
}

export function ClosePositionSheet({ open, onOpenChange, marketId, side, shares, onComplete }: ClosePositionSheetProps) {
  const { preview, execute, previewData, loading, error, reset } = useClosePosition();
  const t = useTranslations("trade");
  const isDesktop = useMediaQueryFallback("(min-width: 768px)");

  useEffect(() => {
    if (open && shares > 0) {
      preview(marketId, side, shares);
    }
    return () => reset();
  }, [open, marketId, side, shares]);

  const handleConfirm = async () => {
    const { error: err } = await execute(marketId, side, shares);
    if (!err) {
      onComplete?.();
      onOpenChange(false);
    }
  };

  const content = (
    <div className="space-y-md p-md">
      <h3 className="font-satoshi font-bold text-lg text-text text-center">
        {t("closeLots", { lots: sharesToLots(shares).toFixed(3), side: side.toUpperCase() })}
      </h3>

      {previewData ? (
        <div className="space-y-sm">
          <div className="flex justify-between text-sm">
            <span className="text-muted">{t("grossProceeds")}</span>
            <span className="text-text tabular-nums">${previewData.gross_proceeds.toFixed(4)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted">{t("fee")}</span>
            <span className="text-muted tabular-nums">-${previewData.explicit_fee.toFixed(4)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted">{t("exitFee")}</span>
            <span className="text-muted tabular-nums">-${previewData.cash_out_premium.toFixed(4)}</span>
          </div>
          <div className="border-t border-border pt-sm flex justify-between">
            <span className="font-medium text-text">{t("youReceive")}</span>
            <span className="font-satoshi font-bold text-xl text-success tabular-nums">
              <Odometer value={previewData.net_proceeds} format={(n: number) => `$${n.toFixed(2)}`} />
            </span>
          </div>
        </div>
      ) : (
        <div className="text-center text-muted text-sm">{t("calculating")}</div>
      )}

      {error && (
        <p className="text-error text-sm text-center">{error}</p>
      )}

      <p className="text-xs text-muted-custom text-center">
        {t("pricesMayChange") ?? "Final amount may vary slightly due to price changes"}
      </p>

      {previewData && !loading ? (
        <SwipeToConfirm
          onConfirm={handleConfirm}
          label={t("swipeToClose")}
          variant={side === "yes" ? "yes" : "no"}
        />
      ) : (
        <Button
          disabled
          className="w-full h-12 bg-elevated text-muted"
        >
          {loading ? t("processing") : t("calculating")}
        </Button>
      )}
    </div>
  );

  // Desktop: dialog, Mobile: bottom sheet
  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent showCloseButton={false} className="bg-[var(--bg)] text-[var(--text)]" data-theme="dark">
          {content}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="rounded-t-2xl bg-[var(--bg)] text-[var(--text)]" data-theme="dark">
        {content}
      </SheetContent>
    </Sheet>
  );
}
