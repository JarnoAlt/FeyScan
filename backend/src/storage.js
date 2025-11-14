import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../../data/deployments.json');
const STATE_FILE = path.join(__dirname, '../../data/monitor-state.json');
const MAX_ENTRIES = 1000;

/**
 * Read deployments from JSON file
 */
export function readDeployments() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { deployments: [] };
    }
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading deployments:', error);
    return { deployments: [] };
  }
}

/**
 * Write deployments to JSON file
 */
export function writeDeployments(data) {
  try {
    // Ensure data directory exists
    const dataDir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error writing deployments:', error);
    return false;
  }
}

/**
 * Add a new deployment (prevents duplicates)
 */
export function addDeployment(newDeployment) {
  const data = readDeployments();
  const deployments = data.deployments || [];

  // Check for duplicate by transaction hash
  const exists = deployments.some(d => d.txHash === newDeployment.txHash);
  if (exists) {
    return false; // Duplicate
  }

  // Add new deployment at the beginning (most recent first)
  deployments.unshift(newDeployment);

  // Keep only the most recent MAX_ENTRIES
  if (deployments.length > MAX_ENTRIES) {
    deployments.splice(MAX_ENTRIES);
  }

  data.deployments = deployments;
  writeDeployments(data);
  return true;
}

/**
 * Get all deployments
 */
export function getAllDeployments() {
  const data = readDeployments();
  return data.deployments || [];
}

/**
 * Get latest deployment
 */
export function getLatestDeployment() {
  const deployments = getAllDeployments();
  return deployments.length > 0 ? deployments[0] : null;
}

/**
 * Update an existing deployment
 */
export function updateDeployment(txHash, updates) {
  const data = readDeployments();
  const deployments = data.deployments || [];

  const index = deployments.findIndex(d => d.txHash === txHash);
  if (index === -1) {
    return false; // Deployment not found
  }

  // Update the deployment
  deployments[index] = { ...deployments[index], ...updates };

  data.deployments = deployments;
  writeDeployments(data);
  return true;
}

/**
 * Save monitor state (last checked block)
 */
export function saveMonitorState(state) {
  try {
    const dataDir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving monitor state:', error);
    return false;
  }
}

/**
 * Load monitor state (last checked block)
 */
export function loadMonitorState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return { lastCheckedBlock: null };
    }
    const data = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading monitor state:', error);
    return { lastCheckedBlock: null };
  }
}

