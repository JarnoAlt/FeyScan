import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { NeynarAPIClient, Configuration } from '@neynar/nodejs-sdk';
// Use Supabase if available, otherwise fall back to JSON
import {
  addDeployment,
  getAllDeployments,
  saveMonitorState,
  loadMonitorState,
  updateDeployment
} from './supabase-storage.js';

// Load environment variables (dotenv for local dev, Vercel provides them automatically)
// Only load dotenv if not in production (Vercel sets NODE_ENV=production)
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const CONTRACT_ADDRESS = '0x8EEF0dC80ADf57908bB1be0236c2a72a7e379C2d';
// Dual-provider setup: Free API for basic ops, Paid API for trace/large ranges
const ALCHEMY_API_KEY_PAID = process.env.ALCHEMY_API_KEY_PAID;
const ALCHEMY_API_KEY_FREE = process.env.ALCHEMY_API_KEY_FREE;
const INFURA_API_KEY = process.env.INFURA_API_KEY; // Kept for reference but not used
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;

// Free tier provider (for basic RPC calls, 10-block chunks)
const BASE_RPC_FREE = ALCHEMY_API_KEY_FREE
  ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY_FREE}`
  : 'https://mainnet.base.org';

// Paid tier provider (for trace API and large block ranges only)
const BASE_RPC_PAID = ALCHEMY_API_KEY_PAID
  ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY_PAID}`
  : BASE_RPC_FREE; // Fallback to free if paid not available

// CATCH-UP MODE: Automatically enabled, will auto-disable when catch-up is complete
// Can be forced via environment variable: CATCH_UP_MODE=false to disable, CATCH_UP_MODE=true to force enable
let CATCH_UP_MODE = process.env.CATCH_UP_MODE !== 'false'; // Default to true unless explicitly disabled
let POLL_INTERVAL = CATCH_UP_MODE ? 100 : 90000; // 0.1s in catch-up mode, 90s normally

// Track catch-up completion (auto-disable after 2 consecutive cycles with low work)
let catchUpLowWorkCycles = 0;
const CATCH_UP_AUTO_DISABLE_THRESHOLD = 2; // Disable after 2 cycles with minimal work (faster auto-disable)

// Volume threshold: Skip tokens with volume below this (in ETH)
// Set via environment variable or use default
const MIN_VOLUME_THRESHOLD = parseFloat(process.env.MIN_VOLUME_THRESHOLD) || 1.0; // Default: 1 ETH
const ETHERSCAN_API_URL = 'https://api.basescan.org/api';
const ALCHEMY_TRACE_URL = ALCHEMY_API_KEY_PAID
  ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY_PAID}`
  : null;

// Neynar API for Farcaster data
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
let neynarClient = null;

if (NEYNAR_API_KEY) {
  try {
    const config = new Configuration({
      apiKey: NEYNAR_API_KEY,
    });
    neynarClient = new NeynarAPIClient(config);
    console.log('✅ Neynar client initialized for Farcaster data');
  } catch (error) {
    console.error('❌ Error initializing Neynar client:', error.message);
  }
} else {
  console.log('⚠️  Neynar API key not configured - Farcaster data will not be fetched');
}

// Free tier block range limit (10 blocks)
const FREE_TIER_MAX_BLOCK_RANGE = 10;

// Known DEX router addresses on Base (for identifying swaps)
const DEX_ROUTERS = new Set([
  '0x2626664c2603336E57B271c5C0b26F421741e481'.toLowerCase(), // Uniswap V3 Router
  '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24'.toLowerCase(), // Uniswap V3 Router 2
  '0x03a520b32C04BF3bEEf7Bebf72F091C1C93A44fE'.toLowerCase(), // Aerodrome Router
  '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E45'.toLowerCase(), // Aerodrome Router V2
  '0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891'.toLowerCase(), // BaseSwap Router
  '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86'.toLowerCase(), // SwapBased Router
]);

// Known standard tokens to exclude (not new deployments)
const KNOWN_TOKENS = new Set([
  '0x4200000000000000000000000000000000000006'.toLowerCase(), // WETH on Base
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'.toLowerCase(), // USDC on Base
  '0x50c5725949a6f0c72e6c4a641f24049a917e0cbd'.toLowerCase(), // DAI on Base
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca'.toLowerCase(), // USDbC on Base
]);

// Known token names to exclude (case-insensitive)
const KNOWN_TOKEN_NAMES = new Set([
  'Wrapped Ether',
  'WETH',
  'FEY', // FEY token (the main FEY token, not deployments)
]);

let providerFree; // Free tier provider for basic operations
let providerPaid; // Paid tier provider for trace API and large ranges
let lastCheckedBlock = null;
let isMonitoring = false;

/**
 * Initialize the provider and start monitoring
 */
export async function startMonitoring() {
  try {
    providerFree = new ethers.JsonRpcProvider(BASE_RPC_FREE);
    providerPaid = new ethers.JsonRpcProvider(BASE_RPC_PAID);

    const freeStatus = ALCHEMY_API_KEY_FREE ? 'Free Tier' : 'Public RPC';
    const paidStatus = ALCHEMY_API_KEY_PAID ? 'Paid Tier' : 'Not Available';
    console.log(`Connected to Base Network:`);
    console.log(`  Free API: ${freeStatus}`);
    console.log(`  Paid API: ${paidStatus} (for trace/large ranges only)`);
    if (CATCH_UP_MODE) {
      console.log(`⚡ CATCH-UP MODE ENABLED - Running at maximum speed (${POLL_INTERVAL}ms intervals)`);
      console.log(`⚠️  Processing ${CATCH_UP_MODE ? 10 : 1} holder checks and ${CATCH_UP_MODE ? 15 : 3} volume updates per cycle`);
      console.log(`✅ Will automatically disable when catch-up is complete (after 3 cycles with minimal work)`);
    }
    console.log(`📊 Volume threshold: ${MIN_VOLUME_THRESHOLD} ETH (tokens below this will be skipped)`);

    // Get current block (use free API)
    const currentBlock = await providerFree.getBlockNumber();

    // Load saved state (last checked block and catch-up status)
    const savedState = await loadMonitorState();
    if (savedState.lastCheckedBlock) {
      lastCheckedBlock = savedState.lastCheckedBlock;
      console.log(`Resuming from saved block ${lastCheckedBlock} (current: ${currentBlock})`);

      // Only backfill if we're more than 100 blocks behind
      const blocksBehind = currentBlock - lastCheckedBlock;
      if (blocksBehind > 100) {
        console.log(`Catching up ${blocksBehind} blocks...`);
        await backfillHistory(lastCheckedBlock + 1, currentBlock);
      }
    } else {
      // First time - start from current block and backfill recent history
      lastCheckedBlock = currentBlock;
      console.log(`Starting fresh from block ${currentBlock}`);
      console.log('Backfilling recent history (last 500 blocks)...');
      await backfillHistory(currentBlock - 500, currentBlock);
    }

    // Check if catch-up was previously completed
    if (savedState.catchUpComplete === true) {
      CATCH_UP_MODE = false;
      POLL_INTERVAL = 90000;
      console.log('✅ Catch-up mode was previously completed. Running in normal mode.');
    }

    // Save initial state
    await saveMonitorState({ lastCheckedBlock, catchUpComplete: !CATCH_UP_MODE });
    console.log('Backfill complete. Starting live monitoring...\n');

    isMonitoring = true;
    monitorLoop();
  } catch (error) {
    console.error('Error starting monitor:', error);
    // Retry after 5 seconds
    setTimeout(startMonitoring, 5000);
  }
}

/**
 * Backfill historical transactions
 */
export async function backfillHistory(fromBlock, toBlock) {
  if (!providerFree) return;

  try {
    console.log(`Backfilling blocks ${fromBlock} to ${toBlock}...`);
    const transactions = await getTransactionsInRange(fromBlock, toBlock);
    console.log(`\nFound ${transactions.length} transactions to the contract`);

    if (transactions.length === 0) {
      console.log('No transactions found in this block range.');
      return;
    }

    console.log(`\nProcessing ${transactions.length} transactions...`);
    let processed = 0;
    let stored = 0;

    for (const tx of transactions) {
      processed++;
      if (processed % 25 === 0 || processed === 1) {
        console.log(`  Processing ${processed}/${transactions.length}...`);
      }

      const wasStored = await processTransaction(tx);
      if (wasStored) {
        stored++;
      }
    }

    console.log(`\n✅ Backfill complete: Stored ${stored} transactions`);
  } catch (error) {
    console.error('Error during backfill:', error);
  }
}

/**
 * Main monitoring loop with overall timeout protection
 */
async function monitorLoop() {
  if (!isMonitoring) return;

  const cycleStart = Date.now();
  const CYCLE_TIMEOUT = 120000; // 2 minute max per cycle to prevent infinite hangs

  try {
    console.log(`\n🔄 [${new Date().toLocaleTimeString()}] Starting monitoring cycle...`);

    // Wrap the entire cycle in a timeout
    await Promise.race([
      checkForNewDeployments(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Monitoring cycle timeout after 2 minutes')), CYCLE_TIMEOUT)
      )
    ]);

    const cycleDuration = ((Date.now() - cycleStart) / 1000).toFixed(1);
    if (CATCH_UP_MODE) {
      console.log(`✅ Cycle complete in ${cycleDuration}s. Next cycle in ${POLL_INTERVAL}ms...`);
    } else {
      console.log(`✅ Cycle complete in ${cycleDuration}s. Next cycle in ${POLL_INTERVAL / 1000}s...`);
    }
  } catch (error) {
    const cycleDuration = ((Date.now() - cycleStart) / 1000).toFixed(1);
    if (error.message && error.message.includes('timeout')) {
      console.error(`❌ Monitoring cycle TIMEOUT after ${cycleDuration}s - restarting...`);
      console.error('This may indicate a stuck operation. The cycle will restart.');
    } else {
      console.error('❌ Error in monitoring loop:', error);
      console.error('Stack:', error.stack);
    }
  }

  // Schedule next check
  setTimeout(monitorLoop, POLL_INTERVAL);
}

/**
 * Check for new deployments since last check
 * Respects Alchemy 10-block limit
 */
async function checkForNewDeployments() {
  if (!providerFree) return;

  try {
    const currentBlock = await providerFree.getBlockNumber();
    const fromBlock = lastCheckedBlock ? lastCheckedBlock + 1 : currentBlock - 50; // Check more blocks initially
    const toBlock = currentBlock;

    if (fromBlock > toBlock) {
      return; // No new blocks
    }

    // PRIORITY: Check TokenCreated events FIRST (most accurate and fastest)
    // This should catch all new deployments immediately
    console.log(`\n🔍 PRIORITY: Checking for new deployments in blocks ${fromBlock}-${toBlock}...`);
    await checkTokenCreatedEvents(fromBlock, toBlock);

    // Also check transactions as backup (in case events are missed)
    // Paid plan allows larger ranges, but keep it reasonable for speed
    const MAX_BLOCK_RANGE = 2000; // Paid plan allows up to 10k
    const actualToBlock = Math.min(fromBlock + MAX_BLOCK_RANGE - 1, toBlock);

    if (fromBlock <= actualToBlock) {
      // Use the same transaction fetching function that respects limits
      const transactions = await getTransactionsInRange(fromBlock, actualToBlock);
      console.log(`  📋 Also checking ${transactions.length} transactions as backup...`);

      for (const tx of transactions) {
        await processTransaction(tx);
      }
    }

    // Check for dev sells (periodically, ~5% of cycles to reduce costs)
    const checkSells = Math.random() < 0.05; // Reduced from 20% to 5%
    if (checkSells) {
      await checkForDevSells();
    }

    // Check for dev transfers (periodically, ~10% of cycles)
    const checkTransfers = Math.random() < 0.1;
    if (checkTransfers) {
      await checkForDevTransfers();
    }

    // Update holder counts more frequently (every cycle now for better tracking)
    await updateHolderCounts();

    // Update last checked block and save state
    lastCheckedBlock = actualToBlock;
    await saveMonitorState({ lastCheckedBlock });

    // If there are more blocks to check, we'll get them in the next cycle
    if (actualToBlock < toBlock) {
      // Don't log every time, only if we're catching up
      if (actualToBlock < toBlock - 5) {
        console.log(`Checking blocks ${fromBlock} to ${actualToBlock} (${toBlock - actualToBlock} blocks remaining to catch up)`);
      }
    }
  } catch (error) {
    console.error('Error checking for deployments:', error);
  }
}

// Rate limit tracking
let lastRateLimitHit = 0;
let consecutiveRateLimits = 0;

/**
 * Helper function to get logs in chunks (for free tier 10-block limit)
 */
async function getLogsInChunks(provider, filter, fromBlock, toBlock, maxBlockRange = FREE_TIER_MAX_BLOCK_RANGE) {
  const allLogs = [];
  const GET_LOGS_TIMEOUT = 15000; // 15 second timeout per getLogs call

  for (let blockNum = fromBlock; blockNum <= toBlock; blockNum += maxBlockRange) {
    const endBlock = Math.min(blockNum + maxBlockRange - 1, toBlock);
    let retries = 3;
    let success = false;

    while (retries > 0 && !success) {
      try {
        // If we've hit rate limits recently, add extra delay
        const timeSinceRateLimit = Date.now() - lastRateLimitHit;
        if (timeSinceRateLimit < 10000) { // Within last 10 seconds
          const backoffDelay = Math.min(consecutiveRateLimits * 1000, 5000); // Up to 5 seconds
          console.log(`  ⏳ Rate limit backoff: waiting ${backoffDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }

        // Add timeout to getLogs call
        const logsPromise = provider.getLogs({
          ...filter,
          fromBlock: blockNum,
          toBlock: endBlock
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('getLogs timeout after 15s')), GET_LOGS_TIMEOUT)
        );
        const logs = await Promise.race([logsPromise, timeoutPromise]);
        allLogs.push(...logs);
        success = true;
        consecutiveRateLimits = 0; // Reset on success

        // Delay between chunks (increased to avoid rate limits)
        if (endBlock < toBlock) {
          const baseDelay = CATCH_UP_MODE ? 200 : 500; // Increased from 50/200
          await new Promise(resolve => setTimeout(resolve, baseDelay));
        }
      } catch (error) {
        const isRateLimit = error.message && (
          error.message.includes('429') ||
          error.message.includes('compute units') ||
          error.message.includes('exceeded') ||
          error.message.includes('rate limit')
        );

        if (isRateLimit) {
          lastRateLimitHit = Date.now();
          consecutiveRateLimits++;
          const backoffTime = Math.min(consecutiveRateLimits * 2000, 10000); // Exponential backoff up to 10s
          console.error(`  ⚠️  Rate limit hit (${consecutiveRateLimits}x). Waiting ${backoffTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          retries--;
        } else {
          console.error(`Error fetching logs for blocks ${blockNum}-${endBlock}:`, error.message);
          break; // Non-rate-limit error, don't retry
        }
      }
    }
  }
  return allLogs;
}

/**
 * Smart RPC call with automatic fallback: Try free API first, fallback to paid on rate limit
 * Includes overall timeout to prevent infinite hangs
 */
async function smartRpcCall(operation, usePaid = false, retries = 2, operationName = 'RPC call') {
  const OVERALL_TIMEOUT = 30000; // 30 second overall timeout for any RPC call

  const operationWithTimeout = async (provider, isPaid) => {
    const emoji = isPaid ? '💰' : '🆓';
    console.log(`  ${emoji} Using ${isPaid ? 'PAID' : 'FREE'} API for ${operationName}`);
    return await Promise.race([
      operation(provider),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('RPC call timeout after 30s')), OVERALL_TIMEOUT)
      )
    ]);
  };

  // If operation requires paid (trace API, large ranges), use paid directly
  if (usePaid) {
    if (!providerPaid || !ALCHEMY_API_KEY_PAID) {
      throw new Error('Paid API required but not available');
    }
    return await operationWithTimeout(providerPaid, true);
  }

  // Try free API first
  try {
    return await operationWithTimeout(providerFree, false);
  } catch (error) {
    // Check if it's a rate limit error
    const isRateLimit = error.message && (
      error.message.includes('Too Many Requests') ||
      error.message.includes('exceeded') ||
      error.message.includes('rate limit') ||
      error.message.includes('429') ||
      error.message.includes('block range') || // Free tier block range limit
      error.message.includes('compute units') ||
      error.message.includes('quota')
    );

    if (isRateLimit) {
      lastRateLimitHit = Date.now();
      consecutiveRateLimits++;

      // If we have paid API, try it with backoff
      if (providerPaid && ALCHEMY_API_KEY_PAID && retries > 0) {
        const backoffTime = Math.min(consecutiveRateLimits * 1000, 5000);
        console.log(`  ⚠️  Free API rate limited (${consecutiveRateLimits}x). Waiting ${backoffTime}ms before paid fallback...`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));

        try {
          return await operationWithTimeout(providerPaid, true);
        } catch (paidError) {
          // If paid also rate limited, wait longer and retry
          if (paidError.message && paidError.message.includes('429')) {
            const longerBackoff = Math.min(consecutiveRateLimits * 2000, 10000);
            console.log(`  ⚠️  Paid API also rate limited. Waiting ${longerBackoff}ms...`);
            await new Promise(resolve => setTimeout(resolve, longerBackoff));

            if (retries > 0) {
              return await smartRpcCall(operation, usePaid, retries - 1);
            }
          }
          console.error(`  ❌ Paid API also failed:`, paidError.message);
          throw paidError;
        }
      } else {
        // No paid API or out of retries - wait and throw
        const backoffTime = Math.min(consecutiveRateLimits * 2000, 10000);
        console.log(`  ⚠️  Rate limited. Waiting ${backoffTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
        throw error;
      }
    }

    // If not rate limit, throw original error
    throw error;
  }
}

