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
    volume24h: parseFloat(row.volume_24h) || 0,
    volume7d: parseFloat(row.volume_7d) || 0,
    volumeHistory: row.volume_history || [],
    marketCap: parseFloat(row.market_cap) || 0,
    devTransferCount: row.dev_transfer_count || 0,
    devTransferredOut: parseFloat(row.dev_transferred_out) || 0,
    devTransferredIn: parseFloat(row.dev_transferred_in) || 0,
    devNetTransfer: parseFloat(row.dev_net_transfer) || 0,
    lastTransferCheck: row.last_transfer_check || null,
    links: row.links || {}
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

