import { formatCurrency } from "@/lib/utils";

/**
 * Maps raw trade error strings from the backend (execute_trade PL/pgSQL RAISE
 * EXCEPTION messages) to user-facing translated descriptions.
 *
 * Every known backend error has a dedicated mapping so users see what to *do*
 * next. Only genuinely unknown errors fall through to `errorGeneric`.
 */
export function mapTradeError(
  raw: string,
  t: (key: string, params?: Record<string, string | number>) => string,
  maxTradeUsd?: number
): string {
  const msg = raw.toLowerCase();

  if (msg.includes("rate limit")) return t("errorRateLimit");

  if (msg.includes("trade too large")) {
    return t("errorTradeTooLarge", {
      max: maxTradeUsd ? formatCurrency(maxTradeUsd) : "—",
    });
  }

  if (msg.includes("market has closed") || msg.includes("market is not open")) {
    return t("errorMarketClosed");
  }
  if (msg.includes("has not opened yet") || msg.includes("market not open yet")) {
    return t("errorMarketUpcoming");
  }

  if (msg.includes("no position to sell")) return t("errorNoPosition");
  if (msg.includes("insufficient shares")) return t("errorInsufficientShares");
  if (msg.includes("cannot sell more shares than amm holds")) {
    return t("errorAmmOutOfShares");
  }

  if (msg.includes("cost too small") || msg.includes("computed shares <= 0")) {
    return t("errorTradeTooSmall");
  }

  if (msg.includes("account is frozen")) return t("errorAccountFrozen");
  if (msg.includes("insufficient balance")) return t("errorInsufficientBalance");

  if (msg.includes("market not found")) return t("errorMarketNotFound");
  if (msg.includes("amm not initialized")) return t("errorMarketNotReady");

  if (msg.includes("not authenticated")) return t("errorNotAuthenticated");

  return t("errorGeneric");
}