/**
 * Smart getLogs with fallback and automatic chunking
 * Tries free API first, falls back to paid if rate limited
 */
async function smartGetLogs(filter, fromBlock, toBlock, options = {}) {
  const { usePaid = false, maxBlockRange = FREE_TIER_MAX_BLOCK_RANGE } = options;

  // If using paid API, can use larger block ranges
  const actualMaxRange = usePaid ? 2000 : maxBlockRange;

  const blockRange = toBlock - fromBlock;
  const operationName = `getLogs (blocks ${fromBlock}-${toBlock}, range: ${blockRange})`;

  const operation = async (provider) => {
    // If range is small enough, call directly
    if (toBlock - fromBlock <= actualMaxRange) {
      return await provider.getLogs({
        ...filter,
        fromBlock,
        toBlock
      });
    }

    // Otherwise chunk it
    return await getLogsInChunks(provider, filter, fromBlock, toBlock, actualMaxRange);
  };

  return await smartRpcCall(operation, usePaid, 2, operationName);
}

/**
 * Monitor TokenCreated events from Factory contract (more accurate than parsing transactions)
 * Event signature: TokenCreated(address indexed msgSender, address indexed tokenAddress, address indexed tokenAdmin, ...)
 * Based on FEY docs: https://feydocs.lat/contracts/factory
 */
