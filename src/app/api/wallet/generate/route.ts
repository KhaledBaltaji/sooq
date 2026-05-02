import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { generateWallet } from "@/lib/3pay";
import { logger } from "@/lib/logger";

const serviceClient = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST() {
  try {
    // Authenticate user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ═══ Check existing wallet — if present, return early. This is safe
    // against the classic check-then-act race because we ALSO upsert below
    // with ON CONFLICT DO NOTHING as a second gate: two concurrent calls
    // that both see NULL here will race to insert, and the one that loses
    // the conflict simply reads back the winner's row. See the "read-back"
    // block below if upsert reports conflict.
    const { data: existing } = await serviceClient
      .from("user_wallets")
      .select("wallet_address_trc20, wallet_address_erc20")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        trc20: existing.wallet_address_trc20,
        erc20: existing.wallet_address_erc20,
      });
    }

    // Generate wallet via 3pay
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

    const response = await generateWallet({
      userId: user.id,
      email: user.email || "",
      phone: user.phone || undefined,
      callbackUrl: appUrl ? `${appUrl}/api/webhook/3pay` : undefined,
    });

    // Extract addresses from response
    if (!response.data.wallets || response.data.wallets.length === 0) {
      logger.error("3pay returned empty wallets array", {
        source: "api/wallet/generate",
        userId: user.id,
      });
      return NextResponse.json(
        { error: "No wallet addresses returned" },
        { status: 502 }
      );
    }

    const trc20 =
      response.data.wallets.find((w) => w.walletNetwork.includes("TRC20"))
        ?.walletAddress || null;
    const erc20 =
      response.data.wallets.find((w) => w.walletNetwork.includes("ERC20"))
        ?.walletAddress || null;

    // ═══ Atomic upsert. If two requests race here, the UNIQUE constraint on
    // user_wallets.user_id ensures only one row lands. We use `ignoreDuplicates`
    // so the loser doesn't error — then we read back whichever wallet pair
    // actually won, so both callers see the same authoritative addresses
    // (not their own wasted 3pay response).
    const { error: insertError } = await serviceClient
      .from("user_wallets")
      .upsert({
        user_id: user.id,
        provider: "3pay",
        provider_user_id: response.data.userId,
        wallet_address_trc20: trc20,
        wallet_address_erc20: erc20,
      }, { onConflict: "user_id", ignoreDuplicates: true });

    if (insertError) {
      logger.error("Failed to store wallet", {
        source: "api/wallet/generate",
        userId: user.id,
        errorMessage: insertError.message,
      });
      return NextResponse.json(
        { error: "Failed to store wallet" },
        { status: 500 }
      );
    }

    // Read back the row that actually won the insert race. If our own insert
    // landed, this returns our addresses. If a concurrent call beat us to it,
    // this returns their addresses — which is correct for the user, since
    // that's the wallet the provider will credit.
    const { data: canonical, error: readBackError } = await serviceClient
      .from("user_wallets")
      .select("wallet_address_trc20, wallet_address_erc20")
      .eq("user_id", user.id)
      .maybeSingle();

    if (readBackError || !canonical) {
      logger.error("Failed to read back wallet after upsert", {
        source: "api/wallet/generate",
        userId: user.id,
        errorMessage: readBackError?.message,
      });
      return NextResponse.json(
        { error: "Failed to resolve wallet" },
        { status: 500 }
      );
    }

    logger.info("Wallet generated", {
      source: "api/wallet/generate",
      userId: user.id,
      hasTrc20: !!canonical.wallet_address_trc20,
      hasErc20: !!canonical.wallet_address_erc20,
    });

    return NextResponse.json({
      trc20: canonical.wallet_address_trc20,
      erc20: canonical.wallet_address_erc20,
    });
  } catch (err) {
    logger.error("Wallet generation failed", { source: "api/wallet/generate" }, err);
    return NextResponse.json(
      { error: "Wallet generation failed" },
      { status: 500 }
    );
  }
}
