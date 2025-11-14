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
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('✅ Supabase client initialized');
} else {
  console.log('⚠️  Supabase not configured - using JSON file storage');
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
    links: deployment.links || {}
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
    links: row.links || {}
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

