import { ethers } from 'ethers';
import dotenv from 'dotenv';
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
// Alchemy-only setup (paid plan) - using single provider for all operations
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const INFURA_API_KEY = process.env.INFURA_API_KEY; // Kept for reference but not used
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;

// Primary provider (Alchemy only - paid plan)
const BASE_RPC = ALCHEMY_API_KEY
  ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
  : 'https://mainnet.base.org';

// Secondary provider (also Alchemy for load balancing)
const BASE_RPC_SECONDARY = ALCHEMY_API_KEY
  ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
  : 'https://mainnet.base.org';

const POLL_INTERVAL = 15000; // 15 seconds
const ETHERSCAN_API_URL = 'https://api.basescan.org/api';

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

let provider;
let providerSecondary; // Same as provider (Alchemy), kept for potential future load balancing
let lastCheckedBlock = null;
let isMonitoring = false;

/**
 * Initialize the provider and start monitoring
 */
export async function startMonitoring() {
  try {
    provider = new ethers.JsonRpcProvider(BASE_RPC);
    providerSecondary = new ethers.JsonRpcProvider(BASE_RPC_SECONDARY);

    let rpcType = ALCHEMY_API_KEY ? 'Alchemy API (paid plan)' : 'Public RPC';
    console.log(`Connected to Base Network via ${rpcType}`);

    // Get current block
    const currentBlock = await provider.getBlockNumber();

    // Load saved state (last checked block)
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

    // Save initial state
    await saveMonitorState({ lastCheckedBlock });
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
  if (!provider) return;

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
 * Main monitoring loop
 */
async function monitorLoop() {
  if (!isMonitoring) return;

  try {
    await checkForNewDeployments();
  } catch (error) {
    console.error('Error in monitoring loop:', error);
  }

  // Schedule next check
  setTimeout(monitorLoop, POLL_INTERVAL);
}

/**
 * Check for new deployments since last check
 * Respects Alchemy 10-block limit
 */
async function checkForNewDeployments() {
  if (!provider) return;

  try {
    const currentBlock = await provider.getBlockNumber();
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

    // Check for dev sells (periodically, ~20% of cycles)
    const checkSells = Math.random() < 0.2;
    if (checkSells) {
      await checkForDevSells();
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

    // Get logs in chunks (paid plan allows larger ranges)
    // PRIORITY: Check recent blocks first (last 100 blocks) for immediate detection
    const RECENT_BLOCK_RANGE = 100;
    const MAX_BLOCK_RANGE = 2000; // Paid plan allows up to 10k blocks
    let foundCount = 0;

    // PRIORITY: Check most recent blocks first for immediate detection
    const recentFromBlock = Math.max(fromBlock, toBlock - RECENT_BLOCK_RANGE);
    if (recentFromBlock <= toBlock) {
      try {
        const recentLogs = await provider.getLogs({
          address: CONTRACT_ADDRESS,
          fromBlock: recentFromBlock,
          toBlock: toBlock,
          topics: [tokenCreatedTopic]
        });

        console.log(`  🔍 PRIORITY: Checking recent blocks ${recentFromBlock}-${toBlock}: found ${recentLogs.length} TokenCreated events`);

        for (const log of recentLogs) {
          try {
            if (log.topics && log.topics.length >= 4) {
              const tokenAddress = '0x' + log.topics[2].slice(-40);

              // Get transaction and receipt for additional data
              const tx = await provider.getTransaction(log.transactionHash);
              const receipt = await provider.getTransactionReceipt(log.transactionHash);

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

    // Then check older blocks if needed (for backfilling)
    if (fromBlock < recentFromBlock && toBlock - fromBlock <= MAX_BLOCK_RANGE) {
      try {
        const logs = await provider.getLogs({
          address: CONTRACT_ADDRESS,
          fromBlock: fromBlock,
          toBlock: toBlock,
          topics: [tokenCreatedTopic] // Filter by event signature
        });

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

              // Get transaction and receipt for additional data
              const tx = await provider.getTransaction(log.transactionHash);
              const receipt = await provider.getTransactionReceipt(log.transactionHash);

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
      // For larger ranges, chunk it
      for (let blockNum = fromBlock; blockNum <= toBlock; blockNum += MAX_BLOCK_RANGE) {
        const endBlock = Math.min(blockNum + MAX_BLOCK_RANGE - 1, toBlock);

        try {
          const logs = await provider.getLogs({
            address: CONTRACT_ADDRESS,
            fromBlock: blockNum,
            toBlock: endBlock,
            topics: [tokenCreatedTopic] // Filter by event signature
          });

          console.log(`  🔍 Checking TokenCreated events in blocks ${blockNum}-${endBlock}: found ${logs.length} events`);

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

                // Get transaction and receipt for additional data
                const tx = await provider.getTransaction(log.transactionHash);
                const receipt = await provider.getTransactionReceipt(log.transactionHash);

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

          // Small delay to avoid rate limits (frugal for paid plan)
          if (blockNum < toBlock) {
            await new Promise(resolve => setTimeout(resolve, 150));
          }
        } catch (e) {
          if (e.message && (e.message.includes('Too Many Requests') || e.message.includes('exceeded'))) {
            console.error(`  ⚠️  Rate limit hit while checking TokenCreated events`);
            break;
          }
          console.error(`  ⚠️  Error fetching TokenCreated events for blocks ${blockNum}-${endBlock}:`, e.message);
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
    // Use getLogs in chunks (paid plan allows larger ranges)
    const MAX_BLOCK_RANGE = 2000; // Paid plan allows up to 10k blocks
    let processedChunks = 0;
    const totalChunks = Math.ceil(totalBlocks / MAX_BLOCK_RANGE);

    for (let blockNum = fromBlock; blockNum <= toBlock; blockNum += MAX_BLOCK_RANGE) {
      const endBlock = Math.min(blockNum + MAX_BLOCK_RANGE - 1, toBlock);

      try {
        // Get logs from the contract (this finds all transactions that interacted with it)
        const logs = await provider.getLogs({
          address: CONTRACT_ADDRESS,
          fromBlock: blockNum,
          toBlock: endBlock
        });

        // Extract unique transaction hashes
        for (const log of logs) {
          if (log.transactionHash) {
            txHashes.add(log.transactionHash);
          }
        }

        processedChunks++;
        if (processedChunks % 10 === 0 || processedChunks === 1) {
          console.log(`    Processed ${processedChunks}/${totalChunks} chunks, found ${txHashes.size} unique transactions...`);
        }

        // Small delay to avoid rate limits (frugal for paid plan)
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`    Error fetching logs for blocks ${blockNum}-${endBlock}:`, error.message);
        // Continue with next chunk
      }
    }

    console.log(`  Found ${txHashes.size} unique transaction hashes, fetching details...`);

    // Now fetch full transaction details
    let fetched = 0;
    for (const txHash of txHashes) {
      try {
        const tx = await provider.getTransaction(txHash);
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

    // Get transaction receipt for more details
    const receipt = await provider.getTransactionReceipt(tx.hash);
    if (!receipt || receipt.status !== 1) {
      return false; // Transaction failed or not found
    }

    // Check if this is already stored
    const existing = await getAllDeployments();
    if (existing.some(d => d.txHash === tx.hash)) {
      return false; // Already processed
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
    const block = await provider.getBlock(receipt.blockNumber);
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
        ], provider);

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
      const ensResponse = await fetch(`https://api.ensideas.com/ens/resolve/${tx.from}?chainId=8453`);
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
            const response = await fetch(
              `${ETHERSCAN_API_URL}?module=token&action=tokenholderlist&contractaddress=${tokenAddress}&apikey=${ETHERSCAN_API_KEY}&page=1&offset=1`
            );
            const data = await response.json();
            if (data.status === '1' && data.result) {
              // Get total supply holders (if available) or count from first page
              // Note: This endpoint might return paginated results, but we can get an estimate
              const holderResponse = await fetch(
                `${ETHERSCAN_API_URL}?module=stats&action=tokensupply&contractaddress=${tokenAddress}&apikey=${ETHERSCAN_API_KEY}`
              );
              // Alternative: Use token info endpoint
              const tokenInfoResponse = await fetch(
                `${ETHERSCAN_API_URL}?module=token&action=tokeninfo&contractaddress=${tokenAddress}&apikey=${ETHERSCAN_API_KEY}`
              );
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
 * Update holder counts for existing deployments (smart priority-based checking)
 * Prioritizes: newer tokens, tokens with recent growth, tokens not checked recently
 */
async function updateHolderCounts() {
  try {
    const deployments = await getAllDeployments();
    const currentBlock = await provider.getBlockNumber();
    const currentTimestamp = Math.floor(Date.now() / 1000);

    // Filter valid tokens (exclude known standard tokens like WETH and FEY)
    const validTokens = deployments.filter(d => {
      if (!d.tokenAddress || d.tokenAddress === 'N/A') return false;
      // Exclude known standard tokens by address
      const addrLower = d.tokenAddress.toLowerCase();
      if (KNOWN_TOKENS.has(addrLower)) return false;
      // Exclude known tokens by name (case-insensitive)
      const tokenName = (d.tokenName || '').trim();
      if (KNOWN_TOKEN_NAMES.has(tokenName.toUpperCase())) return false;
      return true;
    });

    if (validTokens.length === 0) return;

    // Score and prioritize tokens for checking
    // First pass: Quick volume check for all tokens (lightweight, parallelized across providers)
    // Split tokens into batches and use different providers for parallel checking
    const batchSize = Math.ceil(validTokens.length / 2);
    const batch1 = validTokens.slice(0, batchSize);
    const batch2 = validTokens.slice(batchSize);

    const [volumeResults1, volumeResults2] = await Promise.all([
      // Use primary provider for first batch
      Promise.all(batch1.map(async (deployment) => {
        let recentVolume = 0;
        try {
          const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
          const recentLogs = await provider.getLogs({
            address: deployment.tokenAddress,
            fromBlock: Math.max(currentBlock - 50, deployment.blockNumber),
            toBlock: currentBlock,
            topics: [transferEventSignature]
          });
          recentVolume = recentLogs.length;
        } catch (e) {
          // If volume check fails, continue with 0
        }
        return { deployment, recentVolume };
      })),
      // Use secondary provider for second batch (parallel)
      Promise.all(batch2.map(async (deployment) => {
        let recentVolume = 0;
        try {
          const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
          const recentLogs = await providerSecondary.getLogs({
            address: deployment.tokenAddress,
            fromBlock: Math.max(currentBlock - 50, deployment.blockNumber),
            toBlock: currentBlock,
            topics: [transferEventSignature]
          });
          recentVolume = recentLogs.length;
        } catch (e) {
          // If volume check fails, continue with 0
        }
        return { deployment, recentVolume };
      }))
    ]);

    const tokensWithVolume = [...volumeResults1, ...volumeResults2];

    // Second pass: Calculate priority scores and actual volume in ETH
    // For now, we'll use transfer count as a proxy for volume activity
    // TODO: Improve to calculate actual ETH volume from Swap events
    const tokensWithPriority = tokensWithVolume.map(({ deployment, recentVolume }) => {
      let priority = 0;

      // Priority 1: HIGH VOLUME DETECTION (most important for catching active tokens!)
      // This is the "trick" - we check volume BEFORE checking holder count
      if (recentVolume > 50) priority += 2000; // Very high volume (50+ transfers in 50 blocks)
      else if (recentVolume > 20) priority += 1000; // High volume (20+ transfers)
      else if (recentVolume > 10) priority += 500; // Moderate volume (10+ transfers)
      else if (recentVolume > 5) priority += 200; // Some activity (5+ transfers)
      else if (recentVolume > 0) priority += 100; // Any recent activity

      // Priority 2: Newer tokens (deployed in last hour = high priority)
      const age = currentTimestamp - deployment.timestamp;
      if (age < 3600) priority += 1000; // Very new
      else if (age < 7200) priority += 500; // Recent
      else if (age < 14400) priority += 200; // Fairly recent

      // Priority 3: Tokens with recent holder growth (indicates activity)
      const history = deployment.holderCountHistory || [];
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

      // Priority 4: Tokens not checked recently (stale data)
      const lastCheck = deployment.lastHolderCheck || (history.length > 0 ? history[history.length - 1].timestamp : deployment.timestamp);
      const timeSinceCheck = currentTimestamp - lastCheck;
      if (timeSinceCheck > 600) priority += 400; // Not checked in 10+ min
      else if (timeSinceCheck > 300) priority += 200; // Not checked in 5+ min
      else if (timeSinceCheck > 120) priority += 100; // Not checked in 2+ min

      // Priority 5: Tokens with higher holder counts (more holders = more important)
      const holderCount = deployment.holderCount || 0;
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

      return { deployment, priority, lastCheck, recentVolume };
    });

    // Sort by priority (highest first) and take top 5 for this cycle (paid plan allows more)
    tokensWithPriority.sort((a, b) => b.priority - a.priority);
    const toUpdate = tokensWithPriority.slice(0, 5).map(t => t.deployment);

    // Store volume data for tokens with activity (process sequentially to avoid Supabase rate limits)
    const tokensNeedingVolumeUpdate = tokensWithPriority.filter(t => t.recentVolume > 0);

    // Process volume updates sequentially with delays to avoid Supabase rate limits
    for (const { deployment, recentVolume } of tokensNeedingVolumeUpdate) {
      try {
        // Convert transfer count to estimated ETH volume (rough estimate: 0.01 ETH per transfer)
        // TODO: Improve to calculate actual ETH volume from Swap events
        const volume24h = recentVolume * 0.01;
        const volume7d = volume24h * 7; // Rough estimate

        // Get existing volume history
        const volumeHistory = deployment.volumeHistory || [];
        const newVolumeHistory = [...volumeHistory, { volume: volume24h, timestamp: currentTimestamp }];
        if (newVolumeHistory.length > 30) {
          newVolumeHistory.shift(); // Keep last 30 data points
        }

        await updateDeployment(deployment.txHash, {
          volume24h: volume24h,
          volume7d: volume7d,
          volumeHistory: newVolumeHistory
        });

        // Small delay between updates to avoid rate limits (frugal for paid plan)
        await new Promise(resolve => setTimeout(resolve, 150));
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
          console.log(`  ${i + 1}. ${t.deployment.tokenName || 'Token'}: ${t.recentVolume} recent transfers, priority: ${t.priority}`);
        }
      });
    }

    // Process holder count updates sequentially to avoid rate limits
    // Process one token at a time with delays between them
    for (const deployment of toUpdate) {
      // Add delay between tokens (frugal but reasonable for paid plan)
      if (toUpdate.indexOf(deployment) > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between tokens
      }

      await (async () => {
        try {
          let newHolderCount = 0;

          // Try Etherscan API first if available
          if (ETHERSCAN_API_KEY) {
            try {
              const response = await fetch(
                `${ETHERSCAN_API_URL}?module=token&action=tokenholderlist&contractaddress=${deployment.tokenAddress}&apikey=${ETHERSCAN_API_KEY}&page=1&offset=1000`
              );
              const data = await response.json();
              if (data.status === '1' && data.result && Array.isArray(data.result)) {
                newHolderCount = Math.max(newHolderCount, data.result.length);
              }
            } catch (e) {
              // Etherscan API failed, use Transfer event counting
            }
          }

          // Count from Transfer events (more accurate for all holders)
          // Use primary provider (Alchemy paid plan)
          const activeProvider = provider;

          const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
          const holders = new Set();

          // Smart block range selection: for old tokens, only check recent blocks
          // For new tokens, check all blocks from creation
          const fromBlock = deployment.blockNumber;
          const toBlock = currentBlock;
          const blockRange = toBlock - fromBlock;
          const MAX_BLOCKS_TO_CHECK = 500; // Only check last 500 blocks for old tokens

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

          // Paid Alchemy plan allows larger block ranges, but be frugal
          const maxBlockRange = 100; // Paid plan allows much larger ranges, but keep reasonable

          // Limit total chunks to avoid rate limits (max 20 chunks = 2000 blocks per token)
          const maxChunks = Math.min(20, Math.ceil((toBlock - checkFromBlock) / maxBlockRange));
          let chunkFrom = checkFromBlock;
          let chunkCount = 0;
          let rateLimitHit = false;
          let consecutiveErrors = 0;

          while (chunkFrom < toBlock && chunkCount < maxChunks && !rateLimitHit) {
            const chunkTo = Math.min(chunkFrom + maxBlockRange, toBlock);
            try {
              const logs = await activeProvider.getLogs({
                address: deployment.tokenAddress,
                fromBlock: chunkFrom,
                toBlock: chunkTo,
                topics: [transferEventSignature]
              });

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

              consecutiveErrors = 0; // Reset error counter on success

              // Delays between chunks (frugal but reasonable for paid plan)
              if (chunkCount > 0) {
                // Small delay between chunks
                await new Promise(resolve => setTimeout(resolve, 300));
              } else {
                // Small delay before first chunk
                await new Promise(resolve => setTimeout(resolve, 200));
              }
            } catch (e) {
              consecutiveErrors++;

              // If we hit rate limit, stop immediately and wait longer
              if (e.message && (e.message.includes('Too Many Requests') || e.message.includes('exceeded') || e.message.includes('block range'))) {
                rateLimitHit = true;
                console.error(`  ⚠️  Rate limit hit for ${deployment.tokenName || 'token'}, stopping holder check`);
                // Wait 3 seconds before continuing to next token (paid plan allows faster recovery)
                await new Promise(resolve => setTimeout(resolve, 3000));
                break;
              }
              console.error(`  ⚠️  Error fetching logs for blocks ${chunkFrom}-${chunkTo}:`, e.message);

              // Exponential backoff on errors
              const errorDelay = Math.min(5000, 1000 * Math.pow(2, consecutiveErrors));
              await new Promise(resolve => setTimeout(resolve, errorDelay));

              // If too many consecutive errors, stop
              if (consecutiveErrors >= 3) {
                rateLimitHit = true;
                console.error(`  ⚠️  Too many errors for ${deployment.tokenName || 'token'}, stopping`);
                break;
              }
            }
            chunkFrom = chunkTo + 1;
            chunkCount++;
          }

          // For old tokens where we only checked recent blocks, use existing count as base
          if (checkFromBlock > fromBlock && deployment.holderCount) {
            // We checked recent blocks, so we have new holders but not all historical
            // Use the larger of: existing count or recent holders found
            newHolderCount = Math.max(deployment.holderCount, holders.size);
          } else {
            // For new tokens or when we checked all blocks, use the holder set size
            newHolderCount = holders.size;
          }

          // If we hit rate limits, don't update (keep existing count)
          if (rateLimitHit && chunkCount === 0) {
            // Skip this token entirely if we hit rate limit on first chunk
            return;
          }

          // newHolderCount is already set above based on whether we checked all blocks or just recent

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

            await updateDeployment(deployment.txHash, {
              holderCount: newHolderCount,
              holderCountHistory: newHistory,
              lastHolderCheck: currentTimestamp // Track when we last checked
            });

            if (countChanged) {
              const change = newHolderCount - (deployment.holderCount || 0);
              const changePercent = (deployment.holderCount || 0) > 0 ? ((change / (deployment.holderCount || 1)) * 100).toFixed(1) : '∞';
              console.log(`  ✅ ${deployment.tokenName || 'Token'}: ${deployment.holderCount || 0} → ${newHolderCount} (${change > 0 ? '+' : ''}${change}, ${changePercent}%)`);
            } else {
              console.log(`  ✓ ${deployment.tokenName || 'Token'}: ${newHolderCount} holders (no change)`);
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
    const currentBlock = await provider.getBlockNumber();

    // Check deployments that aren't marked as sold yet
    const unsoldDeployments = deployments.filter(d => !d.devSold && d.tokenAddress !== 'N/A' && d.tokenAddress);

    for (const deployment of unsoldDeployments.slice(0, 10)) { // Check max 10 at a time
      try {
        const tokenContract = new ethers.Contract(deployment.tokenAddress, [
          'function decimals() view returns (uint8)'
        ], provider);

        // Check for transfers from deployer in recent blocks
        const transferEventSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const checkBlocks = 100; // Check last 100 blocks

        const logs = await provider.getLogs({
          address: deployment.tokenAddress,
          fromBlock: Math.max(currentBlock - checkBlocks, deployment.blockNumber),
          toBlock: currentBlock,
          topics: [
            transferEventSignature,
            ethers.zeroPadValue(deployment.from, 32) // from address (deployer)
          ]
        });

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
 * Stop monitoring
 */
export function stopMonitoring() {
  isMonitoring = false;
}



