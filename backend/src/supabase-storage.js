import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readDeployments, getAllDeployments as getJSONDeployments } from './storage.js';

// Load environment variables (dotenv for local dev, Vercel provides them automatically)
// Only load dotenv if not in production (Vercel sets NODE_ENV=production)
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('✅ Supabase client initialized');
    console.log(`   URL: ${SUPABASE_URL.substring(0, 30)}...`);
    console.log(`   Key: ${SUPABASE_KEY.substring(0, 20)}...`);
  } catch (error) {
    console.error('❌ Error initializing Supabase client:', error.message);
    console.log('⚠️  Falling back to JSON file storage');
  }
} else {
  console.log('⚠️  Supabase not configured - using JSON file storage');
  if (!SUPABASE_URL) {
    console.log('   Missing: SUPABASE_URL');
  }
  if (!SUPABASE_KEY) {
    console.log('   Missing: SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY');
  }
}

/**
 * Convert deployment object to database format
 */
function deploymentToDB(deployment) {
  return {
    tx_hash: deployment.txHash,
    token_address: deployment.tokenAddress || null,
    token_name: deployment.tokenName || null,
    block_number: deployment.blockNumber || null,
    timestamp: deployment.timestamp || null,
    deployer_address: deployment.from || null,
    ens_name: deployment.ensName || null,
    dev_buy_amount: deployment.devBuyAmount || 0,
    dev_buy_amount_formatted: deployment.devBuyAmountFormatted || null,
    dev_sold: deployment.devSold || false,
    dev_sold_amount: deployment.devSoldAmount || 0,
    holder_count: deployment.holderCount || 0,
    holder_count_history: deployment.holderCountHistory || [],
    last_holder_check: deployment.lastHolderCheck || null,
    ...(deployment.volume1h !== undefined && { volume_1h: deployment.volume1h }),
    ...(deployment.volume6h !== undefined && { volume_6h: deployment.volume6h }),
    volume_24h: deployment.volume24h || 0,
    volume_7d: deployment.volume7d || 0,
    volume_history: deployment.volumeHistory || [],
    market_cap: deployment.marketCap || 0,
    dev_transfer_count: deployment.devTransferCount || 0,
    dev_transferred_out: deployment.devTransferredOut || 0,
    dev_transferred_in: deployment.devTransferredIn || 0,
    dev_net_transfer: deployment.devNetTransfer || 0,
    last_transfer_check: deployment.lastTransferCheck || null,
    is_pruned: deployment.isPruned || false,
    links: deployment.links || {},
    ...(deployment.farcasterData && { farcaster_data: deployment.farcasterData })
  };
}

/**
 * Convert database row to deployment object
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
    volume1h: row.volume_1h != null ? parseFloat(row.volume_1h) || 0 : 0,
    volume6h: row.volume_6h != null ? parseFloat(row.volume_6h) || 0 : 0,
    volume24h: row.volume_24h != null ? parseFloat(row.volume_24h) || 0 : 0,
    volume7d: row.volume_7d != null ? parseFloat(row.volume_7d) || 0 : 0,
    volumeHistory: row.volume_history || [],
    marketCap: parseFloat(row.market_cap) || 0,
    devTransferCount: row.dev_transfer_count || 0,
    devTransferredOut: parseFloat(row.dev_transferred_out) || 0,
    devTransferredIn: parseFloat(row.dev_transferred_in) || 0,
    devNetTransfer: parseFloat(row.dev_net_transfer) || 0,
    lastTransferCheck: row.last_transfer_check || null,
    isPruned: row.is_pruned || false,
    links: row.links || {},
    farcasterData: row.farcaster_data || null
  };
}

/**
 * Read deployments from Supabase
 */
export async function readDeploymentsFromSupabase() {
  if (!supabase) {
    // Fallback to JSON
    return readDeployments();
  }

  try {
    const { data, error } = await supabase
      .from('deployments')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(1000);

    if (error) {
      console.error('Error reading from Supabase:', error);
      // Fallback to JSON
      return readDeployments();
    }

    return {
      deployments: data.map(dbToDeployment)
    };
  } catch (error) {
    console.error('Error reading from Supabase:', error);
    return readDeployments();
  }
}

