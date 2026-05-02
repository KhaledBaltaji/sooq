export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_config: {
        Row: {
          admin_user_id: string | null
          created_at: string | null
          failed_pin_attempts: number | null
          hmac_secret: string | null
          id: string
          pin_hash: string
          pin_locked_until: string | null
          updated_at: string | null
        }
        Insert: {
          admin_user_id?: string | null
          created_at?: string | null
          failed_pin_attempts?: number | null
          hmac_secret?: string | null
          id?: string
          pin_hash: string
          pin_locked_until?: string | null
          updated_at?: string | null
        }
        Update: {
          admin_user_id?: string | null
          created_at?: string | null
          failed_pin_attempts?: number | null
          hmac_secret?: string | null
          id?: string
          pin_hash?: string
          pin_locked_until?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_config_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_pending_microcredits: {
        Row: {
          accrued_amount: number
          agent_id: string
          agent_user_id: string
          branch_id: string
          created_at: string
          id: string
          last_accrual_at: string
          last_sweep_at: string | null
          updated_at: string
        }
        Insert: {
          accrued_amount?: number
          agent_id: string
          agent_user_id: string
          branch_id: string
          created_at?: string
          id?: string
          last_accrual_at?: string
          last_sweep_at?: string | null
          updated_at?: string
        }
        Update: {
          accrued_amount?: number
          agent_id?: string
          agent_user_id?: string
          branch_id?: string
          created_at?: string
          id?: string
          last_accrual_at?: string
          last_sweep_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_pending_microcredits_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "branch_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_pending_microcredits_agent_user_id_fkey"
            columns: ["agent_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_pending_microcredits_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      amm_state: {
        Row: {
          created_at: string
          current_no_price: number
          current_yes_price: number
          id: string
          liquidity_param: number
          market_id: string
          q_no: number
          q_yes: number
          retail_net_cash: number
          retail_shares_no: number
          retail_shares_yes: number
          seed_pnl: number
          total_trades: number
          total_volume: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_no_price?: number
          current_yes_price?: number
          id?: string
          liquidity_param?: number
          market_id: string
          q_no?: number
          q_yes?: number
          retail_net_cash?: number
          retail_shares_no?: number
          retail_shares_yes?: number
          seed_pnl?: number
          total_trades?: number
          total_volume?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_no_price?: number
          current_yes_price?: number
          id?: string
          liquidity_param?: number
          market_id?: string
          q_no?: number
          q_yes?: number
          retail_net_cash?: number
          retail_shares_no?: number
          retail_shares_yes?: number
          seed_pnl?: number
          total_trades?: number
          total_volume?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "amm_state_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: true
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_admin_overrides: {
        Row: {
          admin_id: string
          branch_id: string
          created_at: string
          id: string
          new_value: Json | null
          note: string
          override_type: Database["public"]["Enums"]["branch_override_type"]
          previous_value: Json | null
        }
        Insert: {
          admin_id: string
          branch_id: string
          created_at?: string
          id?: string
          new_value?: Json | null
          note: string
          override_type: Database["public"]["Enums"]["branch_override_type"]
          previous_value?: Json | null
        }
        Update: {
          admin_id?: string
          branch_id?: string
          created_at?: string
          id?: string
          new_value?: Json | null
          note?: string
          override_type?: Database["public"]["Enums"]["branch_override_type"]
          previous_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "branch_admin_overrides_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_admin_overrides_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_agents: {
        Row: {
          agent_type: Database["public"]["Enums"]["branch_agent_type"] | null
          approved_at: string | null
          approved_by: string | null
          branch_id: string
          created_at: string
          cumulative_pl: number
          deposit_held: number
          deposit_required: number
          id: string
          is_active: boolean
          parent_agent_id: string | null
          rate: number | null
          referral_code: string | null
          rejection_reason: string | null
          status: Database["public"]["Enums"]["branch_agent_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_type?: Database["public"]["Enums"]["branch_agent_type"] | null
          approved_at?: string | null
          approved_by?: string | null
          branch_id: string
          created_at?: string
          cumulative_pl?: number
          deposit_held?: number
          deposit_required?: number
          id?: string
          is_active?: boolean
          parent_agent_id?: string | null
          rate?: number | null
          referral_code?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["branch_agent_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_type?: Database["public"]["Enums"]["branch_agent_type"] | null
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string
          created_at?: string
          cumulative_pl?: number
          deposit_held?: number
          deposit_required?: number
          id?: string
          is_active?: boolean
          parent_agent_id?: string | null
          rate?: number | null
          referral_code?: string | null
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["branch_agent_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_agents_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_agents_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_agents_parent_agent_id_fkey"
            columns: ["parent_agent_id"]
            isOneToOne: false
            referencedRelation: "branch_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_agents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_market_config: {
        Row: {
          branch_id: string
          cash_out_enabled: boolean | null
          created_at: string
          id: string
          is_enabled: boolean
          market_id: string
          position_cap_no: number | null
          position_cap_yes: number | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          cash_out_enabled?: boolean | null
          created_at?: string
          id?: string
          is_enabled?: boolean
          market_id: string
          position_cap_no?: number | null
          position_cap_yes?: number | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          cash_out_enabled?: boolean | null
          created_at?: string
          id?: string
          is_enabled?: boolean
          market_id?: string
          position_cap_no?: number | null
          position_cap_yes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_market_config_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_market_config_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_pools: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["branch_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id: string
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["branch_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["branch_pool_entry_type"]
        }
        Relationships: [
          {
            foreignKeyName: "branch_pools_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_pools_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_revenue: {
        Row: {
          branch_id: string
          created_at: string
          exit_fee_revenue: number
          explicit_fee_revenue: number
          id: string
          market_id: string
          markup_revenue: number
          resolution_fee_revenue: number
          sooq_fee_revenue: number
          total_revenue: number
        }
        Insert: {
          branch_id: string
          created_at?: string
          exit_fee_revenue?: number
          explicit_fee_revenue?: number
          id?: string
          market_id: string
          markup_revenue?: number
          resolution_fee_revenue?: number
          sooq_fee_revenue?: number
          total_revenue?: number
        }
        Update: {
          branch_id?: string
          created_at?: string
          exit_fee_revenue?: number
          explicit_fee_revenue?: number
          id?: string
          market_id?: string
          markup_revenue?: number
          resolution_fee_revenue?: number
          sooq_fee_revenue?: number
          total_revenue?: number
        }
        Relationships: [
          {
            foreignKeyName: "branch_revenue_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_revenue_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_trades: {
        Row: {
          agent_id: string | null
          branch_id: string
          branch_markup: number
          branch_quote_shown: number | null
          canonical_post_no_price: number
          canonical_post_yes_price: number
          canonical_pre_no_price: number
          canonical_pre_yes_price: number
          created_at: string
          direction: string
          exit_fee_amount: number | null
          gross_amount: number
          id: string
          idempotency_key: string
          market_id: string
          net_canonical_amount: number
          shares_issued: number
          side: Database["public"]["Enums"]["bet_side"]
          trade_id: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          branch_id: string
          branch_markup: number
          branch_quote_shown?: number | null
          canonical_post_no_price: number
          canonical_post_yes_price: number
          canonical_pre_no_price: number
          canonical_pre_yes_price: number
          created_at?: string
          direction: string
          exit_fee_amount?: number | null
          gross_amount: number
          id?: string
          idempotency_key: string
          market_id: string
          net_canonical_amount: number
          shares_issued: number
          side: Database["public"]["Enums"]["bet_side"]
          trade_id: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          branch_id?: string
          branch_markup?: number
          branch_quote_shown?: number | null
          canonical_post_no_price?: number
          canonical_post_yes_price?: number
          canonical_pre_no_price?: number
          canonical_pre_yes_price?: number
          created_at?: string
          direction?: string
          exit_fee_amount?: number | null
          gross_amount?: number
          id?: string
          idempotency_key?: string
          market_id?: string
          net_canonical_amount?: number
          shares_issued?: number
          side?: Database["public"]["Enums"]["bet_side"]
          trade_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_trades_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "branch_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_trades_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_trades_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_trades_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "retail_trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_trades_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_trades_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_user_assignments: {
        Row: {
          agent_id: string | null
          assigned_at: string
          branch_id: string
          id: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          assigned_at?: string
          branch_id: string
          id?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          assigned_at?: string
          branch_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_user_assignments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "branch_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_user_assignments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_user_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          book_type: Database["public"]["Enums"]["branch_book_type"]
          branch_code: string
          branch_fee_rate: number
          cash_out_enabled: boolean
          created_at: string
          default_position_cap_no: number | null
          default_position_cap_yes: number | null
          display_mode: Database["public"]["Enums"]["branch_display_mode"]
          exit_fee_pct: number
          frozen_at: string | null
          id: string
          manager_user_id: string
          name: string
          no_markup_pct: number
          payback_activated_at: string | null
          payback_reason: string | null
          pending_payouts: number
          pool_balance: number
          solvency_override_by: string | null
          solvency_override_pct: number | null
          solvency_override_until: string | null
          status: Database["public"]["Enums"]["branch_status"]
          suspension_reason: string | null
          updated_at: string
          webhook_secret: string | null
          webhook_url: string | null
          worst_case_total: number
          yes_markup_pct: number
        }
        Insert: {
          book_type?: Database["public"]["Enums"]["branch_book_type"]
          branch_code: string
          branch_fee_rate?: number
          cash_out_enabled?: boolean
          created_at?: string
          default_position_cap_no?: number | null
          default_position_cap_yes?: number | null
          display_mode?: Database["public"]["Enums"]["branch_display_mode"]
          exit_fee_pct?: number
          frozen_at?: string | null
          id?: string
          manager_user_id: string
          name: string
          no_markup_pct?: number
          payback_activated_at?: string | null
          payback_reason?: string | null
          pending_payouts?: number
          pool_balance?: number
          solvency_override_by?: string | null
          solvency_override_pct?: number | null
          solvency_override_until?: string | null
          status?: Database["public"]["Enums"]["branch_status"]
          suspension_reason?: string | null
          updated_at?: string
          webhook_secret?: string | null
          webhook_url?: string | null
          worst_case_total?: number
          yes_markup_pct?: number
        }
        Update: {
          book_type?: Database["public"]["Enums"]["branch_book_type"]
          branch_code?: string
          branch_fee_rate?: number
          cash_out_enabled?: boolean
          created_at?: string
          default_position_cap_no?: number | null
          default_position_cap_yes?: number | null
          display_mode?: Database["public"]["Enums"]["branch_display_mode"]
          exit_fee_pct?: number
          frozen_at?: string | null
          id?: string
          manager_user_id?: string
          name?: string
          no_markup_pct?: number
          payback_activated_at?: string | null
          payback_reason?: string | null
          pending_payouts?: number
          pool_balance?: number
          solvency_override_by?: string | null
          solvency_override_pct?: number | null
          solvency_override_until?: string | null
          status?: Database["public"]["Enums"]["branch_status"]
          suspension_reason?: string | null
          updated_at?: string
          webhook_secret?: string | null
          webhook_url?: string | null
          worst_case_total?: number
          yes_markup_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "branches_manager_user_id_fkey"
            columns: ["manager_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branches_solvency_override_by_fkey"
            columns: ["solvency_override_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_likes: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_likes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "market_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_clawback_deficit: {
        Row: {
          actual_clawback: number | null
          branch_id: string | null
          commission_id: string | null
          created_at: string
          deficit: number
          expected_clawback: number | null
          id: string
          market_id: string | null
          reason: string
          referrer_id: string | null
        }
        Insert: {
          actual_clawback?: number | null
          branch_id?: string | null
          commission_id?: string | null
          created_at?: string
          deficit: number
          expected_clawback?: number | null
          id?: string
          market_id?: string | null
          reason?: string
          referrer_id?: string | null
        }
        Update: {
          actual_clawback?: number | null
          branch_id?: string | null
          commission_id?: string | null
          created_at?: string
          deficit?: number
          expected_clawback?: number | null
          id?: string
          market_id?: string | null
          reason?: string
          referrer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_clawback_deficit_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_clawback_deficit_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: false
            referencedRelation: "referral_commissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_clawback_deficit_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_clawback_deficit_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      copy_settings: {
        Row: {
          amount_per_trade: number
          copier_id: string
          created_at: string
          id: string
          is_active: boolean
          leader_id: string
          max_per_market: number
          max_total: number
          updated_at: string
        }
        Insert: {
          amount_per_trade: number
          copier_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          leader_id: string
          max_per_market?: number
          max_total?: number
          updated_at?: string
        }
        Update: {
          amount_per_trade?: number
          copier_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          leader_id?: string
          max_per_market?: number
          max_total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "copy_settings_copier_id_fkey"
            columns: ["copier_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copy_settings_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_chain_ledger: {
        Row: {
          amount: number
          branch_id: string
          created_at: string
          description: string | null
          id: string
          issuer_id: string
          issuer_role: Database["public"]["Enums"]["credit_chain_role"]
          recipient_id: string
          recipient_role: Database["public"]["Enums"]["credit_chain_role"]
        }
        Insert: {
          amount: number
          branch_id: string
          created_at?: string
          description?: string | null
          id?: string
          issuer_id: string
          issuer_role: Database["public"]["Enums"]["credit_chain_role"]
          recipient_id: string
          recipient_role: Database["public"]["Enums"]["credit_chain_role"]
        }
        Update: {
          amount?: number
          branch_id?: string
          created_at?: string
          description?: string | null
          id?: string
          issuer_id?: string
          issuer_role?: Database["public"]["Enums"]["credit_chain_role"]
          recipient_id?: string
          recipient_role?: Database["public"]["Enums"]["credit_chain_role"]
        }
        Relationships: [
          {
            foreignKeyName: "credit_chain_ledger_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_chain_ledger_issuer_id_fkey"
            columns: ["issuer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_chain_ledger_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_amm_state: {
        Row: {
          created_at: string
          current_no_price: number
          current_yes_price: number
          id: string
          liquidity_param: number
          market_id: string
          q_no: number
          q_yes: number
          total_trades: number
          total_volume: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_no_price?: number
          current_yes_price?: number
          id?: string
          liquidity_param?: number
          market_id: string
          q_no?: number
          q_yes?: number
          total_trades?: number
          total_volume?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_no_price?: number
          current_yes_price?: number
          id?: string
          liquidity_param?: number
          market_id?: string
          q_no?: number
          q_yes?: number
          total_trades?: number
          total_volume?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_amm_state_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: true
            referencedRelation: "demo_markets"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_market_scheduled_outcomes: {
        Row: {
          created_at: string
          created_by: string
          market_id: string
          scheduled_outcome: Database["public"]["Enums"]["bet_side"]
        }
        Insert: {
          created_at?: string
          created_by: string
          market_id: string
          scheduled_outcome: Database["public"]["Enums"]["bet_side"]
        }
        Update: {
          created_at?: string
          created_by?: string
          market_id?: string
          scheduled_outcome?: Database["public"]["Enums"]["bet_side"]
        }
        Relationships: [
          {
            foreignKeyName: "demo_market_scheduled_outcomes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_market_scheduled_outcomes_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: true
            referencedRelation: "demo_markets"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_markets: {
        Row: {
          amm_liquidity_param: number
          category: string
          closes_at: string
          created_at: string
          created_by: string
          description_ar: string | null
          description_en: string | null
          homepage_rank: number | null
          id: string
          image_url: string | null
          keywords: string[]
          opens_at: string
          outcome: Database["public"]["Enums"]["bet_side"] | null
          question_ar: string
          question_en: string
          resolution_fee_rate_snapshot: number
          resolved_at: string | null
          resolves_at: string
          short_code: string
          status: Database["public"]["Enums"]["market_status"]
          trade_count: number
          unique_traders: number
          updated_at: string
        }
        Insert: {
          amm_liquidity_param?: number
          category?: string
          closes_at: string
          created_at?: string
          created_by: string
          description_ar?: string | null
          description_en?: string | null
          homepage_rank?: number | null
          id?: string
          image_url?: string | null
          keywords?: string[]
          opens_at?: string
          outcome?: Database["public"]["Enums"]["bet_side"] | null
          question_ar: string
          question_en: string
          resolution_fee_rate_snapshot?: number
          resolved_at?: string | null
          resolves_at: string
          short_code?: string
          status?: Database["public"]["Enums"]["market_status"]
          trade_count?: number
          unique_traders?: number
          updated_at?: string
        }
        Update: {
          amm_liquidity_param?: number
          category?: string
          closes_at?: string
          created_at?: string
          created_by?: string
          description_ar?: string | null
          description_en?: string | null
          homepage_rank?: number | null
          id?: string
          image_url?: string | null
          keywords?: string[]
          opens_at?: string
          outcome?: Database["public"]["Enums"]["bet_side"] | null
          question_ar?: string
          question_en?: string
          resolution_fee_rate_snapshot?: number
          resolved_at?: string | null
          resolves_at?: string
          short_code?: string
          status?: Database["public"]["Enums"]["market_status"]
          trade_count?: number
          unique_traders?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_markets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_positions: {
        Row: {
          avg_entry_price: number
          created_at: string
          id: string
          market_id: string
          realized_pnl: number
          shares_held: number
          side: Database["public"]["Enums"]["bet_side"]
          total_invested: number
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_entry_price?: number
          created_at?: string
          id?: string
          market_id: string
          realized_pnl?: number
          shares_held?: number
          side: Database["public"]["Enums"]["bet_side"]
          total_invested?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_entry_price?: number
          created_at?: string
          id?: string
          market_id?: string
          realized_pnl?: number
          shares_held?: number
          side?: Database["public"]["Enums"]["bet_side"]
          total_invested?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_positions_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "demo_markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_positions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_trades: {
        Row: {
          created_at: string
          direction: Database["public"]["Enums"]["trade_direction"]
          id: string
          market_id: string
          post_no_price: number | null
          post_yes_price: number | null
          price_per_share: number
          shares: number
          side: Database["public"]["Enums"]["bet_side"]
          total_cost: number
          user_id: string
        }
        Insert: {
          created_at?: string
          direction: Database["public"]["Enums"]["trade_direction"]
          id?: string
          market_id: string
          post_no_price?: number | null
          post_yes_price?: number | null
          price_per_share: number
          shares: number
          side: Database["public"]["Enums"]["bet_side"]
          total_cost: number
          user_id: string
        }
        Update: {
          created_at?: string
          direction?: Database["public"]["Enums"]["trade_direction"]
          id?: string
          market_id?: string
          post_no_price?: number | null
          post_yes_price?: number | null
          price_per_share?: number
          shares?: number
          side?: Database["public"]["Enums"]["bet_side"]
          total_cost?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_trades_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "demo_markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_trades_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          reference_id: string | null
          type: Database["public"]["Enums"]["demo_transaction_type"]
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          id?: string
          reference_id?: string | null
          type: Database["public"]["Enums"]["demo_transaction_type"]
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          reference_id?: string | null
          type?: Database["public"]["Enums"]["demo_transaction_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "demo_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      deposits: {
        Row: {
          amount: number
          confirmed_at: string | null
          created_at: string
          currency: string
          fee: number
          id: string
          net_amount: number
          proof_image_url: string | null
          provider: string
          provider_ref: string | null
          status: string
          user_id: string
          whish_number: string | null
        }
        Insert: {
          amount: number
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          fee?: number
          id?: string
          net_amount: number
          proof_image_url?: string | null
          provider?: string
          provider_ref?: string | null
          status?: string
          user_id: string
          whish_number?: string | null
        }
        Update: {
          amount?: number
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          fee?: number
          id?: string
          net_amount?: number
          proof_image_url?: string | null
          provider?: string
          provider_ref?: string | null
          status?: string
          user_id?: string
          whish_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deposits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_config: {
        Row: {
          depth: number | null
          description: string | null
          fee_type: string
          id: string
          level: number | null
          rate: number
          updated_at: string
        }
        Insert: {
          depth?: number | null
          description?: string | null
          fee_type: string
          id?: string
          level?: number | null
          rate: number
          updated_at?: string
        }
        Update: {
          depth?: number | null
          description?: string | null
          fee_type?: string
          id?: string
          level?: number | null
          rate?: number
          updated_at?: string
        }
        Relationships: []
      }
      help_articles: {
        Row: {
          collection_id: string
          content: string
          created_at: string
          id: string
          is_published: boolean
          slug: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          collection_id: string
          content?: string
          created_at?: string
          id?: string
          is_published?: boolean
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          collection_id?: string
          content?: string
          created_at?: string
          id?: string
          is_published?: boolean
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "help_articles_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "help_collections"
            referencedColumns: ["id"]
          },
        ]
      }
      help_collections: {
        Row: {
          created_at: string
          description: string | null
          icon: string
          id: string
          is_published: boolean
          locale: string
          slug: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon?: string
          id?: string
          is_published?: boolean
          locale?: string
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          icon?: string
          id?: string
          is_published?: boolean
          locale?: string
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      leader_stats: {
        Row: {
          accuracy_pct: number
          copier_count: number
          created_at: string
          id: string
          total_pnl: number
          total_trades: number
          updated_at: string
          user_id: string
          winning_trades: number
        }
        Insert: {
          accuracy_pct?: number
          copier_count?: number
          created_at?: string
          id?: string
          total_pnl?: number
          total_trades?: number
          updated_at?: string
          user_id: string
          winning_trades?: number
        }
        Update: {
          accuracy_pct?: number
          copier_count?: number
          created_at?: string
          id?: string
          total_pnl?: number
          total_trades?: number
          updated_at?: string
          user_id?: string
          winning_trades?: number
        }
        Relationships: [
          {
            foreignKeyName: "leader_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      market_comments: {
        Row: {
          body: string
          created_at: string
          id: string
          like_count: number
          market_id: string
          parent_id: string | null
          side: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          like_count?: number
          market_id: string
          parent_id?: string | null
          side?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          like_count?: number
          market_id?: string
          parent_id?: string | null
          side?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_comments_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "market_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      markets: {
        Row: {
          amm_liquidity_param: number | null
          branch_settled_at: string | null
          branch_settlement_result: Json | null
          category: string
          closes_at: string
          created_at: string
          created_by: string
          description_ar: string | null
          description_en: string | null
          homepage_rank: number | null
          id: string
          image_url: string | null
          keywords: string[] | null
          opening_price: number
          opens_at: string
          outcome: Database["public"]["Enums"]["bet_side"] | null
          question_ar: string
          question_en: string
          resolution_fee_rate_snapshot: number | null
          resolved_at: string | null
          short_code: string
          status: Database["public"]["Enums"]["market_status"]
          trade_count: number
          unique_traders: number
          updated_at: string
        }
        Insert: {
          amm_liquidity_param?: number | null
          branch_settled_at?: string | null
          branch_settlement_result?: Json | null
          category?: string
          closes_at: string
          created_at?: string
          created_by: string
          description_ar?: string | null
          description_en?: string | null
          homepage_rank?: number | null
          id?: string
          image_url?: string | null
          keywords?: string[] | null
          opening_price?: number
          opens_at: string
          outcome?: Database["public"]["Enums"]["bet_side"] | null
          question_ar: string
          question_en: string
          resolution_fee_rate_snapshot?: number | null
          resolved_at?: string | null
          short_code?: string
          status?: Database["public"]["Enums"]["market_status"]
          trade_count?: number
          unique_traders?: number
          updated_at?: string
        }
        Update: {
          amm_liquidity_param?: number | null
          branch_settled_at?: string | null
          branch_settlement_result?: Json | null
          category?: string
          closes_at?: string
          created_at?: string
          created_by?: string
          description_ar?: string | null
          description_en?: string | null
          homepage_rank?: number | null
          id?: string
          image_url?: string | null
          keywords?: string[] | null
          opening_price?: number
          opens_at?: string
          outcome?: Database["public"]["Enums"]["bet_side"] | null
          question_ar?: string
          question_en?: string
          resolution_fee_rate_snapshot?: number | null
          resolved_at?: string | null
          short_code?: string
          status?: Database["public"]["Enums"]["market_status"]
          trade_count?: number
          unique_traders?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "markets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body_ar: string | null
          body_en: string | null
          created_at: string
          id: string
          is_read: boolean
          reference_id: string | null
          title_ar: string
          title_en: string
          type: string
          user_id: string
        }
        Insert: {
          body_ar?: string | null
          body_en?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          reference_id?: string | null
          title_ar: string
          title_en: string
          type: string
          user_id: string
        }
        Update: {
          body_ar?: string | null
          body_en?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          reference_id?: string | null
          title_ar?: string
          title_en?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_verifications: {
        Row: {
          attempts: number
          code: string
          created_at: string
          expires_at: string
          id: string
          ip: string | null
          message_id: string | null
          phone: string
          verified: boolean
        }
        Insert: {
          attempts?: number
          code: string
          created_at?: string
          expires_at: string
          id?: string
          ip?: string | null
          message_id?: string | null
          phone: string
          verified?: boolean
        }
        Update: {
          attempts?: number
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          ip?: string | null
          message_id?: string | null
          phone?: string
          verified?: boolean
        }
        Relationships: []
      }
      platform_revenue: {
        Row: {
          amm_spread_revenue: number
          branch_id: string | null
          cash_out_premium_revenue: number
          created_at: string
          dynamic_spread_revenue: number
          explicit_fee_revenue: number
          id: string
          market_id: string
          net_revenue: number
          platform_fee: number
          resolution_fee_revenue: number
          seed_amount: number
          total_commissions: number
          total_pot: number
        }
        Insert: {
          amm_spread_revenue?: number
          branch_id?: string | null
          cash_out_premium_revenue?: number
          created_at?: string
          dynamic_spread_revenue?: number
          explicit_fee_revenue?: number
          id?: string
          market_id: string
          net_revenue: number
          platform_fee: number
          resolution_fee_revenue?: number
          seed_amount: number
          total_commissions?: number
          total_pot: number
        }
        Update: {
          amm_spread_revenue?: number
          branch_id?: string | null
          cash_out_premium_revenue?: number
          created_at?: string
          dynamic_spread_revenue?: number
          explicit_fee_revenue?: number
          id?: string
          market_id?: string
          net_revenue?: number
          platform_fee?: number
          resolution_fee_revenue?: number
          seed_amount?: number
          total_commissions?: number
          total_pot?: number
        }
        Relationships: [
          {
            foreignKeyName: "platform_revenue_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_revenue_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: true
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          avg_entry_price: number
          branch_id: string | null
          created_at: string
          id: string
          market_id: string
          realized_pnl: number
          shares_held: number
          side: Database["public"]["Enums"]["bet_side"]
          total_invested: number
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_entry_price?: number
          branch_id?: string | null
          created_at?: string
          id?: string
          market_id: string
          realized_pnl?: number
          shares_held?: number
          side: Database["public"]["Enums"]["bet_side"]
          total_invested?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_entry_price?: number
          branch_id?: string | null
          created_at?: string
          id?: string
          market_id?: string
          realized_pnl?: number
          shares_held?: number
          side?: Database["public"]["Enums"]["bet_side"]
          total_invested?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "positions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      prelaunch_questions: {
        Row: {
          active: boolean
          category: string
          created_at: string
          description_ar: string | null
          description_en: string | null
          expires_at: string | null
          id: string
          no_count: number
          slug: string
          sort_order: number
          title_ar: string
          title_en: string
          yes_count: number
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          expires_at?: string | null
          id?: string
          no_count?: number
          slug: string
          sort_order?: number
          title_ar: string
          title_en: string
          yes_count?: number
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          expires_at?: string | null
          id?: string
          no_count?: number
          slug?: string
          sort_order?: number
          title_ar?: string
          title_en?: string
          yes_count?: number
        }
        Relationships: []
      }
      prelaunch_votes: {
        Row: {
          created_at: string
          id: string
          ip_hash: string | null
          question_id: string
          visitor_id: string
          vote: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          question_id: string
          visitor_id: string
          vote: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          question_id?: string
          visitor_id?: string
          vote?: string
        }
        Relationships: [
          {
            foreignKeyName: "prelaunch_votes_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "prelaunch_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      prelaunch_waitlist: {
        Row: {
          created_at: string
          email: string | null
          id: string
          phone: string | null
          position: number
          referral_code: string
          referral_count: number
          referred_by: string | null
          votes_json: Json | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          phone?: string | null
          position?: number
          referral_code?: string
          referral_count?: number
          referred_by?: string | null
          votes_json?: Json | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          phone?: string | null
          position?: number
          referral_code?: string
          referral_count?: number
          referred_by?: string | null
          votes_json?: Json | null
        }
        Relationships: []
      }
      price_alerts: {
        Row: {
          created_at: string
          direction: Database["public"]["Enums"]["alert_direction"]
          id: string
          is_active: boolean
          is_triggered: boolean
          market_id: string
          side: Database["public"]["Enums"]["bet_side"]
          target_price: number
          triggered_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          direction: Database["public"]["Enums"]["alert_direction"]
          id?: string
          is_active?: boolean
          is_triggered?: boolean
          market_id: string
          side: Database["public"]["Enums"]["bet_side"]
          target_price: number
          triggered_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          direction?: Database["public"]["Enums"]["alert_direction"]
          id?: string
          is_active?: boolean
          is_triggered?: boolean
          market_id?: string
          side?: Database["public"]["Enums"]["bet_side"]
          target_price?: number
          triggered_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_alerts_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_commissions: {
        Row: {
          agent_level_at_time: number
          branch_id: string | null
          commission_amount: number
          commission_rate: number
          created_at: string
          id: string
          layer: number
          market_id: string | null
          platform_revenue_amount: number
          referrer_id: string
          revenue_type: string
          source_type: Database["public"]["Enums"]["commission_source_type"]
          status: Database["public"]["Enums"]["commission_status"]
          trade_id: string | null
          trader_id: string
          unlock_at: string | null
        }
        Insert: {
          agent_level_at_time: number
          branch_id?: string | null
          commission_amount: number
          commission_rate: number
          created_at?: string
          id?: string
          layer: number
          market_id?: string | null
          platform_revenue_amount?: number
          referrer_id: string
          revenue_type?: string
          source_type?: Database["public"]["Enums"]["commission_source_type"]
          status?: Database["public"]["Enums"]["commission_status"]
          trade_id?: string | null
          trader_id: string
          unlock_at?: string | null
        }
        Update: {
          agent_level_at_time?: number
          branch_id?: string | null
          commission_amount?: number
          commission_rate?: number
          created_at?: string
          id?: string
          layer?: number
          market_id?: string | null
          platform_revenue_amount?: number
          referrer_id?: string
          revenue_type?: string
          source_type?: Database["public"]["Enums"]["commission_source_type"]
          status?: Database["public"]["Enums"]["commission_status"]
          trade_id?: string | null
          trader_id?: string
          unlock_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_commissions_bettor_id_fkey"
            columns: ["trader_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_commissions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_commissions_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_commissions_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_commissions_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "retail_trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_commissions_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      speed_branches: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          branch_id: string
          created_at: string
          fee_share_pct: number
          freeze_hard_pct: number
          freeze_warn_pct: number
          speed_pool_balance: number
          speed_status: Database["public"]["Enums"]["speed_branch_status"]
          stake_caps_per_side: Json
          stake_max: number
          stake_min: number
          suspension_reason: string | null
          unfreeze_pct: number
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          branch_id: string
          created_at?: string
          fee_share_pct: number
          freeze_hard_pct: number
          freeze_warn_pct: number
          speed_pool_balance?: number
          speed_status?: Database["public"]["Enums"]["speed_branch_status"]
          stake_caps_per_side: Json
          stake_max: number
          stake_min: number
          suspension_reason?: string | null
          unfreeze_pct: number
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          branch_id?: string
          created_at?: string
          fee_share_pct?: number
          freeze_hard_pct?: number
          freeze_warn_pct?: number
          speed_pool_balance?: number
          speed_status?: Database["public"]["Enums"]["speed_branch_status"]
          stake_caps_per_side?: Json
          stake_max?: number
          stake_min?: number
          suspension_reason?: string | null
          unfreeze_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "speed_branches_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speed_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      speed_exposure_live: {
        Row: {
          asset: Database["public"]["Enums"]["speed_asset"]
          branch_id: string
          last_updated_at: string
          net_notional: number
          open_over_notional: number
          open_position_count: number
          open_under_notional: number
          utilization_pct: number
        }
        Insert: {
          asset: Database["public"]["Enums"]["speed_asset"]
          branch_id: string
          last_updated_at?: string
          net_notional?: number
          open_over_notional?: number
          open_position_count?: number
          open_under_notional?: number
          utilization_pct?: number
        }
        Update: {
          asset?: Database["public"]["Enums"]["speed_asset"]
          branch_id?: string
          last_updated_at?: string
          net_notional?: number
          open_over_notional?: number
          open_position_count?: number
          open_under_notional?: number
          utilization_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "speed_exposure_live_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      speed_external_book_snapshots: {
        Row: {
          asset: Database["public"]["Enums"]["speed_asset"]
          avg_entry_price: number | null
          created_at: string
          funding_paid_since_last: number | null
          id: string
          margin_balance_usd: number | null
          mark_price: number | null
          net_position_qty: number
          notes: string | null
          realized_pnl_since_last: number | null
          recorded_by: string
          snapshot_at: string
          unrealized_pnl_usd: number | null
          venue: string
        }
        Insert: {
          asset: Database["public"]["Enums"]["speed_asset"]
          avg_entry_price?: number | null
          created_at?: string
          funding_paid_since_last?: number | null
          id?: string
          margin_balance_usd?: number | null
          mark_price?: number | null
          net_position_qty?: number
          notes?: string | null
          realized_pnl_since_last?: number | null
          recorded_by: string
          snapshot_at: string
          unrealized_pnl_usd?: number | null
          venue?: string
        }
        Update: {
          asset?: Database["public"]["Enums"]["speed_asset"]
          avg_entry_price?: number | null
          created_at?: string
          funding_paid_since_last?: number | null
          id?: string
          margin_balance_usd?: number | null
          mark_price?: number | null
          net_position_qty?: number
          notes?: string | null
          realized_pnl_since_last?: number | null
          recorded_by?: string
          snapshot_at?: string
          unrealized_pnl_usd?: number | null
          venue?: string
        }
        Relationships: [
          {
            foreignKeyName: "speed_external_book_snapshots_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      speed_main_pool_state: {
        Row: {
          id: number
          speed_pool_balance: number
          updated_at: string
        }
        Insert: {
          id?: number
          speed_pool_balance?: number
          updated_at?: string
        }
        Update: {
          id?: number
          speed_pool_balance?: number
          updated_at?: string
        }
        Relationships: []
      }
      speed_market_exposure_live: {
        Row: {
          asset: Database["public"]["Enums"]["speed_asset"]
          branch_breakdown: Json
          last_updated_at: string
          market_id: string
          net_notional: number
          net_qty: number
          open_position_count: number
        }
        Insert: {
          asset: Database["public"]["Enums"]["speed_asset"]
          branch_breakdown?: Json
          last_updated_at?: string
          market_id: string
          net_notional?: number
          net_qty?: number
          open_position_count?: number
        }
        Update: {
          asset?: Database["public"]["Enums"]["speed_asset"]
          branch_breakdown?: Json
          last_updated_at?: string
          market_id?: string
          net_notional?: number
          net_qty?: number
          open_position_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "speed_market_exposure_live_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: true
            referencedRelation: "speed_markets"
            referencedColumns: ["id"]
          },
        ]
      }
      speed_markets: {
        Row: {
          asset: Database["public"]["Enums"]["speed_asset"]
          closes_at: string
          created_at: string
          duration: Database["public"]["Enums"]["speed_duration"]
          id: string
          opens_at: string
          outcome: Database["public"]["Enums"]["speed_market_outcome"] | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["speed_market_status"]
          strike_price: number
          twap_settlement_price: number | null
          twap_tick_count: number | null
          twap_window_end: string | null
          twap_window_start: string | null
          updated_at: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          asset: Database["public"]["Enums"]["speed_asset"]
          closes_at: string
          created_at?: string
          duration: Database["public"]["Enums"]["speed_duration"]
          id?: string
          opens_at: string
          outcome?: Database["public"]["Enums"]["speed_market_outcome"] | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["speed_market_status"]
          strike_price: number
          twap_settlement_price?: number | null
          twap_tick_count?: number | null
          twap_window_end?: string | null
          twap_window_start?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          asset?: Database["public"]["Enums"]["speed_asset"]
          closes_at?: string
          created_at?: string
          duration?: Database["public"]["Enums"]["speed_duration"]
          id?: string
          opens_at?: string
          outcome?: Database["public"]["Enums"]["speed_market_outcome"] | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["speed_market_status"]
          strike_price?: number
          twap_settlement_price?: number | null
          twap_tick_count?: number | null
          twap_window_end?: string | null
          twap_window_start?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: []
      }
      speed_oracle_klines: {
        Row: {
          asset: Database["public"]["Enums"]["speed_asset"]
          close_price: number
          high_price: number
          id: string
          low_price: number
          open_price: number
          received_at: string
          source: string
          ts: string
          volume: number
        }
        Insert: {
          asset: Database["public"]["Enums"]["speed_asset"]
          close_price: number
          high_price: number
          id?: string
          low_price: number
          open_price: number
          received_at?: string
          source?: string
          ts: string
          volume?: number
        }
        Update: {
          asset?: Database["public"]["Enums"]["speed_asset"]
          close_price?: number
          high_price?: number
          id?: string
          low_price?: number
          open_price?: number
          received_at?: string
          source?: string
          ts?: string
          volume?: number
        }
        Relationships: []
      }
      speed_oracle_latest: {
        Row: {
          asset: Database["public"]["Enums"]["speed_asset"]
          price: number
          received_at: string
          source: string
          ts: string
        }
        Insert: {
          asset: Database["public"]["Enums"]["speed_asset"]
          price: number
          received_at: string
          source?: string
          ts: string
        }
        Update: {
          asset?: Database["public"]["Enums"]["speed_asset"]
          price?: number
          received_at?: string
          source?: string
          ts?: string
        }
        Relationships: []
      }
      speed_oracle_ticks: {
        Row: {
          asset: Database["public"]["Enums"]["speed_asset"]
          id: string
          price: number
          received_at: string
          source: string
          ts: string
        }
        Insert: {
          asset: Database["public"]["Enums"]["speed_asset"]
          id?: string
          price: number
          received_at?: string
          source?: string
          ts: string
        }
        Update: {
          asset?: Database["public"]["Enums"]["speed_asset"]
          id?: string
          price?: number
          received_at?: string
          source?: string
          ts?: string
        }
        Relationships: []
      }
      speed_pool_ledger: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: [
          {
            foreignKeyName: "speed_pool_ledger_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speed_pool_ledger_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "speed_markets"
            referencedColumns: ["id"]
          },
        ]
      }
      speed_pool_ledger_20260427: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: []
      }
      speed_pool_ledger_20260428: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: []
      }
      speed_pool_ledger_20260429: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: []
      }
      speed_pool_ledger_20260430: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: []
      }
      speed_pool_ledger_20260501: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: []
      }
      speed_pool_ledger_20260502: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: []
      }
      speed_pool_ledger_20260503: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: []
      }
      speed_pool_ledger_20260504: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: []
      }
      speed_pool_ledger_20260505: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: []
      }
      speed_pool_ledger_20260506: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: []
      }
      speed_pool_ledger_20260507: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: []
      }
      speed_pool_ledger_20260508: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: []
      }
      speed_pool_ledger_20260509: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: []
      }
      speed_pool_ledger_20260510: {
        Row: {
          amount: number
          balance_after: number
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          market_id: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Insert: {
          amount: number
          balance_after: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Update: {
          amount?: number
          balance_after?: number
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          market_id?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["speed_pool_entry_type"]
        }
        Relationships: []
      }
      speed_positions: {
        Row: {
          branch_id: string | null
          closed_at: string | null
          created_at: string
          entry_fair_prob: number
          entry_offered_prob: number
          entry_price: number
          id: string
          market_id: string
          payout_amount: number | null
          side: string
          stake: number
          status: Database["public"]["Enums"]["speed_position_status"]
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          closed_at?: string | null
          created_at?: string
          entry_fair_prob: number
          entry_offered_prob: number
          entry_price: number
          id?: string
          market_id: string
          payout_amount?: number | null
          side: string
          stake: number
          status?: Database["public"]["Enums"]["speed_position_status"]
          user_id: string
        }
        Update: {
          branch_id?: string | null
          closed_at?: string | null
          created_at?: string
          entry_fair_prob?: number
          entry_offered_prob?: number
          entry_price?: number
          id?: string
          market_id?: string
          payout_amount?: number | null
          side?: string
          stake?: number
          status?: Database["public"]["Enums"]["speed_position_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "speed_positions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speed_positions_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "speed_markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speed_positions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      speed_settlements: {
        Row: {
          branch_id: string | null
          market_id: string
          outcome: Database["public"]["Enums"]["speed_market_outcome"]
          payout_amount: number
          position_id: string
          settled_at: string
          user_id: string
        }
        Insert: {
          branch_id?: string | null
          market_id: string
          outcome: Database["public"]["Enums"]["speed_market_outcome"]
          payout_amount: number
          position_id: string
          settled_at?: string
          user_id: string
        }
        Update: {
          branch_id?: string | null
          market_id?: string
          outcome?: Database["public"]["Enums"]["speed_market_outcome"]
          payout_amount?: number
          position_id?: string
          settled_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "speed_settlements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speed_settlements_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "speed_markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speed_settlements_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: true
            referencedRelation: "speed_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speed_settlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      speed_trades: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "speed_trades_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speed_trades_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "speed_markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speed_trades_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "speed_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "speed_trades_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      speed_trades_20260427: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: []
      }
      speed_trades_20260428: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: []
      }
      speed_trades_20260429: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: []
      }
      speed_trades_20260430: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: []
      }
      speed_trades_20260501: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: []
      }
      speed_trades_20260502: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: []
      }
      speed_trades_20260503: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: []
      }
      speed_trades_20260504: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: []
      }
      speed_trades_20260505: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: []
      }
      speed_trades_20260506: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: []
      }
      speed_trades_20260507: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: []
      }
      speed_trades_20260508: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: []
      }
      speed_trades_20260509: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: []
      }
      speed_trades_20260510: {
        Row: {
          amount: number
          branch_id: string | null
          cashout_multiplier: number | null
          created_at: string
          fair_prob: number
          handle_fee: number
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Insert: {
          amount: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["speed_trade_kind"]
          market_id: string
          offered_prob: number
          position_id: string
          spot_price: number
          user_id: string
        }
        Update: {
          amount?: number
          branch_id?: string | null
          cashout_multiplier?: number | null
          created_at?: string
          fair_prob?: number
          handle_fee?: number
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["speed_trade_kind"]
          market_id?: string
          offered_prob?: number
          position_id?: string
          spot_price?: number
          user_id?: string
        }
        Relationships: []
      }
      system_logs: {
        Row: {
          acknowledged: boolean
          acknowledged_at: string | null
          acknowledged_by: string | null
          context: Json | null
          created_at: string
          id: string
          message: string
          severity: Database["public"]["Enums"]["log_severity"]
          source: string
        }
        Insert: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          context?: Json | null
          created_at?: string
          id?: string
          message: string
          severity?: Database["public"]["Enums"]["log_severity"]
          source: string
        }
        Update: {
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          context?: Json | null
          created_at?: string
          id?: string
          message?: string
          severity?: Database["public"]["Enums"]["log_severity"]
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_logs_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          amm_spread_cost: number
          branch_id: string | null
          cash_out_premium: number
          copied_from_user: string | null
          created_at: string
          direction: Database["public"]["Enums"]["trade_direction"]
          dynamic_spread: number
          explicit_fee: number
          id: string
          is_copy_trade: boolean
          market_id: string
          post_no_price: number | null
          post_yes_price: number | null
          price_per_share: number
          shares: number
          side: Database["public"]["Enums"]["bet_side"]
          total_cost: number
          user_id: string
        }
        Insert: {
          amm_spread_cost?: number
          branch_id?: string | null
          cash_out_premium?: number
          copied_from_user?: string | null
          created_at?: string
          direction: Database["public"]["Enums"]["trade_direction"]
          dynamic_spread?: number
          explicit_fee?: number
          id?: string
          is_copy_trade?: boolean
          market_id: string
          post_no_price?: number | null
          post_yes_price?: number | null
          price_per_share: number
          shares: number
          side: Database["public"]["Enums"]["bet_side"]
          total_cost: number
          user_id: string
        }
        Update: {
          amm_spread_cost?: number
          branch_id?: string | null
          cash_out_premium?: number
          copied_from_user?: string | null
          created_at?: string
          direction?: Database["public"]["Enums"]["trade_direction"]
          dynamic_spread?: number
          explicit_fee?: number
          id?: string
          is_copy_trade?: boolean
          market_id?: string
          post_no_price?: number | null
          post_yes_price?: number | null
          price_per_share?: number
          shares?: number
          side?: Database["public"]["Enums"]["bet_side"]
          total_cost?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_copied_from_user_fkey"
            columns: ["copied_from_user"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          performed_by: string | null
          reference_id: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          user_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          id?: string
          performed_by?: string | null
          reference_id?: string | null
          type: Database["public"]["Enums"]["transaction_type"]
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          performed_by?: string | null
          reference_id?: string | null
          type?: Database["public"]["Enums"]["transaction_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_wallets: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          provider: string
          provider_user_id: string | null
          updated_at: string
          user_id: string
          wallet_address_erc20: string | null
          wallet_address_trc20: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          provider?: string
          provider_user_id?: string | null
          updated_at?: string
          user_id: string
          wallet_address_erc20?: string | null
          wallet_address_trc20?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          provider?: string
          provider_user_id?: string | null
          updated_at?: string
          user_id?: string
          wallet_address_erc20?: string | null
          wallet_address_trc20?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          admin_allowed_views: string[] | null
          agent_activated: boolean
          agent_activation_override: boolean
          agent_balance_usd: number
          agent_level: number
          avatar_url: string | null
          balance_usd: number
          bio: string | null
          created_at: string
          demo_balance_usd: number
          demo_first_enabled_at: string | null
          demo_first_trade_at: string | null
          demo_mode: boolean
          deposit_bonus_claimed: boolean
          direct_referral_count: number
          display_name: string | null
          email: string | null
          first_real_deposit_after_demo_at: string | null
          id: string
          is_admin: boolean
          is_frozen: boolean
          locale: string
          network_volume: number
          phone: string | null
          qualified_referral_count: number
          referral_chain: string[] | null
          referral_code: string
          referred_by: string | null
          signup_branch_id: string | null
          total_wagered: number
          updated_at: string
          wagering_requirement: number
        }
        Insert: {
          admin_allowed_views?: string[] | null
          agent_activated?: boolean
          agent_activation_override?: boolean
          agent_balance_usd?: number
          agent_level?: number
          avatar_url?: string | null
          balance_usd?: number
          bio?: string | null
          created_at?: string
          demo_balance_usd?: number
          demo_first_enabled_at?: string | null
          demo_first_trade_at?: string | null
          demo_mode?: boolean
          deposit_bonus_claimed?: boolean
          direct_referral_count?: number
          display_name?: string | null
          email?: string | null
          first_real_deposit_after_demo_at?: string | null
          id: string
          is_admin?: boolean
          is_frozen?: boolean
          locale?: string
          network_volume?: number
          phone?: string | null
          qualified_referral_count?: number
          referral_chain?: string[] | null
          referral_code?: string
          referred_by?: string | null
          signup_branch_id?: string | null
          total_wagered?: number
          updated_at?: string
          wagering_requirement?: number
        }
        Update: {
          admin_allowed_views?: string[] | null
          agent_activated?: boolean
          agent_activation_override?: boolean
          agent_balance_usd?: number
          agent_level?: number
          avatar_url?: string | null
          balance_usd?: number
          bio?: string | null
          created_at?: string
          demo_balance_usd?: number
          demo_first_enabled_at?: string | null
          demo_first_trade_at?: string | null
          demo_mode?: boolean
          deposit_bonus_claimed?: boolean
          direct_referral_count?: number
          display_name?: string | null
          email?: string | null
          first_real_deposit_after_demo_at?: string | null
          id?: string
          is_admin?: boolean
          is_frozen?: boolean
          locale?: string
          network_volume?: number
          phone?: string | null
          qualified_referral_count?: number
          referral_chain?: string[] | null
          referral_code?: string
          referred_by?: string | null
          signup_branch_id?: string | null
          total_wagered?: number
          updated_at?: string
          wagering_requirement?: number
        }
        Relationships: [
          {
            foreignKeyName: "users_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_signup_branch_id_fkey"
            columns: ["signup_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawals: {
        Row: {
          admin_notes: string | null
          amount: number
          created_at: string
          currency: string
          destination: string
          destination_type: string | null
          external_reference_id: string | null
          fee: number
          id: string
          net_amount: number
          network: string | null
          processed_at: string | null
          provider: string | null
          sent_at: string | null
          sent_by: string | null
          status: Database["public"]["Enums"]["withdrawal_status"]
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          amount: number
          created_at?: string
          currency?: string
          destination: string
          destination_type?: string | null
          external_reference_id?: string | null
          fee?: number
          id?: string
          net_amount: number
          network?: string | null
          processed_at?: string | null
          provider?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          amount?: number
          created_at?: string
          currency?: string
          destination?: string
          destination_type?: string | null
          external_reference_id?: string | null
          fee?: number
          id?: string
          net_amount?: number
          network?: string | null
          processed_at?: string | null
          provider?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      branch_pending_liabilities: {
        Row: {
          agent_user_id: string | null
          branch_id: string | null
          next_unlock_at: string | null
          pending_amount: number | null
          pending_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_commissions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_commissions_referrer_id_fkey"
            columns: ["agent_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      retail_positions: {
        Row: {
          avg_entry_price: number | null
          branch_id: string | null
          created_at: string | null
          id: string | null
          market_id: string | null
          realized_pnl: number | null
          shares_held: number | null
          side: Database["public"]["Enums"]["bet_side"] | null
          total_invested: number | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          avg_entry_price?: number | null
          branch_id?: string | null
          created_at?: string | null
          id?: string | null
          market_id?: string | null
          realized_pnl?: number | null
          shares_held?: number | null
          side?: Database["public"]["Enums"]["bet_side"] | null
          total_invested?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          avg_entry_price?: number | null
          branch_id?: string | null
          created_at?: string | null
          id?: string | null
          market_id?: string | null
          realized_pnl?: number | null
          shares_held?: number | null
          side?: Database["public"]["Enums"]["bet_side"] | null
          total_invested?: number | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "positions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      retail_trades: {
        Row: {
          amm_spread_cost: number | null
          branch_id: string | null
          cash_out_premium: number | null
          copied_from_user: string | null
          created_at: string | null
          direction: Database["public"]["Enums"]["trade_direction"] | null
          dynamic_spread: number | null
          explicit_fee: number | null
          id: string | null
          is_copy_trade: boolean | null
          market_id: string | null
          post_no_price: number | null
          post_yes_price: number | null
          price_per_share: number | null
          shares: number | null
          side: Database["public"]["Enums"]["bet_side"] | null
          total_cost: number | null
          user_id: string | null
        }
        Insert: {
          amm_spread_cost?: number | null
          branch_id?: string | null
          cash_out_premium?: number | null
          copied_from_user?: string | null
          created_at?: string | null
          direction?: Database["public"]["Enums"]["trade_direction"] | null
          dynamic_spread?: number | null
          explicit_fee?: number | null
          id?: string | null
          is_copy_trade?: boolean | null
          market_id?: string | null
          post_no_price?: number | null
          post_yes_price?: number | null
          price_per_share?: number | null
          shares?: number | null
          side?: Database["public"]["Enums"]["bet_side"] | null
          total_cost?: number | null
          user_id?: string | null
        }
        Update: {
          amm_spread_cost?: number | null
          branch_id?: string | null
          cash_out_premium?: number | null
          copied_from_user?: string | null
          created_at?: string | null
          direction?: Database["public"]["Enums"]["trade_direction"] | null
          dynamic_spread?: number | null
          explicit_fee?: number | null
          id?: string | null
          is_copy_trade?: boolean | null
          market_id?: string | null
          post_no_price?: number | null
          post_yes_price?: number | null
          price_per_share?: number | null
          shares?: number | null
          side?: Database["public"]["Enums"]["bet_side"] | null
          total_cost?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trades_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_copied_from_user_fkey"
            columns: ["copied_from_user"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _accrue_microcredit: {
        Args: {
          p_agent_id: string
          p_agent_user_id: string
          p_amount: number
          p_branch_id: string
        }
        Returns: undefined
      }
      _branch_worst_case_market: {
        Args: { p_branch_id: string; p_market_id: string }
        Returns: number
      }
      _credit_branch_commission: {
        Args: {
          p_agent_rate: number
          p_agent_user_id: string
          p_amount: number
          p_branch_id: string
          p_market_id: string
          p_markup_amount: number
          p_trade_id: string
          p_trader_id: string
        }
        Returns: number
      }
      _credit_branch_pl: {
        Args: {
          p_agent_id: string
          p_agent_rate: number
          p_agent_user_id: string
          p_amount: number
          p_branch_id: string
          p_market_id: string
          p_pool_contribution: number
        }
        Returns: number
      }
      _credit_commission: {
        Args: {
          p_agent_level: number
          p_ancestor_id: string
          p_fee_type: string
          p_layer: number
          p_market_id: string
          p_platform_revenue: number
          p_revenue_type: string
          p_trade_id: string
          p_trader_id: string
        }
        Returns: number
      }
      _credit_speed_commission: {
        Args: {
          p_agent_level: number
          p_ancestor_id: string
          p_layer: number
          p_market_id: string
          p_platform_revenue: number
          p_trade_id: string
          p_trader_id: string
        }
        Returns: number
      }
      _demo_assert_admin: { Args: never; Returns: string }
      _is_agent_activated: { Args: { p_user_id: string }; Returns: boolean }
      _next_clean_boundary: {
        Args: {
          p_duration: Database["public"]["Enums"]["speed_duration"]
          p_now: string
        }
        Returns: string
      }
      _recompute_branch_worst_case: {
        Args: { p_branch_id: string }
        Returns: number
      }
      _release_escrowed_commissions: {
        Args: { p_user_id: string }
        Returns: number
      }
      _release_pending_commissions_for_market: {
        Args: { p_market_id: string }
        Returns: number
      }
      _reserved_slugs: { Args: never; Returns: string[] }
      _set_trigger_bypass_wrapper: { Args: never; Returns: undefined }
      _speed_create_pool_partitions: {
        Args: { p_target_date: string }
        Returns: undefined
      }
      _speed_create_trade_partitions: {
        Args: { p_target_date: string }
        Returns: undefined
      }
      _try_clear_payback: { Args: { p_branch_id: string }; Returns: undefined }
      _verify_admin_pin: {
        Args: { p_admin_id: string; p_pin: string }
        Returns: undefined
      }
      _verify_admin_token: {
        Args: {
          p_admin_id: string
          p_expected_operation: string
          p_token: string
        }
        Returns: undefined
      }
      _void_market_internal: { Args: { p_market_id: string }; Returns: Json }
      acknowledge_system_log: { Args: { p_log_id: string }; Returns: undefined }
      activate_payback_mode: {
        Args: { p_branch_id: string; p_reason: string; p_shortfall?: number }
        Returns: Json
      }
      admin_adjust_agent_balance: {
        Args: {
          p_amount: number
          p_description: string
          p_pin: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_adjust_balance: {
        Args: {
          p_amount: number
          p_description: string
          p_pin: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_adjust_branch_pool: {
        Args: {
          p_amount: number
          p_branch_id: string
          p_description: string
          p_pin: string
        }
        Returns: Json
      }
      admin_create_branch: {
        Args: {
          p_book_type?: string
          p_code: string
          p_config?: Json
          p_manager_user_id: string
          p_name: string
          p_pin?: string
        }
        Returns: Json
      }
      admin_create_demo_market: {
        Args: {
          p_category?: string
          p_closes_at?: string
          p_description_ar?: string
          p_description_en?: string
          p_image_url?: string
          p_keywords?: string[]
          p_liquidity_param?: number
          p_opens_at?: string
          p_question_ar: string
          p_question_en: string
          p_resolves_at?: string
          p_scheduled_outcome?: string
        }
        Returns: Json
      }
      admin_create_market: {
        Args: {
          p_category?: string
          p_closes_at?: string
          p_description_ar?: string
          p_description_en?: string
          p_image_url?: string
          p_keywords?: string[]
          p_liquidity_param?: number
          p_opening_price?: number
          p_opens_at?: string
          p_question_ar: string
          p_question_en: string
        }
        Returns: Json
      }
      admin_has_pin: { Args: never; Returns: boolean }
      admin_list_branches: { Args: never; Returns: Json }
      admin_list_demo_markets_with_outcomes: {
        Args: never
        Returns: {
          amm_liquidity_param: number
          category: string
          closes_at: string
          created_at: string
          market_id: string
          opens_at: string
          outcome: Database["public"]["Enums"]["bet_side"]
          question_ar: string
          question_en: string
          resolved_at: string
          resolves_at: string
          scheduled_outcome: Database["public"]["Enums"]["bet_side"]
          status: Database["public"]["Enums"]["market_status"]
          trade_count: number
          unique_traders: number
        }[]
      }
      admin_mark_withdrawal_sent: {
        Args: {
          p_external_reference_id: string
          p_pin: string
          p_withdrawal_id: string
        }
        Returns: Json
      }
      admin_override_solvency: {
        Args: {
          p_branch_id: string
          p_duration_hours: number
          p_new_pct: number
          p_note: string
          p_pin: string
        }
        Returns: Json
      }
      admin_override_withdrawal: {
        Args: {
          p_amount: number
          p_branch_id: string
          p_destination: string
          p_note: string
          p_pin: string
        }
        Returns: Json
      }
      admin_resolve_demo_market: {
        Args: { p_market_id: string }
        Returns: Json
      }
      admin_review_deposit:
        | { Args: { p_action: string; p_deposit_id: string }; Returns: Json }
        | {
            Args: { p_action: string; p_amount?: number; p_deposit_id: string }
            Returns: Json
          }
        | {
            Args: {
              p_action: string
              p_amount?: number
              p_deposit_id: string
              p_pin?: string
            }
            Returns: Json
          }
      admin_review_withdrawal: {
        Args: { p_action: string; p_pin: string; p_withdrawal_id: string }
        Returns: Json
      }
      admin_rotate_hmac_secret: {
        Args: { p_admin_id: string }
        Returns: string
      }
      admin_set_admin_role: {
        Args: {
          p_allowed_views?: string[]
          p_is_admin: boolean
          p_user_id: string
        }
        Returns: Json
      }
      admin_set_pin: { Args: { p_pin: string }; Returns: Json }
      admin_update_branch_status: {
        Args: {
          p_branch_id: string
          p_new_status: string
          p_pin: string
          p_reason: string
        }
        Returns: Json
      }
      admin_update_fee: {
        Args: {
          p_fee_id: string
          p_new_rate: number
          p_pin?: string
          p_token?: string
        }
        Returns: Json
      }
      admin_update_market:
        | {
            Args: {
              p_closes_at?: string
              p_description_ar?: string
              p_description_en?: string
              p_keywords?: string[]
              p_market_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_closes_at?: string
              p_description_ar?: string
              p_description_en?: string
              p_image_url?: string
              p_keywords?: string[]
              p_market_id: string
            }
            Returns: Json
          }
      apply_branch_agent: { Args: { p_branch_id: string }; Returns: Json }
      approve_branch_agent: {
        Args: {
          p_agent_id: string
          p_agent_type: string
          p_deposit_required?: number
          p_rate: number
        }
        Returns: Json
      }
      branch_credit_transfer: {
        Args: {
          p_amount: number
          p_branch_id: string
          p_description?: string
          p_recipient_id: string
        }
        Returns: Json
      }
      branch_dashboard_stats: { Args: { p_branch_id: string }; Returns: Json }
      branch_settle_resolution: {
        Args: {
          p_market_id: string
          p_outcome: Database["public"]["Enums"]["bet_side"]
        }
        Returns: Json
      }
      branch_solvency_check: {
        Args: {
          p_additional_pool_inflow?: number
          p_additional_worst_case_delta?: number
          p_branch_id: string
        }
        Returns: Json
      }
      branch_withdrawal: {
        Args: {
          p_amount: number
          p_branch_id: string
          p_destination: string
          p_note?: string
        }
        Returns: Json
      }
      cancel_withdrawal: {
        Args: { p_user_id: string; p_withdrawal_id: string }
        Returns: Json
      }
      check_branch_velocity: {
        Args: never
        Returns: {
          branch_id: string
          branch_name: string
          daily_average: number
          today_volume: number
          velocity_ratio: number
        }[]
      }
      check_payback_escalation: {
        Args: never
        Returns: {
          branch_id: string
          new_status: string
          old_status: string
        }[]
      }
      claim_deposit_bonus: { Args: never; Returns: Json }
      cleanup_test_data: { Args: never; Returns: string }
      clear_payback_mode: { Args: { p_branch_id: string }; Returns: undefined }
      dead_market_check: { Args: never; Returns: Json }
      demo_execute_trade: {
        Args: {
          p_amount?: number
          p_market_id: string
          p_shares_to_sell?: number
          p_side: string
        }
        Returns: Json
      }
      demo_get_price_history: {
        Args: { p_created_at?: string; p_market_id: string; p_period?: string }
        Returns: {
          bucket_time: string
          no_price: number
          yes_price: number
        }[]
      }
      demo_reset_balance: { Args: never; Returns: Json }
      demo_seed_initial_price: {
        Args: { p_market_id: string }
        Returns: undefined
      }
      execute_branch_trade: {
        Args: {
          p_amount?: number
          p_branch_id: string
          p_idempotency_key?: string
          p_market_id: string
          p_shares_to_sell?: number
          p_side: string
        }
        Returns: Json
      }
      execute_trade: {
        Args: {
          p_amount?: number
          p_market_id: string
          p_shares_to_sell?: number
          p_side: string
        }
        Returns: Json
      }
      get_accounting_amm: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_accounting_branches: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_accounting_commissions: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_accounting_pnl: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_admin_sidebar_counts: { Args: never; Returns: Json }
      get_agent_commission_feed: {
        Args: { p_layer_filter?: number; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      get_agent_network_flat: { Args: never; Returns: Json }
      get_agent_network_tree: { Args: never; Returns: Json }
      get_agent_stats: { Args: never; Returns: Json }
      get_agent_wallet_summary: { Args: never; Returns: Json }
      get_amm_price: { Args: { p_market_id: string }; Returns: Json }
      get_amm_risk_snapshot: {
        Args: never
        Returns: {
          cash_in: number
          imbalance: number
          is_red_flag: boolean
          liquidity_param: number
          market_id: string
          market_name: string
          market_status: Database["public"]["Enums"]["market_status"]
          net_exposure: number
          q_no: number
          q_yes: number
          section: string
          theoretical_max_loss: number
          worst_case_payout: number
        }[]
      }
      get_branch_owner_summary: { Args: { p_branch_id: string }; Returns: Json }
      get_cash_out_value: {
        Args: { p_market_id: string; p_shares: number; p_side: string }
        Returns: Json
      }
      get_demo_conversion_stats: { Args: never; Returns: Json }
      get_platform_stats: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_price_history: {
        Args: { p_created_at?: string; p_market_id: string; p_period?: string }
        Returns: {
          bucket_time: string
          no_price: number
          yes_price: number
        }[]
      }
      get_speed_accounting_summary: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_speed_klines: {
        Args: {
          p_asset: Database["public"]["Enums"]["speed_asset"]
          p_from: string
          p_max_buckets?: number
          p_to: string
        }
        Returns: {
          bucket_time: string
          c: number
          h: number
          l: number
          o: number
        }[]
      }
      get_speed_price_history: {
        Args: {
          p_asset: Database["public"]["Enums"]["speed_asset"]
          p_from: string
          p_max_points?: number
          p_to: string
        }
        Returns: {
          price: number
          ts: string
        }[]
      }
      get_speed_price_history_ohlc: {
        Args: {
          p_asset: Database["public"]["Enums"]["speed_asset"]
          p_from: string
          p_max_buckets?: number
          p_to: string
        }
        Returns: {
          bucket_time: string
          c: number
          h: number
          l: number
          o: number
        }[]
      }
      get_speed_stats_summary: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_stats_finance: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_stats_health: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_stats_markets: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_stats_revenue: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_stats_trading: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      get_stats_users: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: Json
      }
      increment_referral_count: {
        Args: { p_referral_code: string }
        Returns: undefined
      }
      initialize_amm: {
        Args: { p_liquidity_param?: number; p_market_id: string }
        Returns: Json
      }
      initialize_demo_amm: {
        Args: { p_liquidity_param?: number; p_market_id: string }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      is_branch_manager_of: { Args: { p_branch_id: string }; Returns: boolean }
      lmsr_cost: {
        Args: { p_b: number; p_q_no: number; p_q_yes: number }
        Returns: number
      }
      lmsr_price: {
        Args: { p_b: number; p_q_no: number; p_q_yes: number; p_side: string }
        Returns: number
      }
      lmsr_shares_for_cost: {
        Args: {
          p_b: number
          p_cost: number
          p_q_no: number
          p_q_yes: number
          p_side: string
        }
        Returns: number
      }
      lock_market: {
        Args: { p_market_id: string; p_pin?: string; p_token?: string }
        Returns: Json
      }
      log_system_event: {
        Args: {
          p_context?: Json
          p_message: string
          p_severity: Database["public"]["Enums"]["log_severity"]
          p_source: string
        }
        Returns: undefined
      }
      normal_cdf: { Args: { x: number }; Returns: number }
      pay_speed_trade_commissions: {
        Args: {
          p_market_id: string
          p_stake: number
          p_trade_id: string
          p_user_id: string
        }
        Returns: number
      }
      pay_trade_commissions: {
        Args: { p_trade_amount: number; p_trade_id: string; p_user_id: string }
        Returns: number
      }
      preview_branch_agent_pl: {
        Args: { p_branch_id: string; p_rate: number }
        Returns: Json
      }
      process_deposit: {
        Args: {
          p_amount: number
          p_currency: string
          p_provider?: string
          p_provider_ref: string
          p_user_id: string
        }
        Returns: Json
      }
      process_withdrawal: {
        Args: {
          p_amount: number
          p_currency: string
          p_destination: string
          p_destination_type: string
          p_network?: string
        }
        Returns: Json
      }
      reconcile_agent_balances: {
        Args: never
        Returns: {
          cached_balance: number
          difference: number
          ledger_balance: number
          user_id: string
        }[]
      }
      reconcile_balances: {
        Args: never
        Returns: {
          cached_balance: number
          difference: number
          ledger_balance: number
          user_id: string
        }[]
      }
      reconcile_branch_solvency: {
        Args: never
        Returns: {
          branch_id: string
          branch_name: string
          cached_pool_balance: number
          cached_worst_case: number
          computed_worst_case: number
          difference: number
          ledger_pool_balance: number
          pool_difference: number
        }[]
      }
      record_branch_revenue: {
        Args: {
          p_branch_id: string
          p_market_id: string
          p_outcome: Database["public"]["Enums"]["bet_side"]
          p_resolution_fee_collected?: number
        }
        Returns: undefined
      }
      record_prelaunch_vote: {
        Args: { p_question_id: string; p_visitor_id: string; p_vote: string }
        Returns: {
          no_count: number
          user_vote: string
          yes_count: number
        }[]
      }
      record_revenue: { Args: { p_market_id: string }; Returns: undefined }
      reject_branch_agent: {
        Args: { p_agent_id: string; p_reason?: string }
        Returns: Json
      }
      resolve_market: {
        Args: {
          p_market_id: string
          p_outcome: Database["public"]["Enums"]["bet_side"]
          p_pin?: string
        }
        Returns: Json
      }
      settle_resolution_commissions: {
        Args: { p_market_id: string }
        Returns: number
      }
      speed_admin_collateral_credit: {
        Args: {
          p_amount: number
          p_branch_id: string
          p_notes: string
          p_pin: string
        }
        Returns: Json
      }
      speed_admin_collateral_withdraw: {
        Args: {
          p_amount: number
          p_branch_id: string
          p_notes: string
          p_pin: string
        }
        Returns: Json
      }
      speed_admin_enable_branch: {
        Args: {
          p_branch_id: string
          p_collateral: number
          p_fee_share_pct: number
          p_freeze_hard_pct: number
          p_freeze_warn_pct: number
          p_pin: string
          p_stake_caps_per_side: Json
          p_stake_max: number
          p_stake_min: number
          p_unfreeze_pct: number
        }
        Returns: Json
      }
      speed_admin_freeze_branch: {
        Args: { p_branch_id: string; p_pin: string; p_reason: string }
        Returns: Json
      }
      speed_admin_master_kill_hard: { Args: { p_pin: string }; Returns: Json }
      speed_admin_master_kill_soft: { Args: { p_pin: string }; Returns: Json }
      speed_admin_master_revive: { Args: { p_pin: string }; Returns: Json }
      speed_admin_overview: { Args: never; Returns: Json }
      speed_admin_record_book_snapshot: {
        Args: {
          p_asset: Database["public"]["Enums"]["speed_asset"]
          p_avg_entry_price: number
          p_funding_paid_since_last: number
          p_margin_balance_usd: number
          p_mark_price: number
          p_net_position_qty: number
          p_notes: string
          p_pin: string
          p_realized_pnl_since_last: number
          p_snapshot_at: string
          p_unrealized_pnl_usd: number
        }
        Returns: Json
      }
      speed_admin_suspend_branch: {
        Args: { p_branch_id: string; p_pin: string; p_reason: string }
        Returns: Json
      }
      speed_admin_unfreeze_branch: {
        Args: { p_branch_id: string; p_pin: string }
        Returns: Json
      }
      speed_branch_summary: { Args: { p_branch_id: string }; Returns: Json }
      speed_execute_cashout: {
        Args: { p_idempotency_key?: string; p_position_id: string }
        Returns: Json
      }
      speed_execute_trade: {
        Args: {
          p_idempotency_key?: string
          p_market_id: string
          p_side: string
          p_stake: number
        }
        Returns: Json
      }
      speed_extend_partitions: { Args: never; Returns: Json }
      speed_fair_prob_over: {
        Args: {
          p_iv: number
          p_seconds_left: number
          p_spot: number
          p_strike: number
        }
        Returns: number
      }
      speed_market_exposure: { Args: { p_market_id: string }; Returns: Json }
      speed_resolve_expired_markets: { Args: never; Returns: Json }
      speed_resolve_market: { Args: { p_market_id: string }; Returns: Json }
      speed_roll_markets: { Args: never; Returns: Json }
      speed_time_bucket: {
        Args: { p_seconds_left: number; p_seconds_total: number }
        Returns: string
      }
      staging_full_reset: { Args: never; Returns: string }
      submit_manual_deposit: {
        Args: {
          p_amount: number
          p_proof_image_url?: string
          p_whish_number?: string
        }
        Returns: Json
      }
      sweep_agent_microcredits: { Args: never; Returns: Json }
      toggle_agent_activation_override: {
        Args: { p_override: boolean; p_user_id: string }
        Returns: Json
      }
      toggle_demo_mode: { Args: { p_enabled: boolean }; Returns: Json }
      toggle_user_freeze: {
        Args: { p_frozen: boolean; p_user_id: string }
        Returns: Json
      }
      transfer_agent_to_portfolio: { Args: { p_amount: number }; Returns: Json }
      update_agent_level: { Args: { p_user_id: string }; Returns: number }
      update_branch_agent_deal: {
        Args: {
          p_agent_id: string
          p_agent_type: string
          p_deposit_required?: number
          p_rate: number
        }
        Returns: Json
      }
      update_branch_config: {
        Args: {
          p_branch_id: string
          p_cash_out_enabled?: boolean
          p_display_mode?: string
          p_exit_fee?: number
          p_no_markup?: number
          p_yes_markup?: number
        }
        Returns: undefined
      }
      update_homepage_ranks: { Args: never; Returns: number }
      void_market: {
        Args: { p_market_id: string; p_pin?: string; p_token?: string }
        Returns: Json
      }
    }
    Enums: {
      agent_level: "1" | "2" | "3" | "4"
      alert_direction: "above" | "below"
      bet_side: "yes" | "no"
      branch_agent_status: "pending" | "approved" | "rejected" | "suspended"
      branch_agent_type: "pl" | "commission"
      branch_book_type: "reseller" | "bookmaker" | "commission"
      branch_display_mode: "trading" | "betting"
      branch_override_type:
        | "solvency_gate_loosened"
        | "withdrawal_lock_bypassed"
        | "status_change"
        | "pool_adjustment"
        | "config_change"
      branch_pool_entry_type:
        | "credit"
        | "trade_buy"
        | "trade_sell"
        | "exit_fee"
        | "resolution_payout"
        | "resolution_fee"
        | "void_refund"
        | "withdrawal"
        | "withdrawal_fee"
        | "payback_sweep"
        | "adjustment"
        | "sooq_branch_fee"
        | "agent_commission"
        | "agent_pl_payout"
        | "owner_payout"
      branch_status: "active" | "payback" | "frozen" | "suspended"
      commission_source_type:
        | "referral_trade"
        | "referral_resolution"
        | "branch_commission"
        | "branch_pl"
        | "referral_speed"
      commission_status: "escrowed" | "credited" | "voided" | "pending"
      credit_chain_role:
        | "admin"
        | "branch_manager"
        | "agent"
        | "sub_agent"
        | "user"
      demo_transaction_type:
        | "demo_bet"
        | "demo_win"
        | "demo_reset"
        | "demo_seed"
      log_severity: "info" | "warn" | "error" | "critical"
      market_status: "draft" | "open" | "closed" | "resolved" | "voided"
      speed_asset: "BTC"
      speed_branch_status:
        | "inactive"
        | "active"
        | "warning"
        | "frozen"
        | "suspended"
      speed_duration: "5m" | "15m" | "1h" | "24h"
      speed_market_outcome: "over" | "under" | "at_strike"
      speed_market_status:
        | "pending"
        | "open"
        | "resolving"
        | "resolved"
        | "voided"
        | "halted"
      speed_pool_entry_type:
        | "collateral_credit"
        | "collateral_withdraw"
        | "fee_withdrawal_self"
        | "admin_withdrawal_discretionary"
        | "stake_in"
        | "cashout_out"
        | "winning_payout"
        | "refund"
        | "fee_share_in"
      speed_position_status: "open" | "cashed_out" | "won" | "lost" | "refunded"
      speed_trade_kind: "open" | "cashout"
      trade_direction: "buy" | "sell"
      transaction_type:
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
        | "commission_release"
        | "admin_credit"
        | "admin_debit"
        | "branch_credit_out"
        | "branch_credit_in"
        | "branch_owner_payout"
        | "speed_stake"
        | "speed_winning"
        | "speed_cashout"
        | "speed_refund"
      withdrawal_status:
        | "pending"
        | "approved"
        | "rejected"
        | "sent"
        | "completed"
        | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      agent_level: ["1", "2", "3", "4"],
      alert_direction: ["above", "below"],
      bet_side: ["yes", "no"],
      branch_agent_status: ["pending", "approved", "rejected", "suspended"],
      branch_agent_type: ["pl", "commission"],
      branch_book_type: ["reseller", "bookmaker", "commission"],
      branch_display_mode: ["trading", "betting"],
      branch_override_type: [
        "solvency_gate_loosened",
        "withdrawal_lock_bypassed",
        "status_change",
        "pool_adjustment",
        "config_change",
      ],
      branch_pool_entry_type: [
        "credit",
        "trade_buy",
        "trade_sell",
        "exit_fee",
        "resolution_payout",
        "resolution_fee",
        "void_refund",
        "withdrawal",
        "withdrawal_fee",
        "payback_sweep",
        "adjustment",
        "sooq_branch_fee",
        "agent_commission",
        "agent_pl_payout",
        "owner_payout",
      ],
      branch_status: ["active", "payback", "frozen", "suspended"],
      commission_source_type: [
        "referral_trade",
        "referral_resolution",
        "branch_commission",
        "branch_pl",
        "referral_speed",
      ],
      commission_status: ["escrowed", "credited", "voided", "pending"],
      credit_chain_role: [
        "admin",
        "branch_manager",
        "agent",
        "sub_agent",
        "user",
      ],
      demo_transaction_type: [
        "demo_bet",
        "demo_win",
        "demo_reset",
        "demo_seed",
      ],
      log_severity: ["info", "warn", "error", "critical"],
      market_status: ["draft", "open", "closed", "resolved", "voided"],
      speed_asset: ["BTC"],
      speed_branch_status: [
        "inactive",
        "active",
        "warning",
        "frozen",
        "suspended",
      ],
      speed_duration: ["5m", "15m", "1h", "24h"],
      speed_market_outcome: ["over", "under", "at_strike"],
      speed_market_status: [
        "pending",
        "open",
        "resolving",
        "resolved",
        "voided",
        "halted",
      ],
      speed_pool_entry_type: [
        "collateral_credit",
        "collateral_withdraw",
        "fee_withdrawal_self",
        "admin_withdrawal_discretionary",
        "stake_in",
        "cashout_out",
        "winning_payout",
        "refund",
        "fee_share_in",
      ],
      speed_position_status: ["open", "cashed_out", "won", "lost", "refunded"],
      speed_trade_kind: ["open", "cashout"],
      trade_direction: ["buy", "sell"],
      transaction_type: [
        "bet",
        "win",
        "deposit",
        "withdrawal",
        "commission",
        "bonus",
        "refund",
        "seed",
        "trade",
        "close_position",
        "resolution_payout",
        "resolution_fee",
        "agent_transfer_out",
        "agent_transfer_in",
        "commission_release",
        "admin_credit",
        "admin_debit",
        "branch_credit_out",
        "branch_credit_in",
        "branch_owner_payout",
        "speed_stake",
        "speed_winning",
        "speed_cashout",
        "speed_refund",
      ],
      withdrawal_status: [
        "pending",
        "approved",
        "rejected",
        "sent",
        "completed",
        "failed",
      ],
    },
  },
} as const