async function checkTokenCreatedEvents(fromBlock, toBlock) {
  try {
    // TokenCreated event signature - first 3 indexed params: msgSender, tokenAddress, tokenAdmin
    // We'll use a partial signature to catch the event
    // Full event: TokenCreated(address,address,address,string,string,string,string,string,address,bytes32,int24,address,address,address,uint256,address[])
    const tokenCreatedTopic = ethers.id('TokenCreated(address,address,address,string,string,string,string,string,address,bytes32,int24,address,address,address,uint256,address[])');

    // Use free API with 10-block chunks
    // PRIORITY: Check recent blocks first (last 100 blocks) for immediate detection
    const RECENT_BLOCK_RANGE = 100;
    let foundCount = 0;

    // PRIORITY: Check most recent blocks first for immediate detection
    const recentFromBlock = Math.max(fromBlock, toBlock - RECENT_BLOCK_RANGE);
    if (recentFromBlock <= toBlock) {
      try {
        const recentLogs = await smartGetLogs(
          {
            address: CONTRACT_ADDRESS,
            topics: [tokenCreatedTopic]
          },
          recentFromBlock,
          toBlock,
          { usePaid: false } // Try free first, fallback to paid if rate limited
        );

        console.log(`  🔍 PRIORITY: Checking recent blocks ${recentFromBlock}-${toBlock}: found ${recentLogs.length} TokenCreated events`);

        for (const log of recentLogs) {
          try {
            if (log.topics && log.topics.length >= 4) {
              const tokenAddress = '0x' + log.topics[2].slice(-40);

              // Get transaction and receipt for additional data (use free API)
              const tx = await providerFree.getTransaction(log.transactionHash);
              const receipt = await providerFree.getTransactionReceipt(log.transactionHash);

              // Check if we already have this deployment
              const existing = await getAllDeployments();
              if (existing.some(d => d.txHash === log.transactionHash || d.tokenAddress?.toLowerCase() === tokenAddress.toLowerCase())) {
                continue; // Already processed
              }

              // Extract and store immediately
              await extractAndStoreDeployment(tx, receipt, tokenAddress);
              foundCount++;
              console.log(`  ✅ NEW DEPLOYMENT DETECTED: ${tokenAddress} (tx: ${log.transactionHash})`);
            }
          } catch (e) {
            console.error(`  ⚠️  Error processing TokenCreated event:`, e.message);
          }
        }
      } catch (e) {
        console.error(`  ⚠️  Error checking recent TokenCreated events:`, e.message);
      }
    }

    // Then check older blocks if needed (for backfilling) - use free API with chunks
    if (fromBlock < recentFromBlock) {
      try {
        const logs = await smartGetLogs(
          {
            address: CONTRACT_ADDRESS,
            topics: [tokenCreatedTopic]
          },
          fromBlock,
          recentFromBlock - 1,
          { usePaid: false } // Try free first, fallback to paid if rate limited
        );

        console.log(`  🔍 Checking TokenCreated events in blocks ${fromBlock}-${toBlock}: found ${logs.length} events`);

        for (const log of logs) {
          try {
            // Decode the event (indexed params are in topics, non-indexed in data)
            // topics[0] = event signature
            // topics[1] = msgSender (indexed)
            // topics[2] = tokenAddress (indexed)
            // topics[3] = tokenAdmin (indexed)
            // data contains: tokenMetadata, tokenImage, tokenName, tokenSymbol, tokenContext, poolHook, poolId, startingTick, pairedToken, locker, mevModule, extensionsSupply, extensions[]

            if (log.topics && log.topics.length >= 4) {
              const msgSender = '0x' + log.topics[1].slice(-40);
              const tokenAddress = '0x' + log.topics[2].slice(-40);
              const tokenAdmin = '0x' + log.topics[3].slice(-40);

              // Get transaction and receipt for additional data (use free API)
              const tx = await providerFree.getTransaction(log.transactionHash);
              const receipt = await providerFree.getTransactionReceipt(log.transactionHash);

              // Check if we already have this deployment
              const existing = await getAllDeployments();
              if (existing.some(d => d.txHash === log.transactionHash || d.tokenAddress?.toLowerCase() === tokenAddress.toLowerCase())) {
                continue; // Already processed
              }

              // Decode the event data to get token name, symbol, etc.
              // For now, extract from transaction receipt logs (ERC20 Transfer from address(0))
              // This is more reliable than parsing the event data directly
              await extractAndStoreDeployment(tx, receipt, tokenAddress);
              foundCount++;
              console.log(`  ✅ New deployment detected via TokenCreated: ${tokenAddress}`);
            }
          } catch (e) {
            console.error(`  ⚠️  Error processing TokenCreated event:`, e.message);
          }
        }
      } catch (e) {
        if (e.message && (e.message.includes('Too Many Requests') || e.message.includes('exceeded'))) {
          console.error(`  ⚠️  Rate limit hit while checking TokenCreated events`);
        } else {
          console.error(`  ⚠️  Error fetching TokenCreated events for blocks ${fromBlock}-${toBlock}:`, e.message);
        }
      }
    } else {
      // For larger ranges, use smartGetLogs with automatic fallback
      try {
        const logs = await smartGetLogs(
          {
            address: CONTRACT_ADDRESS,
            topics: [tokenCreatedTopic]
          },
          fromBlock,
          toBlock,
          { usePaid: false } // Try free first, fallback to paid if rate limited
        );

        console.log(`  🔍 Checking TokenCreated events in blocks ${fromBlock}-${toBlock}: found ${logs.length} events`);

        for (const log of logs) {
          try {
            // Decode the event (indexed params are in topics, non-indexed in data)
            // topics[0] = event signature
            // topics[1] = msgSender (indexed)
            // topics[2] = tokenAddress (indexed)
            // topics[3] = tokenAdmin (indexed)
            // data contains: tokenMetadata, tokenImage, tokenName, tokenSymbol, tokenContext, poolHook, poolId, startingTick, pairedToken, locker, mevModule, extensionsSupply, extensions[]

            if (log.topics && log.topics.length >= 4) {
              const msgSender = '0x' + log.topics[1].slice(-40);
              const tokenAddress = '0x' + log.topics[2].slice(-40);
              const tokenAdmin = '0x' + log.topics[3].slice(-40);

              // Get transaction and receipt for additional data (use free API)
              const tx = await providerFree.getTransaction(log.transactionHash);
              const receipt = await providerFree.getTransactionReceipt(log.transactionHash);

                // Check if we already have this deployment
                const existing = await getAllDeployments();
                if (existing.some(d => d.txHash === log.transactionHash || d.tokenAddress?.toLowerCase() === tokenAddress.toLowerCase())) {
                  continue; // Already processed
                }

                // Decode the event data to get token name, symbol, etc.
                // For now, extract from transaction receipt logs (ERC20 Transfer from address(0))
                // This is more reliable than parsing the event data directly
              await extractAndStoreDeployment(tx, receipt, tokenAddress);
              foundCount++;
              console.log(`  ✅ New deployment detected via TokenCreated: ${tokenAddress}`);
            }
          } catch (e) {
            console.error(`  ⚠️  Error processing TokenCreated event:`, e.message);
          }
        }
      } catch (e) {
        if (e.message && (e.message.includes('Too Many Requests') || e.message.includes('exceeded'))) {
          console.error(`  ⚠️  Rate limit hit while checking TokenCreated events`);
        } else {
          console.error(`  ⚠️  Error fetching TokenCreated events for blocks ${fromBlock}-${toBlock}:`, e.message);
        }
      }
    }

    if (foundCount > 0) {
      console.log(`  ✅ Found ${foundCount} new token deployment(s) via TokenCreated events`);
    }
  } catch (error) {
    console.error('Error checking TokenCreated events:', error);
  }
}

/**
 * Get ALL transactions to the contract in a block range
 * Use getLogs to find transactions (more reliable)
 */
