import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Pre-fetch fonts at module level for reuse across requests
const interBold = fetch(
  "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf"
).then((res) => res.arrayBuffer());

const interBlack = fetch(
  "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuBWYMZg.ttf"
).then((res) => res.arrayBuffer());

function formatTimeRemaining(closesAt: string): string {
  const now = Date.now();
  const closes = new Date(closesAt).getTime();
  const diff = closes - now;
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${mins}m`;
}

// Design system tokens (DESIGN.md dark mode)
const DS = {
  bg: "#000000",
  surface: "#111113",
  border: "#222228",
  text: "#FFFFFF",
  muted: "#8A8A98",
  yes: "#2D8CFF",
  no: "#FF4757",
  warning: "#FFB800",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ branchCode: string; marketId: string }> }
) {
  try {
    const { branchCode, marketId } = await params;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [{ data: market }, { data: amm }, { data: branch }] = await Promise.all([
      supabase
        .from("markets")
        .select("question_en, opens_at, closes_at, status")
        .eq("id", marketId)
        .single(),
      supabase
        .from("amm_state")
        .select("current_yes_price, current_no_price")
        .eq("market_id", marketId)
        .single(),
      (supabase as any)
        .from("branches")
        .select("name")
        .eq("branch_code", branchCode)
        .single() as Promise<{ data: { name: string } | null }>,
    ]);

    if (!market) {
      return new Response("Market not found", { status: 404 });
    }

    const branchName = branch?.name ?? branchCode;
    const yesPrice = amm?.current_yes_price ?? 0.5;
    const yesPct = Math.round(yesPrice * 100);
    const noPct = Math.round((1 - yesPrice) * 100);
    const nowMs = Date.now();
    const isUpcoming = new Date(market.opens_at).getTime() > nowMs;
    const isEnded = !isUpcoming && (market.status !== "open" || new Date(market.closes_at).getTime() < nowMs);
    const closesIn = isEnded ? "Ended" : formatTimeRemaining(market.closes_at);
    const opensIn = isUpcoming ? formatTimeRemaining(market.opens_at) : "";
    const opensDate = isUpcoming
      ? new Date(market.opens_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "";

    const [interBoldData, interBlackData] = await Promise.all([
      interBold,
      interBlack,
    ]);

    return new ImageResponse(
      (
        <div
          style={{
            width: "1200px",
            height: "1200px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: DS.bg,
            fontFamily: "Inter",
          }}
        >
          <div
            style={{
              width: "1100px",
              height: "1100px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "60px 56px",
              backgroundColor: DS.surface,
              borderRadius: "32px",
              border: `1px solid ${DS.border}`,
              color: DS.text,
            }}
          >
            {/* Top labels — branch branded */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "40px",
              }}
            >
              <span style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "2px", color: isUpcoming ? DS.warning : DS.yes }}>
                {isUpcoming ? "UPCOMING MARKET" : "LIVE MARKET"}
              </span>
              <span style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "1px", color: DS.muted }}>
                {branchName}
              </span>
            </div>

            {/* Question */}
            <div style={{ display: "flex", flexDirection: "column", marginBottom: "48px" }}>
              <div style={{ fontSize: "52px", fontWeight: 900, lineHeight: "1.2" }}>
                {market.question_en}
              </div>
            </div>

            {isUpcoming ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "60px 40px",
                  borderRadius: "16px",
                  border: `2px solid #3A2F0D`,
                  backgroundColor: "#1C1608",
                  marginBottom: "36px",
                }}
              >
                <span style={{ fontSize: "22px", fontWeight: 700, color: DS.warning, letterSpacing: "3px" }}>
                  OPENS IN
                </span>
                <span style={{ fontSize: "96px", fontWeight: 900, color: DS.warning, lineHeight: "1", marginTop: "16px" }}>
                  {opensIn}
                </span>
                <span style={{ fontSize: "20px", color: DS.muted, fontWeight: 500, marginTop: "12px" }}>
                  Trading starts {opensDate}
                </span>
              </div>
            ) : (
              <>
                {/* YES / NO boxes */}
                <div style={{ display: "flex", gap: "24px", marginBottom: "36px" }}>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: 1,
                      padding: "40px",
                      borderRadius: "16px",
                      border: `2px solid #1A3A6B`,
                      backgroundColor: "#0D1828",
                    }}
                  >
                    <span style={{ fontSize: "72px", fontWeight: 900, color: DS.yes, lineHeight: "1" }}>
                      {yesPct}%
                    </span>
                    <span style={{ fontSize: "20px", fontWeight: 700, color: DS.yes, letterSpacing: "3px", marginTop: "8px" }}>
                      YES
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: 1,
                      padding: "40px",
                      borderRadius: "16px",
                      border: `2px solid #6B1A23`,
                      backgroundColor: "#280D12",
                    }}
                  >
                    <span style={{ fontSize: "72px", fontWeight: 900, color: DS.no, lineHeight: "1" }}>
                      {noPct}%
                    </span>
                    <span style={{ fontSize: "20px", fontWeight: 700, color: DS.no, letterSpacing: "3px", marginTop: "8px" }}>
                      NO
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ display: "flex", width: "100%", height: "10px", borderRadius: "5px", backgroundColor: "#2A2A30", marginBottom: "36px" }}>
                  <div style={{ width: `${yesPct}%`, height: "8px", borderRadius: "4px", backgroundColor: DS.yes }} />
                </div>
              </>
            )}

            {/* Bottom: stats + branding */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
              <div style={{ display: "flex", gap: "48px" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "16px", color: DS.muted, fontWeight: 500 }}>
                    {isUpcoming ? "Opens on" : isEnded ? "Status" : "Closes in"}
                  </span>
                  <span style={{ fontSize: "30px", fontWeight: 900, color: isEnded ? DS.no : DS.warning }}>
                    {isUpcoming ? opensDate : closesIn}
                  </span>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "16px 40px",
                  borderRadius: "12px",
                  backgroundColor: DS.yes,
                  fontSize: "22px",
                  fontWeight: 700,
                  color: DS.text,
                }}
              >
                {isUpcoming ? "Get ready" : "Make your prediction"}
              </div>
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 1200,
        fonts: [
          { name: "Inter", data: interBoldData, weight: 700, style: "normal" as const },
          { name: "Inter", data: interBlackData, weight: 900, style: "normal" as const },
        ],
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
        },
      }
    );
  } catch {
    return new Response("Failed to generate image", { status: 500 });
  }
}