/**
 * Get all deployments
 */
export async function getAllDeployments() {
  if (!supabase) {
    return getJSONDeployments();
  }

  try {
    const { data, error } = await supabase
      .from('deployments')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(1000);

    if (error) {
      console.error('Error getting deployments from Supabase:', error);
      if (error.message && error.message.includes('Invalid API key')) {
        console.error('⚠️  Supabase API key is invalid. Please check your SUPABASE_ANON_KEY in .env');
        console.error('   Falling back to JSON file storage');
      }
      return getJSONDeployments();
    }

    return data.map(dbToDeployment);
  } catch (error) {
    console.error('Error getting deployments from Supabase:', error);
    return getJSONDeployments();
  }
}

/**
 * Add a new deployment
 */
export async function addDeployment(newDeployment) {
  if (!supabase) {
    // Fallback to JSON
    const { addDeployment: addJSON } = await import('./storage.js');
    return addJSON(newDeployment);
  }

  try {
    const dbData = deploymentToDB(newDeployment);

    const { data, error } = await supabase
      .from('deployments')
      .insert(dbData)
      .select()
      .single();

    if (error) {
      // If duplicate, that's okay
      if (error.code === '23505') { // Unique violation
        return false;
      }
      console.error('Error adding deployment to Supabase:', error);
      // Fallback to JSON
      const { addDeployment: addJSON } = await import('./storage.js');
      return addJSON(newDeployment);
    }

    return true;
  } catch (error) {
    console.error('Error adding deployment to Supabase:', error);
    // Fallback to JSON
    const { addDeployment: addJSON } = await import('./storage.js');
    return addJSON(newDeployment);
  }
}

/**
 * Update an existing deployment
 */
export async function updateDeployment(txHash, updates) {
  if (!supabase) {
    // Fallback to JSON
    const { updateDeployment: updateJSON } = await import('./storage.js');
    return updateJSON(txHash, updates);
  }

  try {
    const dbUpdates = {};

    if (updates.tokenAddress !== undefined) dbUpdates.token_address = updates.tokenAddress;
    if (updates.tokenName !== undefined) dbUpdates.token_name = updates.tokenName;
    if (updates.devSold !== undefined) dbUpdates.dev_sold = updates.devSold;
    if (updates.devSoldAmount !== undefined) dbUpdates.dev_sold_amount = updates.devSoldAmount;
    if (updates.holderCount !== undefined) dbUpdates.holder_count = updates.holderCount;
    if (updates.holderCountHistory !== undefined) dbUpdates.holder_count_history = updates.holderCountHistory;
    if (updates.ensName !== undefined) dbUpdates.ens_name = updates.ensName;
    if (updates.lastHolderCheck !== undefined) dbUpdates.last_holder_check = updates.lastHolderCheck;
    // Only update volume1h/volume6h if migration has been run (columns exist)
    // For now, we'll skip these if they cause errors - user needs to run migration first
    // The backend will work fine without them, just won't have 1h/6h data until migration is run
    if (updates.volume1h !== undefined) {
      // Only include if we're sure the column exists (will be set after migration)
      // For now, skip to avoid SQL errors
      // dbUpdates.volume_1h = updates.volume1h;
    }
    if (updates.volume6h !== undefined) {
      // Only include if we're sure the column exists (will be set after migration)
      // For now, skip to avoid SQL errors
      // dbUpdates.volume_6h = updates.volume6h;
    }
    if (updates.volume24h !== undefined) dbUpdates.volume_24h = updates.volume24h;
    if (updates.volume7d !== undefined) dbUpdates.volume_7d = updates.volume7d;
    if (updates.volumeHistory !== undefined) dbUpdates.volume_history = updates.volumeHistory;
    if (updates.marketCap !== undefined) dbUpdates.market_cap = updates.marketCap;
    if (updates.devTransferCount !== undefined) dbUpdates.dev_transfer_count = updates.devTransferCount;
    if (updates.devTransferredOut !== undefined) dbUpdates.dev_transferred_out = updates.devTransferredOut;
    if (updates.devTransferredIn !== undefined) dbUpdates.dev_transferred_in = updates.devTransferredIn;
    if (updates.devNetTransfer !== undefined) dbUpdates.dev_net_transfer = updates.devNetTransfer;
    if (updates.lastTransferCheck !== undefined) dbUpdates.last_transfer_check = updates.lastTransferCheck;
    if (updates.isPruned !== undefined) dbUpdates.is_pruned = updates.isPruned;
    if (updates.farcasterData !== undefined) dbUpdates.farcaster_data = updates.farcasterData;

    const { error } = await supabase
      .from('deployments')
      .update(dbUpdates)
      .eq('tx_hash', txHash);

    if (error) {
      console.error('Error updating deployment in Supabase:', error);
      // Fallback to JSON
      const { updateDeployment: updateJSON } = await import('./storage.js');
      return updateJSON(txHash, updates);
    }

    return true;
  } catch (error) {
    console.error('Error updating deployment in Supabase:', error);
    // Fallback to JSON
    const { updateDeployment: updateJSON } = await import('./storage.js');
    return updateJSON(txHash, updates);
  }
}

