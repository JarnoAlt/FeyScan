-- Migration: Add 1-hour and 6-hour volume tracking columns
-- This allows for faster detection of trending tokens

ALTER TABLE deployments
ADD COLUMN IF NOT EXISTS volume_1h NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS volume_6h NUMERIC DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_deployments_volume_1h
ON deployments(volume_1h);

CREATE INDEX IF NOT EXISTS idx_deployments_volume_6h
ON deployments(volume_6h);

COMMENT ON COLUMN deployments.volume_1h IS 'Trading volume in ETH over the last 1 hour';
COMMENT ON COLUMN deployments.volume_6h IS 'Trading volume in ETH over the last 6 hours';