async function getTransactionsInRange(fromBlock, toBlock) {
  const transactions = [];
  const txHashes = new Set();
  const totalBlocks = toBlock - fromBlock + 1;

  console.log(`  Scanning ${totalBlocks} blocks for transactions...`);

  try {
    // Use smartGetLogs with automatic fallback (tries free first, falls back to paid if rate limited)
    const logs = await smartGetLogs(
      { address: CONTRACT_ADDRESS },
      fromBlock,
      toBlock,
      { usePaid: false } // Try free first, fallback to paid if rate limited
    );

    // Extract unique transaction hashes
    for (const log of logs) {
      if (log.transactionHash) {
        txHashes.add(log.transactionHash);
      }
    }

    console.log(`  Found ${txHashes.size} unique transaction hashes, fetching details...`);

    // Now fetch full transaction details (use free API)
    let fetched = 0;
    for (const txHash of txHashes) {
      try {
        const tx = await providerFree.getTransaction(txHash);
        if (tx && tx.to && tx.to.toLowerCase() === CONTRACT_ADDRESS.toLowerCase()) {
          transactions.push(tx);
        }
        fetched++;
        if (fetched % 50 === 0) {
          console.log(`    Fetched ${fetched}/${txHashes.size} transaction details...`);
        }
        // Small delay every 20 fetches (frugal for paid plan)
        if (fetched % 20 === 0) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (error) {
        // Skip if transaction not found
      }
    }

    console.log(`  Completed: Found ${transactions.length} transactions to the contract`);
  } catch (error) {
    console.error('Error in getTransactionsInRange:', error);
  }

  return transactions;
}

/**
 * Process a transaction to check if it's a deploy token call
 * Returns true if a deployment was detected and stored
 */
async function processTransaction(tx) {
  try {
    // Check if transaction has input data (method call)
    if (!tx.data || tx.data === '0x') {
      return false; // Not a method call
    }

    // Get transaction receipt for more details (use free API)
    const receipt = await providerFree.getTransactionReceipt(tx.hash);
    if (!receipt || receipt.status !== 1) {
      return false; // Transaction failed or not found
    }

    // Check if this is already stored (by txHash or tokenAddress)
    const existing = await getAllDeployments();
    if (existing.some(d => d.txHash === tx.hash)) {
      return false; // Already processed
    }

    // Also check for duplicate token addresses (extract token address from receipt)
    if (receipt && receipt.logs) {
      const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const deployerAddr = CONTRACT_ADDRESS.toLowerCase();

      for (const log of receipt.logs) {
        const logAddress = log.address.toLowerCase();
        if (logAddress !== deployerAddr && !KNOWN_TOKENS.has(logAddress)) {
          // Check if this token address already exists
          if (existing.some(d => d.tokenAddress && d.tokenAddress.toLowerCase() === logAddress)) {
            return false; // Token address already exists
          }
        }
      }
    }

    // Decode the function call
    const functionSelector = tx.data.slice(0, 10);

    // Check if this looks like a deploy token call
    const isDeployCall = await checkIfDeployToken(tx, receipt, functionSelector);

    if (isDeployCall) {
      await extractAndStoreDeployment(tx, receipt);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`Error processing transaction ${tx.hash}:`, error.message);
    return false;
  }
}

/**
 * Check if transaction is a deploy token call
 * Filter out known standard tokens
 */
async function checkIfDeployToken(tx, receipt, functionSelector) {
  if (receipt.logs && receipt.logs.length > 0) {
    const deployerAddr = CONTRACT_ADDRESS.toLowerCase();

    // Check if there are logs from addresses other than deployer and known tokens
    for (const log of receipt.logs) {
      const logAddr = log.address.toLowerCase();

      // Skip deployer and known standard tokens
      if (logAddr === deployerAddr || KNOWN_TOKENS.has(logAddr)) {
        continue;
      }

      // If we have logs from unknown addresses, it's likely a new token
      return true;
    }

    // If all logs are from known tokens, it's not a deployment
    return false;
  }

  // Also accept if it created a contract
  if (receipt.contractAddress) {
    return true;
  }

  return false;
}

/**
 * Extract deployment information and store it
 */
async function extractAndStoreDeployment(tx, receipt, knownTokenAddress = null) {
  try {
    // Final duplicate check before storing
    const existing = await getAllDeployments();
    if (existing.some(d => d.txHash === tx.hash)) {
      return; // Already processed
    }

    const block = await providerFree.getBlock(receipt.blockNumber);
    const timestamp = block ? block.timestamp : Math.floor(Date.now() / 1000);

    // Find token address from logs (or use provided knownTokenAddress from TokenCreated event)
    let tokenAddress = knownTokenAddress;
    let tokenName = 'Unknown';

    // If we don't have a known token address, find it from logs
    if (!tokenAddress) {
      // Priority: Transfer events from non-deployer addresses (token contracts)
      const deployerAddr = CONTRACT_ADDRESS.toLowerCase();
      const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

      for (const log of receipt.logs) {
        const logAddress = log.address.toLowerCase();

        // Skip known standard tokens (WETH, USDC, etc.)
        if (KNOWN_TOKENS.has(logAddress)) {
          continue;
        }

        // Check for Transfer events from token contracts
        if (log.topics && log.topics.length >= 3 &&
            log.topics[0] === transferEventSignature &&
            logAddress !== deployerAddr) {
          tokenAddress = log.address;
          break; // Found token address from Transfer event
        }

        // Fallback: any log from non-deployer address (but skip known tokens)
        if (logAddress !== deployerAddr && !tokenAddress && !KNOWN_TOKENS.has(logAddress)) {
          tokenAddress = log.address;
        }
      }

      // If no token address in logs, check if contract was created
      if (!tokenAddress && receipt.contractAddress) {
        tokenAddress = receipt.contractAddress;
      }

      // If still no token address, try to decode from transaction data
      if (!tokenAddress) {
        // Try to extract address from transaction input data
        // This depends on the contract ABI, but we'll try common patterns
        const data = tx.data;
        if (data.length >= 138) { // 0x + 4 bytes selector + 32 bytes * 2 (at least)
          // Try to extract address from data (addresses are 20 bytes = 40 hex chars)
          // This is a heuristic and may not always work
        }
      }
    }

    // Try to get token name from the token contract
    if (tokenAddress) {
      try {
        // Standard ERC20 name() function selector: 0x06fdde03
        const nameData = '0x06fdde03';
        const tokenContract = new ethers.Contract(tokenAddress, [
          'function name() view returns (string)',
          'function symbol() view returns (string)'
        ], providerFree);

        try {
          tokenName = await tokenContract.name();
        } catch (e) {
          // Try symbol if name fails
          try {
            tokenName = await tokenContract.symbol();
          } catch (e2) {
            tokenName = 'Unknown';
          }
        }
      } catch (error) {
        // Could not fetch token name
        console.log(`Could not fetch name for token ${tokenAddress}`);
      }
    }

    // If we don't have a token address, we can't create proper links
    // But we can still store the deployment info
    if (!tokenAddress) {
      // Try to extract from logs more carefully
      // Some contracts emit events with indexed addresses
      for (const log of receipt.logs) {
        if (log.topics && log.topics.length > 1) {
          // Topics[1] might be an address (padded to 32 bytes)
          const potentialAddress = '0x' + log.topics[1].slice(-40);
          if (ethers.isAddress(potentialAddress)) {
            tokenAddress = potentialAddress;
            break;
          }
        }
      }
    }

    // Extract dev buy amount (ETH value sent with transaction)
    const devBuyAmount = tx.value ? ethers.formatEther(tx.value) : '0';
    const devBuyAmountNum = parseFloat(devBuyAmount);

    // Try to resolve ENS name for the deployer
    let ensName = null;
    try {
      // Base network uses .base.eth for ENS
      // Try to resolve via public API
      const ensController = new AbortController();
      const ensTimeout = setTimeout(() => ensController.abort(), 5000);
      const ensResponse = await fetch(`https://api.ensideas.com/ens/resolve/${tx.from}?chainId=8453`, {
        signal: ensController.signal
      });
      clearTimeout(ensTimeout);
      if (ensResponse.ok) {
        const ensData = await ensResponse.json();
        if (ensData.name) {
          ensName = ensData.name;
        }
      }
    } catch (e) {
      // ENS resolution failed, continue without it
    }

    // Dev sell detection will be done in background check
    // Initial deployment is not sold
    let devSold = false;
    let devSoldAmount = 0;

    // Get initial holder count
    let holderCount = 0;
    let holderCountHistory = [{ count: 0, timestamp: timestamp }];

    if (tokenAddress && tokenAddress !== 'N/A') {
      try {
        // Try Etherscan API first (most accurate and efficient)
        if (ETHERSCAN_API_KEY) {
          try {
            const responseController = new AbortController();
            const responseTimeout = setTimeout(() => responseController.abort(), 5000);
            const response = await fetch(
              `${ETHERSCAN_API_URL}?module=token&action=tokenholderlist&contractaddress=${tokenAddress}&apikey=${ETHERSCAN_API_KEY}&page=1&offset=1`,
              { signal: responseController.signal }
            );
            clearTimeout(responseTimeout);
            const data = await response.json();
            if (data.status === '1' && data.result) {
              // Get total supply holders (if available) or count from first page
              // Note: This endpoint might return paginated results, but we can get an estimate
              const holderController = new AbortController();
              const holderTimeout = setTimeout(() => holderController.abort(), 5000);
              const holderResponse = await fetch(
                `${ETHERSCAN_API_URL}?module=stats&action=tokensupply&contractaddress=${tokenAddress}&apikey=${ETHERSCAN_API_KEY}`,
                { signal: holderController.signal }
              );
              clearTimeout(holderTimeout);
              // Alternative: Use token info endpoint
              const tokenInfoController = new AbortController();
              const tokenInfoTimeout = setTimeout(() => tokenInfoController.abort(), 5000);
              const tokenInfoResponse = await fetch(
                `${ETHERSCAN_API_URL}?module=token&action=tokeninfo&contractaddress=${tokenAddress}&apikey=${ETHERSCAN_API_KEY}`,
                { signal: tokenInfoController.signal }
              );
              clearTimeout(tokenInfoTimeout);
              const tokenInfo = await tokenInfoResponse.json();

              // Try to get holder count from token info or estimate from transfers
              if (tokenInfo.status === '1' && tokenInfo.result) {
                // Some tokens have holder count in metadata, but most don't
                // Fall back to Transfer event counting
              }
            }
          } catch (e) {
            // Etherscan API failed, fall back to Transfer event counting
          }
        }

        // Fallback: Count unique addresses from Transfer events
        const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const holders = new Set();

        for (const log of receipt.logs) {
          if (log.address.toLowerCase() === tokenAddress.toLowerCase() &&
              log.topics && log.topics.length >= 3 &&
              log.topics[0] === transferEventSignature) {
            const fromAddr = '0x' + log.topics[1].slice(-40);
            const toAddr = '0x' + log.topics[2].slice(-40);

            if (fromAddr !== '0x0000000000000000000000000000000000000000') {
              holders.add(fromAddr.toLowerCase());
            }
            if (toAddr !== '0x0000000000000000000000000000000000000000') {
              holders.add(toAddr.toLowerCase());
            }
          }
        }

        holderCount = holders.size;
        holderCountHistory = [{ count: holderCount, timestamp: timestamp }];
      } catch (e) {
        // Could not get holder count, continue with 0
      }
    }

    // Final check: if we have a token address, verify it's not a duplicate
    if (tokenAddress && tokenAddress !== 'N/A') {
      const existingByAddress = existing.find(d =>
        d.tokenAddress && d.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
      );
      if (existingByAddress) {
        console.log(`  ⚠️  Duplicate token address detected: ${tokenAddress} (already exists as ${existingByAddress.txHash})`);
        return; // Token address already exists, skip
      }
    }

    // Fetch market cap from DEXScreener (may be 0 for new tokens)
    let marketCap = 0;
    if (tokenAddress && tokenAddress !== 'N/A') {
      try {
        marketCap = await fetchMarketCap(tokenAddress);
      } catch (e) {
        // Market cap fetch failed, will be 0 (will be updated later)
      }
    }

    // Create deployment object
    const deployment = {
      txHash: tx.hash,
      tokenAddress: tokenAddress || 'N/A',
      tokenName: tokenName,
      blockNumber: receipt.blockNumber,
      timestamp: timestamp,
      from: tx.from,
      ensName: ensName,
      devBuyAmount: devBuyAmountNum,
      devBuyAmountFormatted: `${devBuyAmount} ETH`,
      devSold: devSold,
      devSoldAmount: devSoldAmount,
      holderCount: holderCount,
      holderCountHistory: holderCountHistory,
      marketCap: marketCap,
      links: {
        dexscreener: tokenAddress
          ? `https://dexscreener.com/base/${tokenAddress}`
          : null,
        defined: tokenAddress
          ? `https://defined.fi/base/${tokenAddress}`
          : null,
        basescan: tokenAddress
          ? `https://basescan.org/token/${tokenAddress}`
          : `https://basescan.org/tx/${tx.hash}`
      }
    };

    // Store the deployment
    const added = await addDeployment(deployment);
    if (added) {
      console.log(`\n✅ New deployment detected!`);
      console.log(`  Token: ${tokenName}`);
      console.log(`  Address: ${tokenAddress || 'N/A'}`);
      console.log(`  TX: ${tx.hash}`);
      console.log(`  Block: ${receipt.blockNumber}\n`);
    }
  } catch (error) {
    console.error('Error extracting deployment:', error);
  }
}

/**
 * Verify holder counts using Trace API to filter out zero-balance addresses
 * This provides more accurate holder counts by checking actual token balances
 */
async function verifyHoldersWithTrace(tokenAddress, potentialHolders, fromBlock, toBlock) {
  if (!ALCHEMY_TRACE_URL || potentialHolders.length === 0) {
    return potentialHolders.length;
  }

  try {
    const verifiedHolders = new Set();
    const ERC20_BALANCE_OF = '0x70a08231'; // balanceOf(address) function selector

    // Sample a few blocks to check balances
    const sampleSize = Math.min(3, toBlock - fromBlock);
    const blockStep = Math.max(1, Math.floor((toBlock - fromBlock) / sampleSize));

    for (let i = 0; i < sampleSize; i++) {
      const blockNum = toBlock - (i * blockStep);
      if (blockNum < fromBlock) break;

      try {
        // Get trace for the block with timeout
        console.log(`  💰 Using PAID API for trace_block (block ${blockNum})`);
        const traceController = new AbortController();
        const traceTimeout = setTimeout(() => traceController.abort(), 10000);
        const traceResponse = await fetch(ALCHEMY_TRACE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'trace_block',
            params: [`0x${blockNum.toString(16)}`]
          }),
          signal: traceController.signal
        });
        clearTimeout(traceTimeout);

        if (!traceResponse.ok) continue;
        const traceData = await traceResponse.json();

        if (traceData.result && Array.isArray(traceData.result)) {
          // Look for balanceOf calls or state changes involving our token
          for (const trace of traceData.result) {
            if (trace.action && trace.action.to) {
              const toAddress = trace.action.to.toLowerCase();
              if (toAddress === tokenAddress.toLowerCase()) {
                // Check if this trace involves any of our potential holders
                const fromAddress = trace.action.from?.toLowerCase();
                if (fromAddress && potentialHolders.includes(fromAddress)) {
                  // If there's a value transfer or state change, they likely have a balance
                  if (trace.action.value || trace.result) {
                    verifiedHolders.add(fromAddress);
                  }
                }
              }
            }
          }
        }

        // Small delay between blocks
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        // Continue with next block if trace fails
        continue;
      }
    }

    // If we verified some holders, use that count; otherwise trust Transfer events
    // For efficiency, we'll use a hybrid approach: if we verified >50% of potential holders, use verified count
    // Otherwise, use Transfer event count (which is usually accurate)
    if (verifiedHolders.size > 0 && verifiedHolders.size >= potentialHolders.length * 0.5) {
      return verifiedHolders.size;
    }

    // Default to Transfer event count (more comprehensive)
    return potentialHolders.length;
  } catch (error) {
    console.error(`Error verifying holders with trace:`, error.message);
    return potentialHolders.length; // Fallback to Transfer event count
  }
}

/**
 * Calculate actual ETH volume using Alchemy Trace API
 * This provides accurate volume metrics instead of estimates
 */
