-- 145_agent_wallet_enum.sql — Add agent transfer transaction types to enum

ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'agent_transfer_out';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'agent_transfer_in';
