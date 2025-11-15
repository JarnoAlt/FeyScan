-- Migration: Add Farcaster data column to deployments table
-- This stores Farcaster profile information for deployers when their tokens cross the 1 ETH volume threshold

ALTER TABLE deployments
ADD COLUMN IF NOT EXISTS farcaster_data JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_deployments_farcaster_data
ON deployments USING GIN (farcaster_data);

COMMENT ON COLUMN deployments.farcaster_data IS 'Farcaster profile data (username, displayName, pfp, followerCount, etc.) fetched from Neynar API when token volume crosses 1 ETH threshold.';

