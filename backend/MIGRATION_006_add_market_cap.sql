-- ============================================
-- MIGRATION 006: Add market_cap column
-- ============================================
-- Description: Adds market_cap column to track token market capitalization
-- Run this in your Supabase SQL Editor
-- ============================================

-- Add market_cap column to deployments table
ALTER TABLE deployments
ADD COLUMN IF NOT EXISTS market_cap NUMERIC DEFAULT 0;

-- Create index for faster queries on market_cap
CREATE INDEX IF NOT EXISTS idx_deployments_market_cap
ON deployments(market_cap);

-- Add comment to column
COMMENT ON COLUMN deployments.market_cap IS 'Token market capitalization in USD (fetched from DEXScreener API)';

