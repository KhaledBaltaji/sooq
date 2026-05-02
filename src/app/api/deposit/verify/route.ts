import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { verifyTransaction } from "@/lib/3pay";
import { logger } from "@/lib/logger";

// Read-only 3pay transaction lookup. Auth gates the call so we don't expose
// 3pay introspection to anonymous callers; no DB writes here.

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const transactionId = request.nextUrl.searchParams.get("transactionId");
    if (!transactionId) {
      return NextResponse.json({ error: "Missing transactionId" }, { status: 400 });
    }

    const result = await verifyTransaction(transactionId);

    return NextResponse.json({
      transactionId: result.data.transactionId,
      status: result.data.status,
      amount: result.data.amount,
      netAmount: result.data.netAmount,
      blockchainTxHash: result.data.blockchainTxHash,
    });
  } catch (err) {
    logger.error("Deposit verification failed", { source: "api/deposit/verify" }, err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
