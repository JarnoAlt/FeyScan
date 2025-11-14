-- ============================================
-- MIGRATION 007: Add dev transfer tracking columns
-- ============================================
-- Description: Adds columns to track dev transfer activity (incoming and outgoing)
-- Run this in your Supabase SQL Editor
-- ============================================

-- Add dev transfer tracking columns to deployments table
ALTER TABLE deployments
ADD COLUMN IF NOT EXISTS dev_transfer_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dev_transferred_out NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS dev_transferred_in NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS dev_net_transfer NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_transfer_check INTEGER;

-- Create index for faster queries on transfer activity
CREATE INDEX IF NOT EXISTS idx_deployments_transfer_activity
ON deployments(dev_transfer_count, last_transfer_check);

-- Add comments to columns
COMMENT ON COLUMN deployments.dev_transfer_count IS 'Number of transfers involving the dev address';
COMMENT ON COLUMN deployments.dev_transferred_out IS 'Total tokens transferred out by dev';
COMMENT ON COLUMN deployments.dev_transferred_in IS 'Total tokens transferred in to dev';
COMMENT ON COLUMN deployments.dev_net_transfer IS 'Net transfer amount (in - out)';
COMMENT ON COLUMN deployments.last_transfer_check IS 'Timestamp of last transfer check';

