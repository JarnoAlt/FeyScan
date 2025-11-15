import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('✅ Supabase client initialized in frontend');
} else {
  console.warn('⚠️  Supabase not configured in frontend - check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
}

/**
 * Convert database row to deployment object (same format as backend)
 */
function dbToDeployment(row) {
  // Safely handle missing columns (graceful degradation)
  // This allows the frontend to work even if migrations haven't been run yet
  return {
    txHash: row.tx_hash,
    tokenAddress: row.token_address,
    tokenName: row.token_name,
    blockNumber: row.block_number,
    timestamp: row.timestamp,
    from: row.deployer_address,
    ensName: row.ens_name,
    devBuyAmount: parseFloat(row.dev_buy_amount) || 0,
    devBuyAmountFormatted: row.dev_buy_amount_formatted,
    devSold: row.dev_sold || false,
    devSoldAmount: parseFloat(row.dev_sold_amount) || 0,
    holderCount: row.holder_count || 0,
    holderCountHistory: row.holder_count_history || [],
    lastHolderCheck: row.last_holder_check || null,
    // New columns (may not exist until migration is run)
    volume1h: (row.volume_1h != null && row.volume_1h !== undefined) ? parseFloat(row.volume_1h) || 0 : 0,
    volume6h: (row.volume_6h != null && row.volume_6h !== undefined) ? parseFloat(row.volume_6h) || 0 : 0,
    // Existing columns (should always exist)
    volume24h: (row.volume_24h != null && row.volume_24h !== undefined) ? parseFloat(row.volume_24h) || 0 : 0,
    volume7d: (row.volume_7d != null && row.volume_7d !== undefined) ? parseFloat(row.volume_7d) || 0 : 0,
    volumeHistory: row.volume_history || [],
    marketCap: (() => {
      const value = row.market_cap;
      if (value == null || value === undefined || value === '' || value === 'N/A') return 0;
      // Handle string values
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return isNaN(parsed) || !isFinite(parsed) ? 0 : parsed;
      }
      // Handle number values
      const numValue = Number(value);
      return isNaN(numValue) || !isFinite(numValue) ? 0 : numValue;
    })(),
    // Dev transfer columns (may not exist until migration is run)
    devTransferCount: row.dev_transfer_count || 0,
    devTransferredOut: (row.dev_transferred_out != null && row.dev_transferred_out !== undefined) ? parseFloat(row.dev_transferred_out) || 0 : 0,
    devTransferredIn: (row.dev_transferred_in != null && row.dev_transferred_in !== undefined) ? parseFloat(row.dev_transferred_in) || 0 : 0,
    devNetTransfer: (row.dev_net_transfer != null && row.dev_net_transfer !== undefined) ? parseFloat(row.dev_net_transfer) || 0 : 0,
    lastTransferCheck: row.last_transfer_check || null,
    links: row.links || {},
    farcasterData: row.farcaster_data || null
  };
}

/**
 * Get all deployments from Supabase
 */
export async function getAllDeployments() {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    const { data, error } = await supabase
      .from('deployments')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(1000);

    if (error) {
      console.error('Error fetching from Supabase:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      console.warn('No deployments found in database');
      return [];
    }

    console.log(`✅ Loaded ${data.length} deployments from database`);
    return data.map(dbToDeployment);
  } catch (error) {
    console.error('Error getting deployments from Supabase:', error);
    throw error;
  }
}

/**
 * Get latest deployment
 */
export async function getLatestDeployment() {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  try {
    const { data, error } = await supabase
      .from('deployments')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows found
        return null;
      }
      throw error;
    }

    return dbToDeployment(data);
  } catch (error) {
    console.error('Error getting latest deployment:', error);
    throw error;
  }
}

export { supabase };