/**
 * Get latest deployment
 */
export async function getLatestDeployment() {
  const deployments = await getAllDeployments();
  return deployments.length > 0 ? deployments[0] : null;
}

/**
 * Save monitor state
 */
export async function saveMonitorState(state) {
  if (!supabase) {
    // Fallback to JSON
    const { saveMonitorState: saveJSON } = await import('./storage.js');
    return saveJSON(state);
  }

  try {
    const { error } = await supabase
      .from('monitor_state')
      .upsert({
        id: 1,
        last_checked_block: state.lastCheckedBlock,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      });

    if (error) {
      console.error('Error saving monitor state to Supabase:', error);
      // Fallback to JSON
      const { saveMonitorState: saveJSON } = await import('./storage.js');
      return saveJSON(state);
    }

    return true;
  } catch (error) {
    console.error('Error saving monitor state to Supabase:', error);
    // Fallback to JSON
    const { saveMonitorState: saveJSON } = await import('./storage.js');
    return saveJSON(state);
  }
}

/**
 * Load monitor state
 */
export async function loadMonitorState() {
  if (!supabase) {
    // Fallback to JSON
    const { loadMonitorState: loadJSON } = await import('./storage.js');
    return loadJSON();
  }

  try {
    const { data, error } = await supabase
      .from('monitor_state')
      .select('*')
      .eq('id', 1)
      .single();

    if (error) {
      console.error('Error loading monitor state from Supabase:', error);
      // Fallback to JSON
      const { loadMonitorState: loadJSON } = await import('./storage.js');
      return loadJSON();
    }

    return {
      lastCheckedBlock: data?.last_checked_block || null
    };
  } catch (error) {
    console.error('Error loading monitor state from Supabase:', error);
    // Fallback to JSON
    const { loadMonitorState: loadJSON } = await import('./storage.js');
    return loadJSON();
  }
}

/**
 * Migrate existing JSON data to Supabase
 */
export async function migrateJSONToSupabase() {
  if (!supabase) {
    console.log('Supabase not configured, skipping migration');
    return;
  }

  try {
    const jsonData = readDeployments();
    const deployments = jsonData.deployments || [];

    console.log(`Migrating ${deployments.length} deployments to Supabase...`);

    let migrated = 0;
    let skipped = 0;

    // Insert in batches of 100
    for (let i = 0; i < deployments.length; i += 100) {
      const batch = deployments.slice(i, i + 100);
      const dbData = batch.map(deploymentToDB);

      const { data, error } = await supabase
        .from('deployments')
        .upsert(dbData, {
          onConflict: 'tx_hash',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`Error migrating batch ${i}-${i + batch.length}:`, error);
      } else {
        migrated += batch.length;
        console.log(`Migrated ${migrated}/${deployments.length} deployments...`);
      }
    }

    console.log(`✅ Migration complete: ${migrated} migrated, ${skipped} skipped`);
  } catch (error) {
    console.error('Error during migration:', error);
  }
}

