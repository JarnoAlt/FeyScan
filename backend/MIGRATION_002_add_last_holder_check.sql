-- ============================================
-- MIGRATION 002: Add last_holder_check column
-- ============================================
-- Description: Adds last_holder_check column to track when holder counts were last checked
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================

-- Add last_holder_check column to deployments table
ALTER TABLE deployments
ADD COLUMN IF NOT EXISTS last_holder_check BIGINT;

-- Create index for faster queries on last_holder_check
CREATE INDEX IF NOT EXISTS idx_deployments_last_holder_check
ON deployments(last_holder_check);

-- Update existing rows to set last_holder_check to the timestamp from holder_count_history if available
UPDATE deployments
SET last_holder_check = (
  SELECT (holder_count_history->-1->>'timestamp')::BIGINT
  FROM deployments d2
  WHERE d2.id = deployments.id
  AND jsonb_array_length(holder_count_history) > 0
)
WHERE last_holder_check IS NULL
AND jsonb_array_length(holder_count_history) > 0;

