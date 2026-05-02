// 3pay API request/response types
// Docs: https://docs.3pa-y.com/reference/getting-started

// --- Wallet ---

export interface GenerateWalletParams {
  userId: string;
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  callbackUrl?: string;
  isActive?: boolean;
}

export interface WalletInfo {
  walletAddress: string;
  walletNetwork: string;
}

export interface GenerateWalletResponse {
  success: boolean;
  message: string;
  data: {
    userId: string;
    wallets: WalletInfo[];
  };
}

export interface GetWalletBalanceResponse {
  success: boolean;
  message: string;
  data: {
    userId: string;
    totalBalance: number;
    wallets: {
      walletAddress: string;
      walletNetwork: string;
      balance: number;
      lastDepositAt: string | null;
      lastDepositAmount: number;
      totalDeposits: number;
      totalDepositAmount: number;
    }[];
  };
}

// --- Transactions ---

export interface VerifyTransactionResponse {
  success: boolean;
  message: string;
  data: {
    transactionId: string;
    amount: number;
    fee: number;
    netAmount: number;
    currencyType: string;
    status: string;
    walletAddress: string;
    invoiceNo: string;
    blockchainTxHash: string;
    type: string;
    createdAt: string;
  };
}

export interface ListTransactionsParams {
  type?: "deposit" | "withdrawal" | "payout";
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface TransactionRecord {
  transactionId: string;
  amount: number;
  fee: number;
  netAmount: number;
  currencyType: string;
  status: string;
  walletAddress: string;
  invoiceNo: string;
  blockchainTxHash: string;
  type: string;
  createdAt: string;
}

export interface ListTransactionsResponse {
  success: boolean;
  message: string;
  data: {
    docs: TransactionRecord[];
    page: number;
    limit: number;
  };
}

// --- Webhook ---

/** The inner data object sent by 3pay webhooks */
export interface ThreePayWebhookData {
  type: "deposit" | "withdrawal" | "payout";
  transactionId: string;
  clientId: string;
  amount: number;
  fee: number;
  netAmount: number;
  actualBalance: number;
  currencyType: string;
  status: "confirmed" | "pending" | "completed" | "failed" | "rejected";
  createdAt: string;
  confirmedAt: string;
  blockchainTxHash: string;
  walletAddress: string;
  network: string;
}

/** Top-level webhook payload envelope from 3pay */
export interface ThreePayWebhookPayload {
  success: boolean;
  message: string;
  data: ThreePayWebhookData;
}
