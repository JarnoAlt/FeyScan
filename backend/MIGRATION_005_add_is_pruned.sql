-- ============================================
-- MIGRATION 005: Add is_pruned column
-- ============================================
-- Description: Adds is_pruned column to mark inactive tokens that should stop being checked
-- Run this in your Supabase SQL Editor
-- ============================================

-- Add is_pruned column to deployments table
ALTER TABLE deployments
ADD COLUMN IF NOT EXISTS is_pruned BOOLEAN DEFAULT FALSE;

-- Create index for faster queries on is_pruned
CREATE INDEX IF NOT EXISTS idx_deployments_is_pruned
ON deployments(is_pruned);

-- Add comment to column
COMMENT ON COLUMN deployments.is_pruned IS 'Whether this token has been pruned (stopped checking due to low activity: >1 hour old with <=5 holders)';

