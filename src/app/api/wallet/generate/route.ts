import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userWallets, users } from "@/lib/db/schema";
import { generateWallet } from "@/lib/3pay";
import { logger } from "@/lib/logger";

// W7 cutover: Drizzle-backed wallet provisioning. Cache hit returns the
// stored TRC20 + ERC20 pair; cache miss calls 3pay and persists the
// addresses for next time. UNIQUE on user_id (PK) is the race gate.

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    // Cache hit?
    const existing = await db
      .select()
      .from(userWallets)
      .where(eq(userWallets.userId, userId))
      .limit(1);
    if (existing[0]) {
      return NextResponse.json({
        trc20: existing[0].walletAddressTrc20,
        erc20: existing[0].walletAddressErc20,
      });
    }

    // Need email + phone for 3pay's generateWallet call.
    const profileRows = await db
      .select({ email: users.email, phone: users.phone })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const profile = profileRows[0];

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

    const response = await generateWallet({
      userId,
      email: profile?.email ?? "",
      phone: profile?.phone ?? undefined,
      callbackUrl: appUrl ? `${appUrl}/api/webhook/3pay` : undefined,
    });

    if (!response.data.wallets || response.data.wallets.length === 0) {
      logger.error("3pay returned empty wallets array", {
        source: "api/wallet/generate",
        userId,
      });
      return NextResponse.json(
        { error: "No wallet addresses returned" },
        { status: 502 }
      );
    }

    const trc20 =
      response.data.wallets.find((w) => w.walletNetwork.includes("TRC20"))
        ?.walletAddress ?? null;
    const erc20 =
      response.data.wallets.find((w) => w.walletNetwork.includes("ERC20"))
        ?.walletAddress ?? null;

    // Race-safe upsert: PK on user_id means the loser short-circuits and
    // we read back whichever row landed first.
    await db
      .insert(userWallets)
      .values({
        userId,
        provider: "3pay",
        providerUserId: response.data.userId,
        walletAddressTrc20: trc20,
        walletAddressErc20: erc20,
      })
      .onConflictDoNothing({ target: userWallets.userId });

    const canonical = await db
      .select()
      .from(userWallets)
      .where(eq(userWallets.userId, userId))
      .limit(1);

    if (!canonical[0]) {
      logger.error("Failed to read back wallet after upsert", {
        source: "api/wallet/generate",
        userId,
      });
      return NextResponse.json(
        { error: "Failed to resolve wallet" },
        { status: 500 }
      );
    }

    logger.info("Wallet generated", {
      source: "api/wallet/generate",
      userId,
      hasTrc20: Boolean(canonical[0].walletAddressTrc20),
      hasErc20: Boolean(canonical[0].walletAddressErc20),
    });

    return NextResponse.json({
      trc20: canonical[0].walletAddressTrc20,
      erc20: canonical[0].walletAddressErc20,
    });
  } catch (err) {
    logger.error("Wallet generation failed", { source: "api/wallet/generate" }, err);
    return NextResponse.json(
      { error: "Wallet generation failed" },
      { status: 500 }
    );
  }
}