async function calculateActualVolume(deployment, currentBlock, currentTimestamp) {
  if (!ALCHEMY_TRACE_URL || !deployment.tokenAddress) {
    // Fallback to estimate if Trace API not available
    return { volume1h: 0, volume6h: 0, volume24h: 0, volume7d: 0 };
  }

  try {
    const tokenAddress = deployment.tokenAddress.toLowerCase();
    const WETH_ADDRESS = '0x4200000000000000000000000000000000000006'.toLowerCase();

    // Calculate block ranges (Base has ~2s block time, ~43200 blocks/day)
    const blocks1h = 1800;   // ~1 hour
    const blocks6h = 10800;   // ~6 hours
    const blocks24h = 43200;  // ~24 hours
    const blocks7d = blocks24h * 7;
    const fromBlock1h = Math.max(currentBlock - blocks1h, deployment.blockNumber);
    const fromBlock6h = Math.max(currentBlock - blocks6h, deployment.blockNumber);
    const fromBlock24h = Math.max(currentBlock - blocks24h, deployment.blockNumber);
    const fromBlock7d = Math.max(currentBlock - blocks7d, deployment.blockNumber);

    let volume1h = 0;
    let volume6h = 0;
    let volume24h = 0;
    let volume7d = 0;

    // Get all transactions involving this token in the last 24h
    try {
      // Find transactions that interact with DEX routers and involve our token
      const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

      // Get Transfer events for the token (use smartGetLogs with automatic fallback)
      const transferLogs = await smartGetLogs(
        {
          address: deployment.tokenAddress,
          topics: [transferEventSignature]
        },
        fromBlock24h,
        currentBlock,
        { usePaid: false } // Try free first, fallback to paid if rate limited
      );

      // Get unique transaction hashes
      const txHashes = [...new Set(transferLogs.map(log => log.transactionHash))];

      // Limit to most recent 10 transactions to avoid timeouts and rate limits (reduced from 20)
      const recentTxs = txHashes.slice(-10);

      // Set a timeout for the entire volume calculation (15 seconds max - reduced from 30)
      const volumeCalculationStart = Date.now();
      const MAX_VOLUME_CALC_TIME = 15000; // 15 seconds

      // Process transactions in batches to get traces
      for (let i = 0; i < recentTxs.length; i++) {
        const txHash = recentTxs[i];

        // Check if we've exceeded max time
        if (Date.now() - volumeCalculationStart > MAX_VOLUME_CALC_TIME) {
          console.log(`    ⏱️  Volume calculation timeout after ${i}/${recentTxs.length} transactions, using fallback`);
          break;
        }

        try {
          // Add timeout to transaction fetch (5 seconds)
          const txPromise = providerFree.getTransaction(txHash);
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Transaction fetch timeout')), 5000)
          );
          const tx = await Promise.race([txPromise, timeoutPromise]);

          if (!tx || !tx.to) continue;

          // Check if transaction interacts with a DEX router
          const toAddress = tx.to.toLowerCase();
          if (!DEX_ROUTERS.has(toAddress)) continue;

          // Get transaction trace using Alchemy Trace API with timeout
          console.log(`  💰 Using PAID API for trace_transaction (${txHash.slice(0, 10)}...)`);
          const traceController = new AbortController();
          const traceTimeout = setTimeout(() => traceController.abort(), 10000); // 10 second timeout

          try {
            const traceResponse = await fetch(ALCHEMY_TRACE_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'trace_transaction',
                params: [txHash]
              }),
              signal: traceController.signal
            });

            clearTimeout(traceTimeout);

            if (!traceResponse.ok) {
              console.log(`    ⚠️  Trace API returned ${traceResponse.status} for ${txHash.slice(0, 10)}...`);
              continue;
            }

            const traceData = await traceResponse.json();

            if (traceData.error) {
              console.log(`    ⚠️  Trace API error: ${traceData.error.message || 'Unknown error'}`);
              continue;
            }

            if (traceData.result && Array.isArray(traceData.result)) {
              // Extract ETH value transfers from trace
              for (const trace of traceData.result) {
                if (trace.action && trace.action.value) {
                  const value = BigInt(trace.action.value);
                  if (value > 0) {
                    const ethValue = parseFloat(ethers.formatEther(value));

                    // Check if this trace involves our token or WETH
                    const traceAddress = trace.action.to?.toLowerCase();
                    if (traceAddress === tokenAddress || traceAddress === WETH_ADDRESS) {
                      // Get block number for this transaction (with timeout)
                      try {
                        const receiptPromise = providerFree.getTransactionReceipt(txHash);
                        const receiptTimeout = new Promise((_, reject) =>
                          setTimeout(() => reject(new Error('Receipt fetch timeout')), 5000)
                        );
                        const receipt = await Promise.race([receiptPromise, receiptTimeout]);

                        if (receipt) {
                          const blockPromise = providerFree.getBlock(receipt.blockNumber);
                          const blockTimeout = new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Block fetch timeout')), 5000)
                          );
                          const block = await Promise.race([blockPromise, blockTimeout]);
                          const txTimestamp = block ? block.timestamp : currentTimestamp;
                          const age = currentTimestamp - txTimestamp;

                          if (age <= 3600) { // 1 hour
                            volume1h += ethValue;
                          }
                          if (age <= 21600) { // 6 hours
                            volume6h += ethValue;
                          }
                          if (age <= 86400) { // 24 hours
                            volume24h += ethValue;
                          }
                          if (age <= 604800) { // 7 days
                            volume7d += ethValue;
                          }
                        }
                      } catch (blockErr) {
                        // Skip this transaction if block/receipt fetch fails
                        continue;
                      }
                    }
                  }
                }
              }
            }

            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (fetchErr) {
            clearTimeout(traceTimeout);
            if (fetchErr.name === 'AbortError') {
              console.log(`    ⏱️  Trace API timeout for ${txHash.slice(0, 10)}..., skipping`);
            } else {
              console.log(`    ⚠️  Trace API error for ${txHash.slice(0, 10)}...: ${fetchErr.message}`);
            }
            continue;
          }
        } catch (err) {
          // Continue with next transaction if anything fails
          if (err.message !== 'Transaction fetch timeout') {
            console.log(`    ⚠️  Error processing transaction ${txHash.slice(0, 10)}...: ${err.message}`);
          }
          continue;
        }
      }
    } catch (err) {
      console.error(`Error calculating volume for ${deployment.tokenName || 'token'}:`, err.message);
      // Return fallback estimate - will be calculated in fallback section below
    }

    // If we got actual volume, use it; otherwise use fallback
    if (volume1h === 0 && volume6h === 0 && volume24h === 0 && volume7d === 0) {
      // Fallback: estimate based on transfer activity (use smartGetLogs with automatic fallback)
      // Get transfers for 1h, 6h, and 24h separately for better estimates
      const transferLogs1h = await smartGetLogs(
        {
          address: deployment.tokenAddress,
          topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
        },
        fromBlock1h,
        currentBlock,
        { usePaid: false }
      );
      const transferLogs6h = await smartGetLogs(
        {
          address: deployment.tokenAddress,
          topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
        },
        fromBlock6h,
        currentBlock,
        { usePaid: false }
      );
      const transferLogs24h = await smartGetLogs(
        {
          address: deployment.tokenAddress,
          topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']
        },
        fromBlock24h,
        currentBlock,
        { usePaid: false }
      );

      const transferCount1h = transferLogs1h.length;
      const transferCount6h = transferLogs6h.length;
      const transferCount24h = transferLogs24h.length;

      return {
        volume1h: transferCount1h * 0.01,
        volume6h: transferCount6h * 0.01,
        volume24h: transferCount24h * 0.01,
        volume7d: transferCount24h * 0.01 * 7 // Estimate 7d from 24h
      };
    }

    return { volume1h, volume6h, volume24h, volume7d };
  } catch (error) {
    console.error(`Error in calculateActualVolume:`, error.message);
    // Return zero volume on error
    return { volume1h: 0, volume6h: 0, volume24h: 0, volume7d: 0 };
  }
}

/**
 * Fetch Farcaster user data from Neynar API based on Ethereum address
 * Returns Farcaster profile data or null if not found
 */
async function fetchFarcasterUser(ethereumAddress) {
  if (!neynarClient || !ethereumAddress || ethereumAddress === 'N/A') {
    return null;
  }

  try {
    const response = await neynarClient.fetchBulkUsersByEthOrSolAddress({
      addresses: [ethereumAddress]
    });

    if (response && response.result && response.result.users && response.result.users.length > 0) {
      const user = response.result.users[0];
      return {
        fid: user.fid,
        username: user.username,
        displayName: user.displayName,
        pfp: user.pfp?.url || null,
        followerCount: user.followerCount || 0,
        followingCount: user.followingCount || 0,
        activeStatus: user.activeStatus || 'inactive'
      };
    }

    return null;
  } catch (error) {
    console.log(`  ⚠️  Error fetching Farcaster data for ${ethereumAddress.slice(0, 10)}...: ${error.message}`);
    return null;
  }
}

/**
 * Fetch market cap from DEXScreener API
 * Returns market cap in USD, or 0 if unavailable
 */
async function fetchMarketCap(tokenAddress) {
  if (!tokenAddress || tokenAddress === 'N/A') {
    return 0;
  }

  try {
    // DEXScreener API endpoint for token data with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return 0;
    }

    const data = await response.json();

    // DEXScreener returns pairs array, find the pair with highest liquidity
    if (data.pairs && Array.isArray(data.pairs) && data.pairs.length > 0) {
      // Sort by market cap (or liquidity if market cap not available)
      const sortedPairs = data.pairs
        .filter(pair => pair.chainId === 'base') // Only Base chain pairs
        .sort((a, b) => {
          const aMc = parseFloat(a.marketCap || a.liquidity || 0);
          const bMc = parseFloat(b.marketCap || b.liquidity || 0);
          return bMc - aMc;
        });

      if (sortedPairs.length > 0) {
        const topPair = sortedPairs[0];
        const marketCap = parseFloat(topPair.marketCap || 0);
        return marketCap > 0 ? marketCap : 0;
      }
    }

    return 0;
  } catch (error) {
    // Silently fail - market cap is optional
    if (error.name === 'AbortError') {
      console.log(`  ⏱️  Market cap fetch timeout for ${tokenAddress.slice(0, 10)}...`);
    }
    return 0;
  }
}

/**
 * Update holder counts for existing deployments (smart priority-based checking)
 * Prioritizes: newer tokens, tokens with recent growth, tokens not checked recently
 */
