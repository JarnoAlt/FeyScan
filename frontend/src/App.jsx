import { useState, useEffect } from 'react';
import { useAccount, useBalance } from 'wagmi';
import { formatUnits } from 'viem';
import TokenFeed from './components/TokenFeed';
import WalletConnect from './components/WalletConnect';
import { FEYSCAN_TOKEN_ADDRESS, REQUIRED_BALANCE, isWhitelisted } from './components/WalletConnect';
import './App.css';
import feyLogo from '/FeyScanner.jpg';

// Detect environment and use appropriate API URL
const getApiUrl = () => {
  // If we have an explicit API URL in env, use it
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // If on Vercel (or production), use relative API path
  if (import.meta.env.PROD || window.location.hostname.includes('vercel.app')) {
    return '/api';
  }

  // If accessing through ngrok, use the same host for API
  if (window.location.hostname.includes('ngrok')) {
    return `${window.location.protocol}//${window.location.hostname}/api`;
  }

  // Default to localhost for local development
  return 'http://localhost:3001';
};

const API_URL = getApiUrl();

function App() {
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [serverStatus, setServerStatus] = useState('checking');
  const { address, isConnected } = useAccount();

  // Wagmi automatically handles account changes - no manual listeners needed

  // Check token balance for gating
  const { data: tokenBalance } = useBalance({
    address: address,
    token: FEYSCAN_TOKEN_ADDRESS,
    chainId: 8453, // Base mainnet
    query: {
      enabled: isConnected && !!address,
    },
  });

  const isWhitelistedDev = address && isWhitelisted(address);
  const hasEnoughTokens = tokenBalance && tokenBalance.value >= REQUIRED_BALANCE;
  const hasAccess = isWhitelistedDev || hasEnoughTokens;

  const fetchDeployments = async () => {
    try {
      // Use relative URL if on production/Vercel or ngrok, otherwise use full API_URL
      const apiEndpoint = (import.meta.env.PROD || window.location.hostname.includes('ngrok') || window.location.hostname.includes('vercel.app'))
        ? '/api/deployments'
        : `${API_URL}/api/deployments`;

      const response = await fetch(apiEndpoint);
      if (!response.ok) {
        throw new Error('Failed to fetch deployments');
      }
      const data = await response.json();
      const deployments = data.deployments || [];
      setDeployments(deployments);
      setError(null);
      setServerStatus('online');
    } catch (err) {
      console.error('Error fetching deployments:', err);
      setError(err.message);
      setServerStatus('offline');
    } finally {
      setLoading(false);
    }
  };

  const checkServerHealth = async () => {
    try {
      const healthEndpoint = (import.meta.env.PROD || window.location.hostname.includes('ngrok') || window.location.hostname.includes('vercel.app'))
        ? '/api/health'
        : `${API_URL}/api/health`;

      const response = await fetch(healthEndpoint, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        setServerStatus('online');
      } else {
        setServerStatus('offline');
      }
    } catch (err) {
      setServerStatus('offline');
    }
  };

  useEffect(() => {
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Check server health
    checkServerHealth();

    // Initial fetch
    fetchDeployments();

    // Poll every 5 seconds for live updates
    const interval = setInterval(() => {
      fetchDeployments();
    }, 5000);

    // Check health every 30 seconds
    const healthInterval = setInterval(() => {
      checkServerHealth();
    }, 30000);

    return () => {
      clearInterval(interval);
      clearInterval(healthInterval);
    };
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-content">
                <div className="header-main">
                  <div className="title-row">
                    <img src={feyLogo} alt="Fey Scanner" className="fey-logo" />
                    <h1>Fey Token Launchpad Monitor</h1>
                    <div className={`status-indicator ${serverStatus}`} title={serverStatus === 'online' ? 'Server Online' : 'Server Offline'}>
                      <span className="status-dot"></span>
                      <span className="status-text">{serverStatus === 'online' ? 'Online' : serverStatus === 'offline' ? 'Offline' : 'Checking...'}</span>
                    </div>
                    <div className="wallet-connect-wrapper">
                      <WalletConnect />
                    </div>
                  </div>
            <p className="subtitle">Live monitoring of token deployments on Base Network</p>
            <p className="token-address">
              FeyScan Token: <code onClick={() => {
                navigator.clipboard.writeText('0x1a013768E7c572d6F7369a3e5bC9b29b0a0f0659');
                alert('Token address copied!');
              }}>0x1a013768E7c572d6F7369a3e5bC9b29b0a0f0659</code>
            </p>
          </div>
          <div className="donation-section">
            <div className="donation-header">
              <span className="donation-icon">💝</span>
              <span className="donation-title">Support the Dev</span>
            </div>
            <div className="donation-wallet">
              <div className="wallet-info">
                <span className="wallet-label">Send to:</span>
                <code className="wallet-address" onClick={() => {
                  navigator.clipboard.writeText('0x8DFBdEEC8c5d4970BB5F481C6ec7f73fa1C65be5');
                  alert('Wallet address copied!');
                }}>
                  ionoi.eth
                </code>
                <button
                  className="copy-wallet-btn"
                  onClick={() => {
                    navigator.clipboard.writeText('0x8DFBdEEC8c5d4970BB5F481C6ec7f73fa1C65be5');
                    alert('Wallet address copied!');
                  }}
                  title="Copy wallet address"
                >
                  📋
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="App-main">
        {loading && <div className="loading">Loading deployments...</div>}
        {error && <div className="error">Error: {error}</div>}
        {!loading && !error && (
          <TokenFeed deployments={deployments} serverStatus={serverStatus} hasEnoughTokens={hasAccess} />
        )}
      </main>

      <footer className="App-footer">
        <div className="footer-content">
          <p className="footer-text">
            Fey Launcher Contract: <code>0x8EEF0dC80ADf57908bB1be0236c2a72a7e379C2d</code>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;

