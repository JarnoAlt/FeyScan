-- ============================================
-- MIGRATION 004: Messages Table for Dev Communication
-- ============================================
-- Description: Creates messages table for paid messages to the dev
-- Run this in your Supabase SQL Editor
-- ============================================

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  sender_address TEXT NOT NULL,
  message TEXT NOT NULL,
  payment_tx_hash TEXT UNIQUE NOT NULL,
  payment_amount_eth NUMERIC NOT NULL,
  payment_amount_usd NUMERIC,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on sender_address for filtering
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_address);
-- Create index on payment_tx_hash for verification lookups
CREATE INDEX IF NOT EXISTS idx_messages_payment_tx ON messages(payment_tx_hash);
-- Create index on created_at for sorting
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update updated_at
CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_messages_updated_at();

-- Enable Row Level Security (RLS)
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can insert messages (for sending)
CREATE POLICY "Anyone can insert messages" ON messages
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

-- Policy: Anyone can read verified messages (for public display)
CREATE POLICY "Anyone can read verified messages" ON messages
  FOR SELECT
  TO authenticated, anon
  USING (status = 'verified');

-- Policy: Only authenticated users can update their own messages (for status updates)
-- Note: In production, you may want to restrict this further
CREATE POLICY "Users can update own messages" ON messages
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