async function updateHolderCounts() {
  try {
    const deployments = await getAllDeployments();
    const currentBlock = await providerFree.getBlockNumber();
    const currentTimestamp = Math.floor(Date.now() / 1000);

    // Filter valid tokens (exclude known standard tokens like WETH and FEY, and pruned tokens)
    const validTokens = deployments.filter(d => {
      if (!d.tokenAddress || d.tokenAddress === 'N/A') return false;
      // Exclude known standard tokens by address
      const addrLower = d.tokenAddress.toLowerCase();
      if (KNOWN_TOKENS.has(addrLower)) return false;
      // Exclude known tokens by name (case-insensitive)
      const tokenName = (d.tokenName || '').trim();
      if (KNOWN_TOKEN_NAMES.has(tokenName.toUpperCase())) return false;

      // Volume threshold filter: Skip tokens with volume below threshold
      // Only apply to tokens older than 1 hour (give new tokens a chance)
      const age = currentTimestamp - d.timestamp;
      if (age > 3600) {
        const volume24h = d.volume24h || 0;
        if (volume24h < MIN_VOLUME_THRESHOLD) {
          return false; // Skip low-volume tokens
        }
      }

      // Prune tokens: if token is >1 hour old and has <=5 holders, stop checking
      const isPruned = d.isPruned || false;
      if (isPruned) return false; // Already pruned

      // Check if should be pruned: >1 hour old and <=5 holders
      if (age > 3600 && (d.holderCount || 0) <= 5) {
        // Proactively mark as pruned if not already marked
        if (!d.isPruned) {
          updateDeployment(d.txHash, { isPruned: true }).catch(() => {
            // Ignore errors, will be marked on next holder check
          });
        }
        return false; // Don't check this token anymore
      }

      return true;
    });

    if (validTokens.length === 0) return;

    // Score and prioritize tokens for checking
    // First pass: Quick volume check for tokens (sequential to reduce costs, limit to top 10)
    // Only check volume for top priority tokens to reduce API calls
    const tokensToCheckVolume = validTokens.slice(0, CATCH_UP_MODE ? 50 : 10); // Increased to 50 in catch-up mode for faster processing
    const tokensWithVolume = [];

    // Process sequentially with delays to reduce costs
    for (const deployment of tokensToCheckVolume) {
      let recentVolume = 0;
      try {
        const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const fromBlock = Math.max(currentBlock - 50, deployment.blockNumber);
        const recentLogs = await smartGetLogs(
          {
            address: deployment.tokenAddress,
            topics: [transferEventSignature]
          },
          fromBlock,
          currentBlock,
          { usePaid: false } // Try free first, fallback to paid if rate limited
        );
        recentVolume = recentLogs.length;
      } catch (e) {
        // If volume check fails, continue with 0
      }
      tokensWithVolume.push({ deployment, recentVolume });

      // Delay between volume checks (faster in catch-up mode)
      await new Promise(resolve => setTimeout(resolve, CATCH_UP_MODE ? 100 : 500));
    }

    // Add remaining tokens with 0 volume (not checked)
    for (const deployment of validTokens.slice(20)) {
      tokensWithVolume.push({ deployment, recentVolume: 0 });
    }

    // Second pass: Calculate priority scores with tiered system
    // Tier 1: Highest MCAP, holders, score (always prioritized unless stale)
    // Tier 2: Active tokens with recent changes
    // Tier 3: New tokens or tokens with no data yet
    // Stale: Tokens with no change in 2+ cycles go back to round-robin

    const tokensWithPriority = tokensWithVolume.map(({ deployment, recentVolume }) => {
      let priority = 0;
      const history = deployment.holderCountHistory || [];
      const lastCheck = deployment.lastHolderCheck || (history.length > 0 ? history[history.length - 1].timestamp : null);
      const age = currentTimestamp - deployment.timestamp;

      // Determine if token has data vs no data
      const hasData = lastCheck !== null && history.length > 0;
      const hasNoData = !hasData; // Never been checked

      // Check if token is stale (no change in 2+ cycles)
      // A cycle is roughly POLL_INTERVAL, so 2 cycles = 2 * POLL_INTERVAL
      const cyclesSinceCheck = lastCheck ? Math.floor((currentTimestamp - lastCheck) / POLL_INTERVAL) : 0;
      const isStale = hasData && cyclesSinceCheck >= 2;

      // Check if token showed activity in last check
      let hasActivity = false;
      if (history.length >= 2) {
        const recent = history[history.length - 1];
        const previous = history[history.length - 2];
        const change = recent.count - previous.count;
        hasActivity = change > 0 || (deployment.volume24h || 0) > 0 || (deployment.marketCap || 0) > 0;
      }

      // TIER 1: Highest MCAP, holders, score (MASSIVE priority boost)
      // BUT: In catch-up mode, only apply if token already has data (not in backlog)
      const holderCount = deployment.holderCount || 0;
      const marketCap = deployment.marketCap || 0;
      const volume24h = deployment.volume24h || 0;

      // Calculate score (same as frontend)
      let score = 0;
      if (history.length >= 2) {
        const recent = history[history.length - 1];
        const previous = history[history.length - 2];
        const growth = recent.count - previous.count;
        const growthPercent = previous.count > 0 ? (growth / previous.count) * 100 : 0;
        const normalizedGrowth = Math.min(growthPercent / 10, 10);
        const normalizedAbsGrowth = Math.min(growth, 50);
        score = (volume24h * 0.4) + (normalizedGrowth * 0.4) + (normalizedAbsGrowth * 0.2);
      }

      // Tier 1 boost: High MCAP, holders, or score
      const isTier1 = marketCap > 10000 || holderCount > 50 || score > 1.0;

      // In catch-up mode, only prioritize Tier 1 if token already has data (not in backlog)
      if (CATCH_UP_MODE && hasNoData) {
        // Skip Tier 1 boost for tokens with no data - they'll get processed anyway
      } else if (isTier1 && !isStale) {
        // Tier 1 tokens get massive priority unless stale
        if (marketCap > 100000) priority += 10000; // $100K+ MCAP
        else if (marketCap > 50000) priority += 5000; // $50K+ MCAP
        else if (marketCap > 10000) priority += 2000; // $10K+ MCAP

        if (holderCount > 100) priority += 5000; // 100+ holders
        else if (holderCount > 50) priority += 2000; // 50+ holders

        if (score > 5.0) priority += 5000; // Very high score
        else if (score > 2.0) priority += 2000; // High score
        else if (score > 1.0) priority += 1000; // Good score
      } else if (isTier1 && isStale) {
        // Stale tier 1 tokens: still check but lower priority
        priority += 500; // Reduced priority for stale tier 1
      }

      // TIER 2: Active tokens with recent changes
      if (!isTier1 && hasActivity && !isStale) {
        priority += 1000; // Active tokens get good priority
      }

      // Priority 1: HIGH VOLUME DETECTION (most important for catching active tokens!)
      if (recentVolume > 50) priority += 2000; // Very high volume (50+ transfers in 50 blocks)
      else if (recentVolume > 20) priority += 1000; // High volume (20+ transfers)
      else if (recentVolume > 10) priority += 500; // Moderate volume (10+ transfers)
      else if (recentVolume > 5) priority += 200; // Some activity (5+ transfers)
      else if (recentVolume > 0) priority += 100; // Any recent activity

      // Priority 2: Newer tokens (deployed in last hour = high priority)
      if (age < 3600) priority += 1000; // Very new
      else if (age < 7200) priority += 500; // Recent
      else if (age < 14400) priority += 200; // Fairly recent

      // Priority 3: Tokens with recent holder growth (indicates activity)
      if (history.length >= 2) {
        const recent = history[history.length - 1];
        const previous = history[history.length - 2];
        const growth = recent.count - previous.count;
        const growthPercent = previous.count > 0 ? (growth / previous.count) * 100 : 0;

        if (growth > 0) {
          priority += Math.min(growth * 10, 500); // Up to 500 points for growth
          if (growthPercent > 10) priority += 300; // Bonus for rapid growth
        }
      }

      // Priority 4: Distinguish "no data" vs "no activity"
      const timeSinceCheck = lastCheck ? (currentTimestamp - lastCheck) : Infinity;
      const isVeryNew = age < 3600; // Less than 1 hour old

      // In catch-up mode, prioritize backlog (no data) over everything else
      if (CATCH_UP_MODE) {
        if (hasNoData) {
          // No data gathered yet - MASSIVE priority in catch-up mode to process backlog
          priority += 50000; // Highest priority - process backlog first
        } else if (isStale) {
          // Stale token - high priority to refresh data
          priority += 20000; // High priority for stale tokens
        } else if (hasData && !hasActivity) {
          // Has data but no activity - lower priority (token might be dead)
          priority += 200; // Low priority for inactive tokens
        }
      } else {
        // Normal mode: prioritize active/high-value tokens
        if (hasNoData) {
          // No data gathered yet - high priority to get initial data
          priority += 1500; // High priority for tokens we haven't checked
        } else if (hasData && !hasActivity && !isStale) {
          // Has data but no activity - lower priority (token might be dead)
          priority += 200; // Low priority for inactive tokens
        } else if (isStale) {
          // Stale token (no change in 2+ cycles) - back to round-robin
          priority += 100; // Minimal priority, round-robin style
        }
      }

      // CHILL MODE: Aggressive cooldown for tokens with no activity
      // If token has no activity and was checked recently, give it a long cooldown (5 minutes)
      const CHILL_MODE_COOLDOWN = 300; // 5 minutes for inactive tokens
      const hasNoActivity = !hasActivity && hasData; // Has data but no activity

      if (hasNoActivity && timeSinceCheck < CHILL_MODE_COOLDOWN) {
        // Token has no activity and was checked recently - CHILL MODE (skip for 5 minutes)
        priority -= 10000; // Massive penalty - skip for 5 minutes
      } else if (hasNoActivity && timeSinceCheck < CHILL_MODE_COOLDOWN * 2) {
        // Still in extended cooldown for inactive tokens
        priority -= 5000;
      } else if (timeSinceCheck < 600 && !isVeryNew && !isTier1 && !hasActivity) {
        // Regular cooldown for tokens with no activity
        priority -= 5000; // Checked in last 10 min - skip unless tier 1 or very new
      } else if (timeSinceCheck < 1200 && !isVeryNew && !isTier1 && !hasActivity) {
        priority -= 2000; // Checked in last 20 min - heavy penalty
      } else if (timeSinceCheck < 1800 && !isTier1 && !hasActivity) {
        priority -= 500; // Checked in last 30 min - moderate penalty
      } else if (timeSinceCheck > CHILL_MODE_COOLDOWN && !isStale && hasNoActivity) {
        // Inactive token not checked in 5+ min - can check again
        priority += 100; // Low priority for inactive tokens
      } else if (timeSinceCheck > 1800 && !isStale && hasActivity) {
        priority += 400; // Active token not checked in 30+ min - bonus
      } else if (timeSinceCheck > 1200 && !isStale && hasActivity) {
        priority += 200; // Active token not checked in 20+ min
      } else if (timeSinceCheck > 600 && !isStale && hasActivity) {
        priority += 100; // Active token not checked in 10+ min
      }

      // Priority 5: Tokens with higher holder counts (more holders = more important)
      if (holderCount > 100) priority += 500;
      else if (holderCount > 50) priority += 300;
      else if (holderCount > 20) priority += 150;
      else if (holderCount > 10) priority += 75;
      else if (holderCount > 5) priority += 30;

      // Priority 6: Higher dev buy amounts (more skin in the game = more important)
      const devBuy = deployment.devBuyAmount || 0;
      if (devBuy > 1.0) priority += 400; // 1+ ETH dev buy
      else if (devBuy > 0.5) priority += 250; // 0.5+ ETH dev buy
      else if (devBuy > 0.25) priority += 150; // 0.25+ ETH dev buy
      else if (devBuy > 0.1) priority += 75; // 0.1+ ETH dev buy
      else if (devBuy > 0) priority += 25; // Any dev buy

      return {
        deployment,
        priority,
        lastCheck,
        recentVolume,
        isTier1,
        isStale,
        hasNoData,
        hasActivity,
        score
      };
    });

    // Sort by priority (highest first) and filter out tokens with negative priority (recently checked)
    tokensWithPriority.sort((a, b) => b.priority - a.priority);

    // Filter out tokens that were checked too recently (negative priority) unless they're very new or have activity
    const filteredByCooldown = tokensWithPriority.filter(t => {
      const age = currentTimestamp - t.deployment.timestamp;
      const isVeryNew = age < 3600; // Less than 1 hour old
      const lastCheck = t.lastCheck || (t.deployment.holderCountHistory?.length > 0
        ? t.deployment.holderCountHistory[t.deployment.holderCountHistory.length - 1].timestamp
        : t.deployment.timestamp);
      const timeSinceCheck = currentTimestamp - lastCheck;
      const CHILL_MODE_COOLDOWN = 300; // 5 minutes for inactive tokens

      // CHILL MODE: Skip inactive tokens that were checked recently
      const hasData = t.deployment.holderCountHistory && t.deployment.holderCountHistory.length > 0;
      if (!t.hasActivity && hasData && timeSinceCheck < CHILL_MODE_COOLDOWN) {
        return false; // Skip inactive tokens in chill mode
      }

      // Allow if priority is positive OR if token is very new OR if token has activity
      return t.priority > 0 || (isVeryNew && timeSinceCheck > 300) || t.hasActivity;
    });

    // Reduce tokens per cycle if we're hitting rate limits
    const maxTokens = consecutiveRateLimits > 3 ? 1 : (CATCH_UP_MODE ? 10 : 1); // Increased to 10 in catch-up mode for faster processing
    const toUpdate = filteredByCooldown.slice(0, maxTokens).map(t => t.deployment);

    // Store volume data for tokens with activity (process sequentially to avoid Supabase rate limits)
    // Only update volume for top priority tokens to reduce costs (limit to 3 tokens max)
    // Also filter by volume threshold: skip tokens that already have volume data below threshold
    const tokensNeedingVolumeUpdate = tokensWithPriority
      .filter(t => {
        // Skip if no recent activity
        if (t.recentVolume === 0) return false;

        // If token already has volume data, check threshold
        const existingVolume = t.deployment.volume24h || 0;
        const age = currentTimestamp - t.deployment.timestamp;

        // For tokens older than 1 hour, apply volume threshold
        if (age > 3600 && existingVolume < MIN_VOLUME_THRESHOLD) {
          return false; // Skip low-volume tokens
        }

        return true;
      })
      .slice(0, consecutiveRateLimits > 3 ? 3 : (CATCH_UP_MODE ? 15 : 3)); // Increased to 15 in catch-up mode for faster processing

    // Auto-disable catch-up mode if we have minimal work for several cycles
    if (CATCH_UP_MODE) {
      const totalWork = toUpdate.length + tokensNeedingVolumeUpdate.length;
      if (totalWork <= 2) { // Very little work (2 or fewer tokens)
        catchUpLowWorkCycles++;
        if (catchUpLowWorkCycles >= CATCH_UP_AUTO_DISABLE_THRESHOLD) {
          CATCH_UP_MODE = false;
          POLL_INTERVAL = 90000;
          catchUpLowWorkCycles = 0;
          console.log('\n🎉 CATCH-UP MODE AUTO-DISABLED: Minimal work detected for 2+ cycles.');
          console.log('   Switching to normal mode (90s intervals) to reduce costs.');
          console.log('   Most tokens are in chill mode (checked every 5 minutes when inactive).');
          console.log('   To re-enable catch-up mode, set CATCH_UP_MODE=true or restart.\n');
          // Save state
          await saveMonitorState({ lastCheckedBlock, catchUpComplete: true });
        } else {
          console.log(`  ⏳ Catch-up mode: ${catchUpLowWorkCycles}/${CATCH_UP_AUTO_DISABLE_THRESHOLD} cycles with minimal work (${totalWork} tokens)`);
        }
      } else {
        catchUpLowWorkCycles = 0; // Reset counter if we have work
      }
    }

    // Process volume updates sequentially with delays to avoid Supabase rate limits
    for (let i = 0; i < tokensNeedingVolumeUpdate.length; i++) {
      const { deployment, recentVolume } = tokensNeedingVolumeUpdate[i];
      try {
        console.log(`  📊 Updating volume ${i + 1}/${tokensNeedingVolumeUpdate.length}: ${deployment.tokenName || 'Unknown'}`);
        // Calculate actual ETH volume using Trace API for accurate metrics
        const actualVolume = await calculateActualVolume(deployment, currentBlock, currentTimestamp);

        const volume1h = actualVolume.volume1h;
        const volume6h = actualVolume.volume6h;
        const volume24h = actualVolume.volume24h;
        const volume7d = actualVolume.volume7d;

        // Only update if volume meets threshold (for tokens older than 1 hour)
        const age = currentTimestamp - deployment.timestamp;
        const shouldUpdate = age <= 3600 || volume24h >= MIN_VOLUME_THRESHOLD;

        if (!shouldUpdate) {
          console.log(`    ⏭️  Skipping ${deployment.tokenName || 'token'}: volume ${volume24h.toFixed(3)} ETH < ${MIN_VOLUME_THRESHOLD} ETH threshold`);
          continue; // Skip to next token
        }

        // Get existing volume history
        const volumeHistory = deployment.volumeHistory || [];
        const newVolumeHistory = [...volumeHistory, { volume: volume24h, timestamp: currentTimestamp }];
        if (newVolumeHistory.length > 30) {
          newVolumeHistory.shift(); // Keep last 30 data points
        }

        // Fetch market cap from DEXScreener
        let marketCap = deployment.marketCap || 0;
        try {
          marketCap = await fetchMarketCap(deployment.tokenAddress);
        } catch (e) {
          // If market cap fetch fails, keep existing value
          console.error(`  ⚠️  Error fetching market cap for ${deployment.tokenName || 'token'}:`, e.message);
        }

        // Fetch Farcaster data if volume crosses threshold and we don't have it yet
        let farcasterData = deployment.farcasterData || null;
        if (volume24h >= MIN_VOLUME_THRESHOLD && !farcasterData && deployment.from) {
          console.log(`  🔍 Checking Farcaster for ${deployment.tokenName || 'token'} (volume ${volume24h.toFixed(3)} ETH >= ${MIN_VOLUME_THRESHOLD} ETH)`);
          try {
            farcasterData = await fetchFarcasterUser(deployment.from);
            if (farcasterData) {
              console.log(`  ✅ Found Farcaster profile: @${farcasterData.username} (${farcasterData.followerCount} followers)`);
            }
          } catch (e) {
            console.error(`  ⚠️  Error fetching Farcaster data for ${deployment.tokenName || 'token'}:`, e.message);
          }
        }

        await updateDeployment(deployment.txHash, {
          volume1h: volume1h,
          volume6h: volume6h,
          volume24h: volume24h,
          volume7d: volume7d,
          volumeHistory: newVolumeHistory,
          marketCap: marketCap,
          ...(farcasterData && { farcasterData: farcasterData })
        });

        // Delay between updates (faster in catch-up mode)
        await new Promise(resolve => setTimeout(resolve, CATCH_UP_MODE ? 200 : 1000));
      } catch (err) {
        console.error(`Error updating volume for ${deployment.tokenName || 'token'}:`, err.message);
        // Continue with next token
      }
    }

    if (toUpdate.length > 0) {
      const highVolumeCount = tokensWithPriority.slice(0, 10).filter(t => t.recentVolume > 10).length;
      console.log(`\n📊 Checking holder counts for ${toUpdate.length} tokens (priority-based, ${highVolumeCount} high-volume)...`);
      // Log top priorities for debugging
      tokensWithPriority.slice(0, 5).forEach((t, i) => {
        if (t.recentVolume > 0) {
          const displayName = t.deployment.tokenName && t.deployment.tokenName !== 'Unknown'
            ? t.deployment.tokenName
            : (t.deployment.tokenAddress ? `${t.deployment.tokenAddress.slice(0, 6)}...${t.deployment.tokenAddress.slice(-4)}` : 'Token');
          console.log(`  ${i + 1}. ${displayName}: ${t.recentVolume} recent transfers, priority: ${t.priority}`);
        }
      });
    }

    // Process holder count updates sequentially to avoid rate limits
    // Process one token at a time with delays between them
    for (let i = 0; i < toUpdate.length; i++) {
      const deployment = toUpdate[i];
      // Add delay between tokens (faster in catch-up mode)
      if (i > 0) {
        console.log(`  ⏳ Processing token ${i + 1}/${toUpdate.length}...`);
        await new Promise(resolve => setTimeout(resolve, CATCH_UP_MODE ? 1000 : 5000));
      } else {
        console.log(`  ⏳ Processing token ${i + 1}/${toUpdate.length}...`);
      }

      const tokenName = deployment.tokenName || deployment.tokenAddress?.slice(0, 10) || 'Unknown';
      console.log(`    🔍 Checking holders for ${tokenName}...`);
      await (async () => {
        try {
          let newHolderCount = 0;

          // Try Etherscan API first if available
          if (ETHERSCAN_API_KEY) {
            try {
              const responseController = new AbortController();
              const responseTimeout = setTimeout(() => responseController.abort(), 5000);
              const response = await fetch(
                `${ETHERSCAN_API_URL}?module=token&action=tokenholderlist&contractaddress=${deployment.tokenAddress}&apikey=${ETHERSCAN_API_KEY}&page=1&offset=1000`,
                { signal: responseController.signal }
              );
              clearTimeout(responseTimeout);
              const data = await response.json();
              if (data.status === '1' && data.result && Array.isArray(data.result)) {
                newHolderCount = Math.max(newHolderCount, data.result.length);
              }
            } catch (e) {
              // Etherscan API failed, use Transfer event counting
            }
          }

          // Count from Transfer events (more accurate for all holders)
          // Use smartGetLogs with automatic fallback (free first, paid if rate limited)
          const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
          const holders = new Set();

          // Smart block range selection: for old tokens, only check recent blocks
          // For new tokens, check all blocks from creation
          const fromBlock = deployment.blockNumber;
          const toBlock = currentBlock;
          const blockRange = toBlock - fromBlock;
          const MAX_BLOCKS_TO_CHECK = 200; // Only check last 200 blocks for old tokens (reduced from 500 to cut costs)

          // Determine starting block: for old tokens, only check recent blocks
          let checkFromBlock = fromBlock;
          if (blockRange > MAX_BLOCKS_TO_CHECK) {
            // For old tokens, only check recent blocks and use existing holder count as base
            checkFromBlock = Math.max(fromBlock, toBlock - MAX_BLOCKS_TO_CHECK);
            // Start with existing holder count (we'll add new holders from recent blocks)
            const existingCount = deployment.holderCount || 0;
            // We can't accurately track all holders with partial data, so we'll use a different approach
            // For now, just check recent blocks and estimate
          }

          // Use smartGetLogs with automatic fallback (tries free first, falls back to paid if rate limited)
          try {
            const logs = await smartGetLogs(
              {
                address: deployment.tokenAddress,
                topics: [transferEventSignature]
              },
              checkFromBlock,
              toBlock,
              { usePaid: false } // Try free first, fallback to paid if rate limited
            );

            // Process all logs
            for (const log of logs) {
              if (log.topics && log.topics.length >= 3) {
                const fromAddr = '0x' + log.topics[1].slice(-40);
                const toAddr = '0x' + log.topics[2].slice(-40);

                if (fromAddr !== '0x0000000000000000000000000000000000000000') {
                  holders.add(fromAddr.toLowerCase());
                }
                if (toAddr !== '0x0000000000000000000000000000000000000000') {
                  holders.add(toAddr.toLowerCase());
                }
              }
            }
          } catch (e) {
            // If smartGetLogs fails (both free and paid), log and skip
            if (e.message && (e.message.includes('Too Many Requests') || e.message.includes('exceeded') || e.message.includes('rate limit'))) {
              console.error(`  ⚠️  Rate limit hit for ${deployment.tokenName || 'token'} (both APIs), skipping holder check`);
              return; // Skip this token
            }
            console.error(`  ⚠️  Error fetching logs for ${deployment.tokenName || 'token'}:`, e.message);
            throw e; // Re-throw if not rate limit
          }

          // For old tokens where we only checked recent blocks, use existing count as base
          // Verify holder counts using Trace API for more accuracy (optional enhancement)
          // For tokens with many transfers, we can use trace_block to verify actual balances
          let verifiedHolderCount = holders.size;

          // If we have Trace API and this is a high-activity token, verify balances
          if (ALCHEMY_TRACE_URL && holders.size > 0 && holders.size < 1000) {
            try {
              // Sample a few recent blocks to verify actual token balances
              const sampleBlocks = Math.min(5, Math.floor((toBlock - checkFromBlock) / 10));
              if (sampleBlocks > 0) {
                const verifiedHolders = await verifyHoldersWithTrace(
                  deployment.tokenAddress,
                  Array.from(holders),
                  Math.max(checkFromBlock, toBlock - sampleBlocks * 10),
                  toBlock
                );
                if (verifiedHolders > 0) {
                  verifiedHolderCount = verifiedHolders;
                }
              }
            } catch (err) {
              // If trace verification fails, use the Transfer event count
              console.error(`  ⚠️  Trace verification failed, using Transfer event count:`, err.message);
            }
          }

          if (checkFromBlock > fromBlock && deployment.holderCount) {
            // We checked recent blocks, so we have new holders but not all historical
            // Use the larger of: existing count or recent holders found
            newHolderCount = Math.max(deployment.holderCount, verifiedHolderCount);
          } else {
            // For new tokens or when we checked all blocks, use the verified holder count
            newHolderCount = verifiedHolderCount;
          }

          // Rate limit handling is now done in smartGetLogs, so we can proceed

          // newHolderCount is already set above based on whether we checked all blocks or just recent

          // If token name is still "Unknown", try to fetch it again (token might be ready now)
          let updatedTokenName = deployment.tokenName;
          if ((!updatedTokenName || updatedTokenName === 'Unknown') && deployment.tokenAddress && deployment.tokenAddress !== 'N/A') {
            try {
              const tokenContract = new ethers.Contract(deployment.tokenAddress, [
                'function name() view returns (string)',
                'function symbol() view returns (string)'
              ], providerFree);

              try {
                updatedTokenName = await tokenContract.name();
              } catch (e) {
                // Try symbol if name fails
                try {
                  updatedTokenName = await tokenContract.symbol();
                } catch (e2) {
                  // Keep as Unknown if both fail
                }
              }
            } catch (error) {
              // Failed to fetch name, keep existing
            }
          }

          // Check if token should be pruned (stopped checking)
          const age = currentTimestamp - deployment.timestamp;
          const shouldPrune = age > 3600 && newHolderCount <= 5; // >1 hour old and <=5 holders

          // Update holder count and history
          const history = deployment.holderCountHistory || [{ count: deployment.holderCount || 0, timestamp: deployment.timestamp }];

          // Only update if count changed or it's been more than 5 minutes since last update
          const lastUpdate = history[history.length - 1];
          const timeSinceLastUpdate = currentTimestamp - (lastUpdate?.timestamp || deployment.timestamp);
          const countChanged = newHolderCount !== (deployment.holderCount || 0);

          if (countChanged || timeSinceLastUpdate > 300) { // 5 minutes
            // Add new entry to history (keep last 10 entries)
            const newHistory = [...history, { count: newHolderCount, timestamp: currentTimestamp }];
            if (newHistory.length > 10) {
              newHistory.shift(); // Remove oldest
            }

            // Fetch market cap if not already set (refresh periodically)
            let marketCap = deployment.marketCap || 0;
            // Only fetch if missing or very old (check every 3rd holder update to reduce API calls)
            const shouldFetchMarketCap = !marketCap || (countChanged && Math.random() < 0.33);
            if (shouldFetchMarketCap) {
              try {
                marketCap = await fetchMarketCap(deployment.tokenAddress);
                if (marketCap > 0) {
                  console.log(`    💰 Market cap: $${(marketCap / 1000).toFixed(1)}K`);
                }
              } catch (e) {
                // If market cap fetch fails, keep existing value
              }
            }

            // Prepare update object
            const updateData = {
              holderCount: newHolderCount,
              holderCountHistory: newHistory,
              lastHolderCheck: currentTimestamp, // Track when we last checked
              marketCap: marketCap
            };

            // Mark as pruned if it should be stopped
            if (shouldPrune) {
              updateData.isPruned = true;
            }

            // Include token name update if we successfully fetched it
            if (updatedTokenName && updatedTokenName !== 'Unknown' && updatedTokenName !== deployment.tokenName) {
              updateData.tokenName = updatedTokenName;
            }

            await updateDeployment(deployment.txHash, updateData);

            // Use updated name for display
            const displayName = updatedTokenName && updatedTokenName !== 'Unknown' ? updatedTokenName : (deployment.tokenName || 'Token');

            // Log pruning
            if (shouldPrune) {
              console.log(`  🗑️  ${displayName}: Pruned (${newHolderCount} holders after ${Math.floor(age / 60)}m, stopping checks)`);
            }

            if (countChanged) {
              const change = newHolderCount - (deployment.holderCount || 0);
              const changePercent = (deployment.holderCount || 0) > 0 ? ((change / (deployment.holderCount || 1)) * 100).toFixed(1) : '∞';
              console.log(`  ✅ ${displayName}: ${deployment.holderCount || 0} → ${newHolderCount} (${change > 0 ? '+' : ''}${change}, ${changePercent}%)`);
            } else {
              console.log(`  ✓ ${displayName}: ${newHolderCount} holders (no change)`);
            }
          } else {
            // Still update lastHolderCheck even if count didn't change
            await updateDeployment(deployment.txHash, {
              lastHolderCheck: currentTimestamp
            });
          }
        } catch (e) {
          console.error(`  ⚠️  Error checking holders for ${deployment.tokenName || 'token'}:`, e.message);
        }
      })();
    }
  } catch (error) {
    console.error('Error updating holder counts:', error);
  }
}

