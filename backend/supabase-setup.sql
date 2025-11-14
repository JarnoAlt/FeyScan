-- ============================================
-- MIGRATION 001: Initial Schema Setup
-- ============================================
-- Description: Creates deployments and monitor_state tables with indexes and triggers
-- Run this in your Supabase SQL Editor
-- ============================================

-- Create deployments table
CREATE TABLE IF NOT EXISTS deployments (
  id BIGSERIAL PRIMARY KEY,
  tx_hash TEXT UNIQUE NOT NULL,
  token_address TEXT,
  token_name TEXT,
  block_number BIGINT,
  timestamp BIGINT,
  deployer_address TEXT,
  ens_name TEXT,
  dev_buy_amount NUMERIC,
  dev_buy_amount_formatted TEXT,
  dev_sold BOOLEAN DEFAULT FALSE,
  dev_sold_amount NUMERIC,
  holder_count INTEGER DEFAULT 0,
  holder_count_history JSONB DEFAULT '[]'::jsonb,
  links JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on tx_hash for fast lookups
CREATE INDEX IF NOT EXISTS idx_deployments_tx_hash ON deployments(tx_hash);
-- Create index on timestamp for sorting
CREATE INDEX IF NOT EXISTS idx_deployments_timestamp ON deployments(timestamp DESC);
-- Create index on token_address for filtering
CREATE INDEX IF NOT EXISTS idx_deployments_token_address ON deployments(token_address);
-- Create index on deployer_address for serial deployer detection
CREATE INDEX IF NOT EXISTS idx_deployments_deployer ON deployments(deployer_address);

-- Create monitor_state table
CREATE TABLE IF NOT EXISTS monitor_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  last_checked_block BIGINT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Insert initial state if doesn't exist
INSERT INTO monitor_state (id, last_checked_block)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_deployments_updated_at
  BEFORE UPDATE ON deployments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (optional - adjust based on your needs)
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_state ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (adjust based on your security needs)
-- For now, allowing all - you can restrict this later
CREATE POLICY "Allow all operations" ON deployments
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations" ON monitor_state
  FOR ALL
  USING (true)
  WITH CHECK (true);

