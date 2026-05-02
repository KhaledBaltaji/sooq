import { logger } from "@/lib/logger";
import type {
  GenerateWalletParams,
  GenerateWalletResponse,
  GetWalletBalanceResponse,
  VerifyTransactionResponse,
  ListTransactionsParams,
  ListTransactionsResponse,
} from "./types";

function getConfig() {
  const apiKey = process.env.THREEPAY_API_KEY;
  const apiSecret = process.env.THREEPAY_API_SECRET;
  const baseUrl = process.env.THREEPAY_BASE_URL || "https://sandbox.pay.3pa-y.com/api/v1";

  if (!apiKey || !apiSecret) {
    throw new Error("Missing THREEPAY_API_KEY or THREEPAY_API_SECRET");
  }

  return { apiKey, apiSecret, baseUrl };
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  options?: { body?: Record<string, unknown>; query?: Record<string, string> }
): Promise<T> {
  const { apiKey, apiSecret, baseUrl } = getConfig();

  const url = new URL(`${baseUrl}${path}`);
  if (options?.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
      "x-api-secret": apiSecret,
    },
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
  });

  const data = await res.json();

  if (!res.ok || data.success === false) {
    logger.error("3pay API error", {
      source: "3pay-client",
      path,
      status: res.status,
      response: data,
    });
    throw new Error(data.message || `3pay API error: ${res.status}`);
  }

  return data as T;
}

export async function generateWallet(
  params: GenerateWalletParams
): Promise<GenerateWalletResponse> {
  return request<GenerateWalletResponse>("POST", "/wallet/generate", {
    body: params as unknown as Record<string, unknown>,
  });
}

export async function getWalletBalance(
  userId: string
): Promise<GetWalletBalanceResponse> {
  return request<GetWalletBalanceResponse>(
    "GET",
    `/wallet/balance/${userId}`
  );
}

export async function verifyTransaction(
  transactionId: string,
  type?: string
): Promise<VerifyTransactionResponse> {
  const query: Record<string, string> = { transactionId };
  if (type) query.type = type;
  return request<VerifyTransactionResponse>(
    "GET",
    "/transaction/verify",
    { query }
  );
}

export async function listTransactions(
  params?: ListTransactionsParams
): Promise<ListTransactionsResponse> {
  const query: Record<string, string> = {};
  if (params?.type) query.type = params.type;
  if (params?.status) query.status = params.status;
  if (params?.search) query.search = params.search;
  if (params?.page) query.page = String(params.page);
  if (params?.limit) query.limit = String(params.limit);
  return request<ListTransactionsResponse>(
    "GET",
    "/transaction/list",
    { query }
  );
}