/**
 * Check existing deployments for dev sells
 */
async function checkForDevSells() {
  try {
    const deployments = await getAllDeployments();
    const currentBlock = await providerFree.getBlockNumber();

    // Check deployments that aren't marked as sold yet
    const unsoldDeployments = deployments.filter(d => !d.devSold && d.tokenAddress !== 'N/A' && d.tokenAddress);

    for (const deployment of unsoldDeployments.slice(0, 10)) { // Check max 10 at a time
      try {
        const tokenContract = new ethers.Contract(deployment.tokenAddress, [
          'function decimals() view returns (uint8)'
        ], providerFree);

        // Check for transfers from deployer in recent blocks
        const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const checkBlocks = 100; // Check last 100 blocks

        const fromBlock = Math.max(currentBlock - checkBlocks, deployment.blockNumber);
        const logs = await smartGetLogs(
          {
            address: deployment.tokenAddress,
            topics: [
              transferEventSignature,
              ethers.zeroPadValue(deployment.from, 32) // from address (deployer)
            ]
          },
          fromBlock,
          currentBlock,
          { usePaid: false } // Try free first, fallback to paid if rate limited
        );

        // Check if deployer transferred tokens to someone else (sell)
        let maxSellAmount = 0;
        for (const log of logs) {
          if (log.topics && log.topics.length >= 3) {
            const toAddress = '0x' + log.topics[2].slice(-40);
            // If transfer is to a different address, it's a sell
            if (toAddress.toLowerCase() !== deployment.from.toLowerCase()) {
              try {
                const decimals = await tokenContract.decimals();
                // Transfer amount is in the data field
                if (log.data && log.data !== '0x') {
                  const transferAmount = ethers.formatUnits(log.data, decimals);
                  maxSellAmount = Math.max(maxSellAmount, parseFloat(transferAmount));
                }
              } catch (e) {
                // Could not parse amount
              }
            }
          }
        }

        // If we found significant transfers out, mark as sold
        if (maxSellAmount > 0) {
          await updateDeployment(deployment.txHash, {
            devSold: true,
            devSoldAmount: maxSellAmount
          });

          console.log(`\n⚠️  Dev sold detected: ${deployment.tokenName} (${deployment.tokenAddress.slice(0, 10)}...)`);
          console.log(`   Sold amount: ${maxSellAmount.toFixed(4)} tokens\n`);
        }
      } catch (e) {
        // Skip if error checking this deployment
      }
    }
  } catch (error) {
    console.error('Error checking for dev sells:', error);
  }
}

