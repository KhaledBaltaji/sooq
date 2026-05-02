// V3 AMM Database Types
// Replaces V2 pool-based types. Regenerate from Supabase CLI after migrations.

export type MarketStatus = "draft" | "open" | "closed" | "resolved" | "voided";
export type Side = "yes" | "no";
export type TradeDirection = "buy" | "sell";
export type AlertDirection = "above" | "below";
export type TransactionType =
  | "bet"
  | "win"
  | "deposit"
  | "withdrawal"
  | "commission"
  | "bonus"
  | "refund"
  | "seed"
  | "trade"
  | "close_position"
  | "resolution_payout"
  | "resolution_fee"
  | "agent_transfer_out"
  | "agent_transfer_in"
  | "admin_credit"
  | "admin_debit";
// Demo Mode — separate enum keeps live transaction_type pure (migration 263)
export type DemoTransactionType =
  | "demo_bet"
  | "demo_win"
  | "demo_reset"
  | "demo_seed";
export type WithdrawalStatus = "pending" | "approved" | "rejected";
export type CommissionStatus = "escrowed" | "credited" | "voided";
export type AgentLevel = 1 | 2 | 3 | 4;

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          phone: string | null;
          display_name: string | null;
          avatar_url: string | null;
          balance_usd: number;
          agent_balance_usd: number;
          referral_code: string;
          referred_by: string | null;
          referral_chain: string[];
          agent_level: AgentLevel;
          direct_referral_count: number;
          locale: string;
          is_admin: boolean;
          is_frozen: boolean;
          admin_allowed_views: string[] | null;
          wagering_requirement: number;
          total_wagered: number;
          deposit_bonus_claimed: boolean;
          network_volume: number;
          agent_activated: boolean;
          agent_activation_override: boolean;
          qualified_referral_count: number;
          email: string | null;
          bio: string | null;
          // Demo Mode (migration 263)
          demo_mode: boolean;
          demo_balance_usd: number;
          demo_first_enabled_at: string | null;
          demo_first_trade_at: string | null;
          first_real_deposit_after_demo_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          phone?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          balance_usd?: number;
          agent_balance_usd?: number;
          referral_code?: string;
          referred_by?: string | null;
          referral_chain?: string[];
          agent_level?: number;
          direct_referral_count?: number;
          locale?: string;
          is_admin?: boolean;
          is_frozen?: boolean;
          admin_allowed_views?: string[] | null;
          wagering_requirement?: number;
          total_wagered?: number;
          deposit_bonus_claimed?: boolean;
          network_volume?: number;
          agent_activated?: boolean;
          agent_activation_override?: boolean;
          qualified_referral_count?: number;
          email?: string | null;
          bio?: string | null;
          demo_mode?: boolean;
          demo_balance_usd?: number;
          demo_first_enabled_at?: string | null;
          demo_first_trade_at?: string | null;
          first_real_deposit_after_demo_at?: string | null;
        };
        Update: {
          phone?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          balance_usd?: number;
          agent_balance_usd?: number;
          referred_by?: string | null;
          referral_chain?: string[];
          agent_level?: number;
          direct_referral_count?: number;
          locale?: string;
          is_admin?: boolean;
          is_frozen?: boolean;
          admin_allowed_views?: string[] | null;
          wagering_requirement?: number;
          total_wagered?: number;
          deposit_bonus_claimed?: boolean;
          network_volume?: number;
          agent_activated?: boolean;
          agent_activation_override?: boolean;
          qualified_referral_count?: number;
          email?: string | null;
          bio?: string | null;
          demo_mode?: boolean;
          demo_balance_usd?: number;
          demo_first_enabled_at?: string | null;
          demo_first_trade_at?: string | null;
          first_real_deposit_after_demo_at?: string | null;
        };
        Relationships: [];
      };

      markets: {
        Row: {
          id: string;
          question_en: string;
          question_ar: string;
          description_en: string | null;
          description_ar: string | null;
          category: string;
          status: MarketStatus;
          outcome: Side | null;
          amm_liquidity_param: number;
          opening_price: number;
          trade_count: number;
          unique_traders: number;
          homepage_rank: number | null;
          opens_at: string;
          closes_at: string;
          resolved_at: string | null;
          created_by: string;
          keywords: string[];
          image_url: string | null;
          short_code: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          question_en: string;
          question_ar: string;
          description_en?: string | null;
          description_ar?: string | null;
          category: string;
          status?: MarketStatus;
          outcome?: Side | null;
          amm_liquidity_param?: number;
          opening_price?: number;
          trade_count?: number;
          unique_traders?: number;
          homepage_rank?: number | null;
          opens_at: string;
          closes_at: string;
          resolved_at?: string | null;
          created_by: string;
          keywords?: string[];
          image_url?: string | null;
          short_code?: string;
        };
        Update: {
          question_en?: string;
          question_ar?: string;
          description_en?: string | null;
          description_ar?: string | null;
          category?: string;
          status?: MarketStatus;
          outcome?: Side | null;
          amm_liquidity_param?: number;
          opening_price?: number;
          trade_count?: number;
          unique_traders?: number;
          homepage_rank?: number | null;
          opens_at?: string;
          closes_at?: string;
          resolved_at?: string | null;
          keywords?: string[];
          image_url?: string | null;
        };
        Relationships: [];
      };

      // V3: AMM state per market
      amm_state: {
        Row: {
          id: string;
          market_id: string;
          liquidity_param: number;
          q_yes: number;
          q_no: number;
          current_yes_price: number;
          current_no_price: number;
          total_volume: number;
          total_trades: number;
          seed_pnl: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          market_id: string;
          liquidity_param?: number;
          q_yes?: number;
          q_no?: number;
          current_yes_price?: number;
          current_no_price?: number;
          total_volume?: number;
          total_trades?: number;
          seed_pnl?: number;
        };
        Update: {
          liquidity_param?: number;
          q_yes?: number;
          q_no?: number;
          current_yes_price?: number;
          current_no_price?: number;
          total_volume?: number;
          total_trades?: number;
          seed_pnl?: number;
        };
        Relationships: [];
      };

      // V3: Trades (replaces bets)
      trades: {
        Row: {
          id: string;
          user_id: string;
          market_id: string;
          side: Side;
          direction: TradeDirection;
          shares: number;
          price_per_share: number;
          total_cost: number;
          explicit_fee: number;
          amm_spread_cost: number;
          dynamic_spread: number;
          cash_out_premium: number;
          post_yes_price: number | null;
          post_no_price: number | null;
          is_copy_trade: boolean;
          copied_from_user: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          market_id: string;
          side: Side;
          direction: TradeDirection;
          shares: number;
          price_per_share: number;
          total_cost: number;
          explicit_fee?: number;
          amm_spread_cost?: number;
          dynamic_spread?: number;
          cash_out_premium?: number;
          post_yes_price?: number | null;
          post_no_price?: number | null;
          is_copy_trade?: boolean;
          copied_from_user?: string | null;
        };
        Update: never;
        Relationships: [];
      };

      // V3: User positions per market per side
      positions: {
        Row: {
          id: string;
          user_id: string;
          market_id: string;
          side: Side;
          shares_held: number;
          avg_entry_price: number;
          total_invested: number;
          realized_pnl: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          market_id: string;
          side: Side;
          shares_held?: number;
          avg_entry_price?: number;
          total_invested?: number;
          realized_pnl?: number;
        };
        Update: {
          shares_held?: number;
          avg_entry_price?: number;
          total_invested?: number;
          realized_pnl?: number;
        };
        Relationships: [];
      };

      // V3: Price alerts
      price_alerts: {
        Row: {
          id: string;
          user_id: string;
          market_id: string;
          side: Side;
          target_price: number;
          direction: AlertDirection;
          is_triggered: boolean;
          is_active: boolean;
          created_at: string;
          triggered_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          market_id: string;
          side: Side;
          target_price: number;
          direction: AlertDirection;
          is_triggered?: boolean;
          is_active?: boolean;
        };
        Update: {
          target_price?: number;
          direction?: AlertDirection;
          is_active?: boolean;
        };
        Relationships: [];
      };

      // V3: Leader stats for copy trading
      leader_stats: {
        Row: {
          id: string;
          user_id: string;
          total_trades: number;
          winning_trades: number;
          accuracy_pct: number;
          total_pnl: number;
          copier_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          total_trades?: number;
          winning_trades?: number;
          accuracy_pct?: number;
          total_pnl?: number;
          copier_count?: number;
        };
        Update: {
          total_trades?: number;
          winning_trades?: number;
          accuracy_pct?: number;
          total_pnl?: number;
          copier_count?: number;
        };
        Relationships: [];
      };

      transactions: {
        Row: {
          id: string;
          user_id: string;
          type: TransactionType;
          amount: number;
          balance_after: number;
          reference_id: string | null;
          description: string | null;
          performed_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: TransactionType;
          amount: number;
          balance_after: number;
          reference_id?: string | null;
          description?: string | null;
          performed_by?: string | null;
        };
        Update: never; // append-only
        Relationships: [];
      };

      deposits: {
        Row: {
          id: string;
          user_id: string;
          amount: number;
          fee: number;
          net_amount: number;
          currency: string;
          provider_ref: string;
          provider: string;
          status: "pending" | "confirmed" | "failed";
          created_at: string;
          confirmed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          amount: number;
          fee: number;
          net_amount: number;
          currency: string;
          provider_ref: string;
          provider?: string;
          status: "pending" | "confirmed" | "failed";
        };
        Update: {
          status?: "pending" | "confirmed" | "failed";
          confirmed_at?: string | null;
        };
        Relationships: [];
      };

      withdrawals: {
        Row: {
          id: string;
          user_id: string;
          amount: number;
          fee: number;
          net_amount: number;
          currency: string;
          destination: string;
          status: WithdrawalStatus;
          admin_notes: string | null;
          created_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          amount: number;
          fee: number;
          net_amount: number;
          currency: string;
          destination: string;
          status?: WithdrawalStatus;
        };
        Update: {
          status?: WithdrawalStatus;
          admin_notes?: string | null;
          processed_at?: string | null;
        };
        Relationships: [];
      };

      referral_commissions: {
        Row: {
          id: string;
          referrer_id: string;
          trader_id: string;
          market_id: string;
          layer: 1 | 2;
          agent_level_at_time: AgentLevel;
          trade_id: string | null;
          platform_revenue_amount: number;
          commission_rate: number;
          commission_amount: number;
          revenue_type: "trade" | "resolution";
          status: CommissionStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          referrer_id: string;
          trader_id: string;
          market_id: string;
          layer: 1 | 2;
          agent_level_at_time: AgentLevel;
          trade_id?: string | null;
          platform_revenue_amount: number;
          commission_rate: number;
          commission_amount: number;
          revenue_type?: "trade" | "resolution";
          status?: CommissionStatus;
        };
        Update: { status?: CommissionStatus };
        Relationships: [];
      };

      platform_revenue: {
        Row: {
          id: string;
          market_id: string;
          total_pot: number;
          seed_amount: number;
          platform_fee: number;
          total_commissions: number;
          net_revenue: number;
          explicit_fee_revenue: number;
          amm_spread_revenue: number;
          resolution_fee_revenue: number;
          dynamic_spread_revenue: number;
          cash_out_premium_revenue: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          market_id: string;
          total_pot: number;
          seed_amount: number;
          platform_fee: number;
          total_commissions: number;
          net_revenue: number;
          explicit_fee_revenue?: number;
          amm_spread_revenue?: number;
          resolution_fee_revenue?: number;
          dynamic_spread_revenue?: number;
          cash_out_premium_revenue?: number;
        };
        Update: never;
        Relationships: [];
      };

      fee_config: {
        Row: {
          id: string;
          fee_type: string;
          level: number | null;
          depth: number | null;
          rate: number;
          description: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          fee_type: string;
          level?: number | null;
          depth?: number | null;
          rate: number;
          description?: string | null;
        };
        Update: {
          rate?: number;
          description?: string | null;
        };
        Relationships: [];
      };

      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          title_en: string;
          title_ar: string;
          body_en: string | null;
          body_ar: string | null;
          reference_id: string | null;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          title_en: string;
          title_ar: string;
          body_en?: string | null;
          body_ar?: string | null;
          reference_id?: string | null;
          is_read?: boolean;
        };
        Update: { is_read?: boolean };
        Relationships: [];
      };
      market_comments: {
        Row: {
          id: string;
          market_id: string;
          user_id: string;
          side: Side | null;
          body: string;
          parent_id: string | null;
          like_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          market_id: string;
          user_id: string;
          side?: Side | null;
          body: string;
          parent_id?: string | null;
        };
        Update: {
          like_count?: number;
        };
        Relationships: [];
      };

      comment_likes: {
        Row: {
          id: string;
          comment_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          comment_id: string;
          user_id: string;
        };
        Update: never;
        Relationships: [];
      };
      help_collections: {
        Row: {
          id: string;
          slug: string;
          title: string;
          description: string | null;
          icon: string;
          locale: string;
          sort_order: number;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          title: string;
          description?: string | null;
          icon?: string;
          locale?: string;
          sort_order?: number;
          is_published?: boolean;
        };
        Update: {
          slug?: string;
          title?: string;
          description?: string | null;
          icon?: string;
          locale?: string;
          sort_order?: number;
          is_published?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };

      help_articles: {
        Row: {
          id: string;
          collection_id: string;
          slug: string;
          title: string;
          content: string;
          sort_order: number;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          collection_id: string;
          slug: string;
          title: string;
          content?: string;
          sort_order?: number;
          is_published?: boolean;
        };
        Update: {
          collection_id?: string;
          slug?: string;
          title?: string;
          content?: string;
          sort_order?: number;
          is_published?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_wallets: {
        Row: {
          id: string;
          user_id: string;
          provider: string;
          provider_user_id: string | null;
          wallet_address_trc20: string | null;
          wallet_address_erc20: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider?: string;
          provider_user_id?: string | null;
          wallet_address_trc20?: string | null;
          wallet_address_erc20?: string | null;
          is_active?: boolean;
        };
        Update: {
          provider_user_id?: string | null;
          wallet_address_trc20?: string | null;
          wallet_address_erc20?: string | null;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };

      news_articles: {
        Row: {
          id: string;
          title: string;
          url: string;
          source_name: string;
          source_tier: string;
          summary: string | null;
          published_at: string;
          fetched_at: string;
          category: string | null;
          market_id: string | null;
          image_url: string | null;
        };
        Insert: {
          id?: string;
          title: string;
          url: string;
          source_name: string;
          source_tier?: string;
          summary?: string | null;
          published_at: string;
          category?: string | null;
          market_id?: string | null;
          image_url?: string | null;
        };
        Update: {
          category?: string | null;
          market_id?: string | null;
        };
        Relationships: [];
      };

      system_logs: {
        Row: {
          id: string;
          severity: "info" | "warn" | "error" | "critical";
          source: string;
          message: string;
          context: Record<string, unknown>;
          acknowledged: boolean;
          acknowledged_by: string | null;
          acknowledged_at: string | null;
          created_at: string;
        };
        Insert: {
          severity: "info" | "warn" | "error" | "critical";
          source: string;
          message: string;
          context?: Record<string, unknown>;
        };
        Update: {
          acknowledged?: boolean;
          acknowledged_by?: string;
          acknowledged_at?: string;
        };
        Relationships: [];
      };

      // ─── Demo Mode (migration 263) ────────────────────────────────
      demo_markets: {
        Row: {
          id: string;
          question_en: string;
          question_ar: string;
          description_en: string | null;
          description_ar: string | null;
          category: string;
          status: MarketStatus;
          outcome: Side | null;
          amm_liquidity_param: number;
          trade_count: number;
          unique_traders: number;
          homepage_rank: number | null;
          opens_at: string;
          closes_at: string;
          resolves_at: string;
          resolved_at: string | null;
          created_by: string;
          keywords: string[];
          image_url: string | null;
          short_code: string;
          resolution_fee_rate_snapshot: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          question_en: string;
          question_ar: string;
          description_en?: string | null;
          description_ar?: string | null;
          category?: string;
          status?: MarketStatus;
          outcome?: Side | null;
          amm_liquidity_param?: number;
          opens_at?: string;
          closes_at: string;
          resolves_at: string;
          resolved_at?: string | null;
          created_by: string;
          keywords?: string[];
          image_url?: string | null;
          short_code?: string;
          resolution_fee_rate_snapshot?: number;
        };
        Update: {
          question_en?: string;
          question_ar?: string;
          status?: MarketStatus;
          outcome?: Side | null;
          resolved_at?: string | null;
          image_url?: string | null;
        };
        Relationships: [];
      };

      demo_market_scheduled_outcomes: {
        Row: {
          market_id: string;
          scheduled_outcome: Side;
          created_by: string;
          created_at: string;
        };
        Insert: {
          market_id: string;
          scheduled_outcome: Side;
          created_by: string;
        };
        Update: { scheduled_outcome?: Side };
        Relationships: [];
      };

      demo_amm_state: {
        Row: {
          id: string;
          market_id: string;
          liquidity_param: number;
          q_yes: number;
          q_no: number;
          current_yes_price: number;
          current_no_price: number;
          total_volume: number;
          total_trades: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          market_id: string;
          liquidity_param?: number;
          q_yes?: number;
          q_no?: number;
          current_yes_price?: number;
          current_no_price?: number;
          total_volume?: number;
          total_trades?: number;
        };
        Update: {
          liquidity_param?: number;
          q_yes?: number;
          q_no?: number;
          current_yes_price?: number;
          current_no_price?: number;
          total_volume?: number;
          total_trades?: number;
        };
        Relationships: [];
      };

      demo_positions: {
        Row: {
          id: string;
          user_id: string;
          market_id: string;
          side: Side;
          shares_held: number;
          avg_entry_price: number;
          total_invested: number;
          realized_pnl: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          market_id: string;
          side: Side;
          shares_held?: number;
          avg_entry_price?: number;
          total_invested?: number;
          realized_pnl?: number;
        };
        Update: {
          shares_held?: number;
          avg_entry_price?: number;
          total_invested?: number;
          realized_pnl?: number;
        };
        Relationships: [];
      };

      demo_trades: {
        Row: {
          id: string;
          user_id: string;
          market_id: string;
          side: Side;
          direction: TradeDirection;
          shares: number;
          price_per_share: number;
          total_cost: number;
          post_yes_price: number | null;
          post_no_price: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          market_id: string;
          side: Side;
          direction: TradeDirection;
          shares: number;
          price_per_share: number;
          total_cost: number;
          post_yes_price?: number | null;
          post_no_price?: number | null;
        };
        Update: never;
        Relationships: [];
      };

      demo_transactions: {
        Row: {
          id: string;
          user_id: string;
          type: DemoTransactionType;
          amount: number;
          balance_after: number;
          reference_id: string | null;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: DemoTransactionType;
          amount: number;
          balance_after: number;
          reference_id?: string | null;
          description?: string | null;
        };
        Update: never;
        Relationships: [];
      };
    };

    Views: Record<string, never>;
    Enums: Record<string, never>;

    Functions: {
      get_amm_risk_snapshot: {
        Args: Record<string, never>;
        Returns: Array<{
          section: "aggregate" | "per_market";
          market_id: string | null;
          market_name: string | null;
          market_status: string | null;
          liquidity_param: string | null;
          q_yes: string;
          q_no: string;
          imbalance: string;
          cash_in: string;
          worst_case_payout: string;
          net_exposure: string;
          theoretical_max_loss: string | null;
          is_red_flag: boolean;
        }>;
      };
      admin_set_admin_role: {
        Args: {
          p_user_id: string;
          p_is_admin: boolean;
          p_allowed_views?: string[] | null;
        };
        Returns: {
          success: boolean;
          user_id: string;
          is_admin: boolean;
          admin_allowed_views: string[] | null;
        };
      };
      execute_trade: {
        Args: {
          p_market_id: string;
          p_side: string;
          p_amount?: number;
          p_shares_to_sell?: number;
        };
        Returns: {
          trade_id: string;
          shares: number;
          price_per_share: number;
          total_cost: number;
          fee: number;
          new_yes_price: number;
          new_no_price: number;
          price_impact_warning: boolean;
        };
      };
      get_amm_price: {
        Args: { p_market_id: string };
        Returns: {
          yes_price: number;
          no_price: number;
          volume: number;
          trades: number;
        };
      };
      get_cash_out_value: {
        Args: {
          p_market_id: string;
          p_side: string;
          p_shares: number;
        };
        Returns: {
          gross_proceeds: number;
          explicit_fee: number;
          cash_out_premium: number;
          net_proceeds: number;
          price_per_share: number;
        };
      };
      get_price_history: {
        Args: {
          p_market_id: string;
          p_period?: string;
          p_created_at?: string | null;
        };
        Returns: {
          bucket_time: string;
          yes_price: number;
          no_price: number;
        }[];
      };
      initialize_amm: {
        Args: {
          p_market_id: string;
          p_liquidity_param?: number;
        };
        Returns: {
          market_id: string;
          liquidity_param: number;
          yes_price: number;
          no_price: number;
        };
      };
      resolve_market: {
        Args: {
          p_market_id: string;
          p_outcome: Side;
        };
        Returns: {
          success: boolean;
          winners_paid: number;
          total_paid: number;
          total_commissions: number;
          seed_pnl: number;
        };
      };
      lock_market: {
        Args: { p_market_id: string };
        Returns: { success: boolean };
      };
      void_market: {
        Args: { p_market_id: string };
        Returns: { success: boolean; refunds_issued: number };
      };
      process_deposit: {
        Args: {
          p_user_id: string;
          p_amount: number;
          p_currency: string;
          p_provider_ref: string;
          p_provider?: string;
        };
        Returns: { deposit_id: string; net_amount: number };
      };
      process_withdrawal: {
        Args: {
          p_amount: number;
          p_destination: string;
          p_currency: string;
        };
        Returns: { withdrawal_id: string; fee: number; net_amount: number };
      };
      claim_deposit_bonus: {
        Args: Record<string, never>;
        Returns: { success: boolean; bonus_amount: number };
      };
      update_agent_level: {
        Args: { p_user_id: string };
        Returns: number;
      };
      reconcile_balances: {
        Args: Record<string, never>;
        Returns: { user_id: string; cached_balance: number; ledger_balance: number; difference: number }[];
      };
      toggle_user_freeze: {
        Args: { p_user_id: string; p_frozen: boolean };
        Returns: { success: boolean; frozen: boolean };
      };
      toggle_agent_activation_override: {
        Args: { p_user_id: string; p_override: boolean };
        Returns: string; // JSONB
      };
      dead_market_check: {
        Args: Record<string, never>;
        Returns: { voided_count: number };
      };
      get_agent_stats: {
        Args: Record<string, never>;
        Returns: string; // JSONB
      };
      get_agent_network_flat: {
        Args: Record<string, never>;
        Returns: string; // JSONB
      };
      get_agent_commission_feed: {
        Args: {
          p_limit?: number;
          p_offset?: number;
          p_layer_filter?: number | null;
        };
        Returns: string; // JSONB
      };
      transfer_agent_to_portfolio: {
        Args: { p_amount: number };
        Returns: string; // JSONB { agent_balance_usd, balance_usd }
      };
      reconcile_agent_balances: {
        Args: Record<string, never>;
        Returns: { user_id: string; cached_balance: number; ledger_balance: number; difference: number }[];
      };
      acknowledge_system_log: {
        Args: { p_log_id: string };
        Returns: undefined;
      };
      log_system_event: {
        Args: {
          p_severity: "info" | "warn" | "error" | "critical";
          p_source: string;
          p_message: string;
          p_context?: Record<string, unknown>;
        };
        Returns: undefined;
      };
      admin_adjust_balance: {
        Args: {
          p_user_id: string;
          p_amount: number;
          p_description: string;
          p_pin: string;
        };
        Returns: {
          transaction_id: string;
          new_balance: number;
          type: string;
        };
      };
      admin_set_pin: {
        Args: {
          p_pin: string;
        };
        Returns: { success: boolean };
      };
      admin_has_pin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      get_platform_stats: {
        Args: {
          p_start_date?: string;
          p_end_date?: string;
        };
        Returns: PlatformStats;
      };
      admin_update_fee: {
        Args: {
          p_fee_id: string;
          p_new_rate: number;
          p_pin: string;
        };
        Returns: {
          success: boolean;
          fee_type: string;
          old_rate: number;
          new_rate: number;
        };
      };
      admin_create_market: {
        Args: {
          p_question_en: string;
          p_question_ar: string;
          p_description_en?: string | null;
          p_description_ar?: string | null;
          p_category?: string;
          p_keywords?: string[];
          p_liquidity_param?: number | null;
          p_opens_at?: string;
          p_closes_at?: string;
          p_image_url?: string | null;
          p_opening_price?: number;
        };
        Returns: {
          market_id: string;
          opening_price: number;
          seed_q_yes: number;
          seed_q_no: number;
        };
      };
      admin_update_market: {
        Args: {
          p_market_id: string;
          p_description_en?: string | null;
          p_description_ar?: string | null;
          p_closes_at?: string | null;
          p_keywords?: string[] | null;
        };
        Returns: {
          success: boolean;
          market_id: string;
        };
      };
      get_stats_users: {
        Args: { p_start_date?: string; p_end_date?: string };
        Returns: StatsUsers;
      };
      get_stats_revenue: {
        Args: { p_start_date?: string; p_end_date?: string };
        Returns: StatsRevenue;
      };
      get_stats_trading: {
        Args: { p_start_date?: string; p_end_date?: string };
        Returns: StatsTrading;
      };
      get_stats_markets: {
        Args: { p_start_date?: string; p_end_date?: string };
        Returns: StatsMarkets;
      };
      get_stats_finance: {
        Args: { p_start_date?: string; p_end_date?: string };
        Returns: StatsFinance;
      };
      get_stats_health: {
        Args: { p_start_date?: string; p_end_date?: string };
        Returns: StatsHealth;
      };
      get_admin_sidebar_counts: {
        Args: Record<string, never>;
        Returns: AdminSidebarCounts;
      };
    };
  };
}

export interface AdminConfig {
  id: string;
  admin_user_id: string;
  pin_hash: string;
  failed_pin_attempts: number;
  pin_locked_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlatformStatsDailyRow {
  date: string;
  volume: number;
  trades: number;
  deposits: number;
  withdrawals: number;
  active_users: number;
}

export interface PlatformStatsTotals {
  total_deposits: number;
  total_withdrawals: number;
  total_volume: number;
  total_trades: number;
  unique_traders: number;
}

export interface PlatformStats {
  daily_volume: PlatformStatsDailyRow[];
  totals: PlatformStatsTotals;
  previous_period: PlatformStatsTotals;
}

// ── Comprehensive Stats Dashboard Types ──

export interface StatsUsers {
  totals: {
    total_users: number;
    new_users: number;
    active_traders: number;
    dau: number;
    wau: number;
    mau: number;
    retention_rate: number;
  };
  previous_period: { new_users: number; active_traders: number };
  daily: { date: string; new_users: number; active_users: number }[];
}

export interface StatsRevenue {
  totals: {
    gross_revenue: number;
    net_revenue: number;
    explicit_fees: number;
    amm_spread: number;
    resolution_fees: number;
    cash_out_premium: number;
    commissions_paid: number;
    escrowed_commissions: number;
    revenue_per_trade: number;
  };
  previous_period: { gross_revenue: number; net_revenue: number };
  daily: { date: string; explicit: number; spread: number; cash_out: number; total: number }[];
}

export interface StatsTrading {
  totals: {
    volume: number;
    trade_count: number;
    avg_trade_size: number;
    buy_count: number;
    sell_count: number;
    buy_volume: number;
    sell_volume: number;
    unique_traders: number;
    total_shares_outstanding: number;
    copy_trade_count: number;
  };
  previous_period: { volume: number; trade_count: number; unique_traders: number };
  daily: { date: string; volume: number; trades: number; buys: number; sells: number }[];
}

export interface StatsMarkets {
  totals: {
    total_markets: number;
    open: number;
    closed: number;
    resolved: number;
    voided: number;
    created_in_period: number;
    avg_trades_per_market: number;
    avg_traders_per_market: number;
  };
  previous_period: { created_in_period: number };
  top_markets: { market_id: string; question: string; volume: number; trades: number }[];
  categories: { category: string; count: number; volume: number }[];
}

export interface StatsFinance {
  totals: {
    total_deposits: number;
    total_withdrawals: number;
    net_flow: number;
    deposit_count: number;
    withdrawal_count: number;
    avg_deposit: number;
    avg_withdrawal: number;
    pending_deposits: number;
    pending_withdrawals: number;
    deposit_to_trade_pct: number;
  };
  previous_period: { total_deposits: number; total_withdrawals: number; net_flow: number };
  daily: { date: string; deposits: number; withdrawals: number; net_flow: number }[];
}

export interface StatsHealth {
  amm: { total_seed_pnl: number; markets_negative_pnl: number; total_liquidity: number };
  system: { error_count: number; critical_count: number };
  agents: {
    total_agents: number;
    new_agents: number;
    level_distribution: { L1: number; L2: number; L3: number; L4: number };
    commissions_credited: number;
    commissions_escrowed: number;
  };
  engagement: { comments_in_period: number; active_copy_trades: number };
}

/** Admin nav sidebar badge counts — returned by `get_admin_sidebar_counts()` (migration 257, updated by 301). */
export interface AdminSidebarCounts {
  pending_deposits: number;
  pending_withdrawals: number;
  /** Sum of pending_deposits + pending_withdrawals, precomputed for the Finance badge. */
  pending_finance: number;
}

// ── Accounting types ──────────────────────────────────────

export interface AccountingPnL {
  revenue: {
    explicit_fees: number;
    amm_spread: number;
    cash_out_premium: number;
    dynamic_spread: number;
    trade_revenue: number;
    resolution_fees: number;
    branch_fee_revenue: number;
    gross_revenue: number;
  };
  costs: {
    commissions_credited: number;
    commissions_escrowed: number;
    amm_losses: number;
    amm_gains: number;
    amm_net_pnl: number;
  };
  previous_period: {
    gross_revenue: number;
    commissions_credited: number;
    amm_losses: number;
  };
  daily: { date: string; revenue: number; commissions: number; amm_losses: number }[];
}

export interface AccountingAMM {
  aggregates: {
    total_seed_pnl: number;
    markets_in_profit: number;
    markets_in_loss: number;
    total_volume: number;
    total_trades: number;
    total_gains: number;
    total_losses: number;
  };
  markets: {
    market_id: string;
    question_en: string;
    outcome: string;
    resolved_at: string;
    seed_pnl: number;
    total_volume: number;
    total_trades: number;
    liquidity_param: number;
  }[];
}

export interface AccountingBranches {
  totals: {
    total_branch_revenue: number;
    total_markup_revenue: number;
    total_explicit_fee_revenue: number;
    total_exit_fee_revenue: number;
    total_resolution_fee_revenue: number;
    total_sooq_fee_revenue: number;
    total_agent_payouts: number;
  };
  branches: {
    branch_id: string;
    branch_name: string;
    branch_code: string;
    branch_status: string;
    branch_fee_rate: number;
    markup_revenue: number;
    explicit_fee_revenue: number;
    exit_fee_revenue: number;
    resolution_fee_revenue: number;
    sooq_fee_revenue: number;
    total_revenue: number;
    agent_payouts: number;
    net_to_platform: number;
    agent_count: number;
  }[];
}

export interface AccountingCommissions {
  by_status: { status: string; total: number; count: number }[];
  by_level: { level: number; total: number; count: number }[];
  by_revenue_type: { revenue_type: string; total: number; count: number }[];
  top_earners: {
    referrer_id: string;
    display_name: string;
    phone: string;
    agent_level: number;
    layer_1: number;
    layer_2: number;
    total: number;
  }[];
}

// ============================================================================
// SPEED MARKETS — Phase 6+7
// Short-dated binary options (BTC OVER/UNDER) at 5m / 15m / 1h / 24h durations.
// Pricing via Black-Scholes binary; settlement via TWAP from oracle ticks.
// Schema: supabase/migrations/306-329_speed_*.sql
// ============================================================================

export type SpeedAsset = "BTC";
export type SpeedDuration = "5m" | "15m" | "1h" | "24h";
export type SpeedMarketStatus =
  | "pending"
  | "open"
  | "resolving"
  | "resolved"
  | "voided"
  | "halted";
export type SpeedMarketOutcome = "over" | "under" | "at_strike";
export type SpeedPositionStatus =
  | "open"
  | "cashed_out"
  | "won"
  | "lost"
  | "refunded";
export type SpeedTradeKind = "open" | "cashout";
export type SpeedSide = "over" | "under";

export interface SpeedMarket {
  id: string;
  asset: SpeedAsset;
  duration: SpeedDuration;
  strike_price: string; // numeric — keep as string for precision
  opens_at: string;
  closes_at: string;
  status: SpeedMarketStatus;
  outcome: SpeedMarketOutcome | null;
  settlement_price: string | null;
  twap_window_start: string | null;
  twap_window_end: string | null;
  twap_tick_count: number | null;
  resolved_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface SpeedPosition {
  id: string;
  user_id: string;
  market_id: string;
  branch_id: string | null;
  side: SpeedSide;
  stake: string;
  entry_price: string;
  entry_fair_prob: string;
  entry_offered_prob: string;
  status: SpeedPositionStatus;
  payout_amount: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface SpeedTrade {
  id: string;
  position_id: string;
  user_id: string;
  market_id: string;
  branch_id: string | null;
  kind: SpeedTradeKind;
  amount: string;
  spot_price: string;
  fair_prob: string;
  offered_prob: string;
  handle_fee: string;
  cashout_multiplier: string | null;
  idempotency_key: string | null;
  created_at: string;
}

export interface SpeedOracleLatest {
  asset: SpeedAsset;
  source: string;
  price: string;
  ts: string;
  received_at: string;
}

export interface SpeedSettlement {
  position_id: string;
  market_id: string;
  user_id: string;
  branch_id: string | null;
  outcome: SpeedMarketOutcome;
  payout_amount: string;
  settled_at: string;
}

// Returned by speed_execute_trade RPC
export interface SpeedExecuteTradeResult {
  success: boolean;
  position_id: string;
  trade_id: string;
  side: SpeedSide;
  stake: number;
  entry_offered_prob: number;
  payout_per_dollar: number;
  potential_payout: number;
  market_id: string;
  closes_at: string;
  idempotent?: boolean;
}

// Returned by speed_execute_cashout RPC
export interface SpeedExecuteCashoutResult {
  success: boolean;
  trade_id: string;
  cashout_amount: number;
  fair_value: number;
  fair_profit: number;
  role: "winner" | "loser";
  bucket: "high" | "mid" | "low";
  multiplier: number;
  pct_time_left: number;
  idempotent?: boolean;
}
