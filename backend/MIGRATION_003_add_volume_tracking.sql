-- ============================================
-- MIGRATION 003: Add Volume Tracking Columns
-- ============================================
-- Description: Adds volume tracking columns to deployments table
-- Run this in your Supabase SQL Editor
-- ============================================

-- Add volume tracking columns
ALTER TABLE deployments
ADD COLUMN IF NOT EXISTS volume_24h NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS volume_7d NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS volume_history JSONB DEFAULT '[]'::jsonb;

-- Create index on volume_24h for sorting/filtering
CREATE INDEX IF NOT EXISTS idx_deployments_volume_24h ON deployments(volume_24h DESC);

-- Add comment to columns
COMMENT ON COLUMN deployments.volume_24h IS 'Trading volume in ETH over last 24 hours';
COMMENT ON COLUMN deployments.volume_7d IS 'Trading volume in ETH over last 7 days';
COMMENT ON COLUMN deployments.volume_history IS 'Historical volume data points with timestamps';