/**
 * Check for dev transfers (both in and out) to track dev activity
 */
async function checkForDevTransfers() {
  try {
    const deployments = await getAllDeployments();
    const currentBlock = await providerFree.getBlockNumber();

    // Check recent deployments (last 24 hours worth of blocks)
    const checkBlocks = 43200; // ~24 hours at 2s per block
    const recentDeployments = deployments.filter(d => {
      if (!d.tokenAddress || d.tokenAddress === 'N/A') return false;
      const age = currentBlock - (d.blockNumber || 0);
      return age < checkBlocks; // Only check recent deployments
    });

    for (const deployment of recentDeployments.slice(0, 20)) { // Check max 20 at a time
      try {
        const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const fromBlock = Math.max(currentBlock - 100, deployment.blockNumber);

        // Check transfers FROM dev (outgoing) - use smartGetLogs with automatic fallback
        const transfersFrom = await smartGetLogs(
          {
            address: deployment.tokenAddress,
            topics: [
              transferEventSignature,
              ethers.zeroPadValue(deployment.from, 32) // from address (deployer)
            ]
          },
          fromBlock,
          currentBlock,
          { usePaid: false } // Try free first, fallback to paid if rate limited
        );

        // Check transfers TO dev (incoming) - use smartGetLogs with automatic fallback
        // Get all Transfer events and filter for those where 'to' is the dev address
        const allTransfers = await smartGetLogs(
          {
            address: deployment.tokenAddress,
            topics: [transferEventSignature] // Only filter by event signature
          },
          fromBlock,
          currentBlock,
          { usePaid: false } // Try free first, fallback to paid if rate limited
        );

        // Filter for transfers TO dev (topics[2] is the 'to' address)
        const devAddressPadded = ethers.zeroPadValue(deployment.from, 32).toLowerCase();
        const transfersTo = allTransfers.filter(log => {
          if (log.topics && log.topics.length >= 3) {
            const toAddress = log.topics[2].toLowerCase();
            return toAddress === devAddressPadded;
          }
          return false;
        });

        // Process transfers
        let totalTransferredOut = 0;
        let totalTransferredIn = 0;
        let transferCount = 0;

        const tokenContract = new ethers.Contract(deployment.tokenAddress, [
          'function decimals() view returns (uint8)'
        ], providerFree);

        const decimals = await tokenContract.decimals().catch(() => 18);

        // Process outgoing transfers
        for (const log of transfersFrom) {
          if (log.topics && log.topics.length >= 3) {
            const toAddress = '0x' + log.topics[2].slice(-40);
            // Only count if transferring to a different address
            if (toAddress.toLowerCase() !== deployment.from.toLowerCase()) {
              transferCount++;
              if (log.data && log.data !== '0x') {
                try {
                  const amount = parseFloat(ethers.formatUnits(log.data, decimals));
                  totalTransferredOut += amount;
                } catch (e) {
                  // Could not parse amount
                }
              }
            }
          }
        }

        // Process incoming transfers
        for (const log of transfersTo) {
          if (log.topics && log.topics.length >= 3) {
            const fromAddress = '0x' + log.topics[1].slice(-40);
            // Only count if receiving from a different address
            if (fromAddress.toLowerCase() !== deployment.from.toLowerCase()) {
              transferCount++;
              if (log.data && log.data !== '0x') {
                try {
                  const amount = parseFloat(ethers.formatUnits(log.data, decimals));
                  totalTransferredIn += amount;
                } catch (e) {
                  // Could not parse amount
                }
              }
            }
          }
        }

        // Store transfer data if there's activity
        if (transferCount > 0 || totalTransferredOut > 0 || totalTransferredIn > 0) {
          const transferData = {
            transferCount,
            totalTransferredOut,
            totalTransferredIn,
            netTransfer: totalTransferredIn - totalTransferredOut,
            lastTransferCheck: Math.floor(Date.now() / 1000)
          };

          // Update deployment with transfer data
          await updateDeployment(deployment.txHash, {
            devTransferCount: transferCount,
            devTransferredOut: totalTransferredOut,
            devTransferredIn: totalTransferredIn,
            devNetTransfer: totalTransferredIn - totalTransferredOut,
            lastTransferCheck: transferData.lastTransferCheck
          });

          if (transferCount > 0) {
            console.log(`  📊 Dev transfer activity: ${deployment.tokenName || 'Token'}`);
            console.log(`     Transfers: ${transferCount}, Out: ${totalTransferredOut.toFixed(2)}, In: ${totalTransferredIn.toFixed(2)}, Net: ${transferData.netTransfer.toFixed(2)}`);
          }
        }
      } catch (e) {
        // Skip if error checking this deployment
      }
    }
  } catch (error) {
    console.error('Error checking for dev transfers:', error);
  }
}

/**
 * Stop monitoring
 */
export function stopMonitoring() {
  isMonitoring = false;
}



