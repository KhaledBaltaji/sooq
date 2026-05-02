import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";

/**
 * Branch-level OG image (no specific market).
 *
 * Renders a branded card for /b/[branchCode] used by the share-kit modal and
 * by social-media link previews when users share their branch URL.
 * Used by commission branches (and reseller branches) that want a branded
 * share artifact tied to the branch itself rather than a particular market.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const interBold = fetch(
  "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf"
).then((res) => res.arrayBuffer());

const interBlack = fetch(
  "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuBWYMZg.ttf"
).then((res) => res.arrayBuffer());

const DS = {
  bg: "#000000",
  surface: "#111113",
  border: "#222228",
  text: "#FFFFFF",
  muted: "#8A8A98",
  accent: "#2D8CFF",
  commission: "#6366F1",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ branchCode: string }> }
) {
  try {
    const { branchCode } = await params;

    const { data: branch } = await supabase
      .from("branches")
      .select("name, branch_code, book_type, status")
      .eq("branch_code", branchCode)
      .single();

    if (!branch) {
      return new Response("Branch not found", { status: 404 });
    }

    const [bold, black] = await Promise.all([interBold, interBlack]);
    const isCommission = branch.book_type === "commission";
    const accent = isCommission ? DS.commission : DS.accent;

    return new ImageResponse(
      (
        <div
          style={{
            width: "1200px",
            height: "630px",
            background: DS.bg,
            display: "flex",
            flexDirection: "column",
            padding: "80px",
            fontFamily: "Inter",
            color: DS.text,
          }}
        >
          {/* Header: SOOQ brand */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                fontSize: "24px",
                fontWeight: 900,
                letterSpacing: "-0.02em",
                color: DS.text,
              }}
            >
              SOOQ
            </div>
            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.2em",
                color: DS.muted,
                textTransform: "uppercase",
              }}
            >
              · {isCommission ? "Agent Network" : "Branch"}
            </div>
          </div>

          {/* Main content */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                fontSize: "72px",
                fontWeight: 900,
                lineHeight: 1.05,
                letterSpacing: "-0.03em",
                color: DS.text,
                marginBottom: "24px",
              }}
            >
              Join {branch.name}
            </div>
            <div
              style={{
                fontSize: "28px",
                fontWeight: 700,
                color: DS.muted,
                marginBottom: "40px",
              }}
            >
              {isCommission
                ? "Predict politics. Real money. Real outcomes."
                : "Trade on real-world outcomes"}
            </div>
          </div>

          {/* Footer: URL */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              padding: "20px 32px",
              background: DS.surface,
              border: `1px solid ${DS.border}`,
              borderRadius: "16px",
              alignSelf: "flex-start",
            }}
          >
            <div
              style={{
                width: "4px",
                height: "32px",
                background: accent,
                borderRadius: "2px",
              }}
            />
            <div
              style={{
                fontSize: "28px",
                fontWeight: 700,
                color: DS.text,
                fontFamily: "monospace",
              }}
            >
              sooq.exchange/b/{branch.branch_code}
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        fonts: [
          { name: "Inter", data: bold, weight: 700, style: "normal" },
          { name: "Inter", data: black, weight: 900, style: "normal" },
        ],
        headers: {
          "Cache-Control": "public, max-age=3600, s-maxage=3600",
        },
      }
    );
  } catch (err) {
    return new Response(
      `OG generation failed: ${err instanceof Error ? err.message : "unknown"}`,
      { status: 500 }
    );
  }
}
