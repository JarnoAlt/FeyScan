import { useState, useEffect } from 'react';
import { useAccount, useBalance } from 'wagmi';
import { formatUnits } from 'viem';
import TokenFeed from './components/TokenFeed';
import WalletConnect from './components/WalletConnect';
import { FEYSCAN_TOKEN_ADDRESS, REQUIRED_BALANCE, isWhitelisted } from './components/WalletConnect';
import { getAllDeployments, getLatestDeployment, supabase } from './config/supabase.js';
import './App.css';
import feyLogo from '/FeyScanner.jpg';

function App() {
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dbStatus, setDbStatus] = useState('checking');
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
      if (!supabase) {
        throw new Error('Supabase not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
      }
      
      const deployments = await getAllDeployments();
      setDeployments(deployments);
      setError(null);
      setDbStatus('online');
    } catch (err) {
      console.error('Error fetching deployments from Supabase:', err);
      setError(err.message);
      setDbStatus('offline');
    } finally {
      setLoading(false);
    }
  };

  const checkDbHealth = async () => {
    try {
      if (!supabase) {
        setDbStatus('offline');
        return;
      }
      
      // Simple query to check connection
      const { error } = await supabase
        .from('deployments')
        .select('tx_hash')
        .limit(1);
      
      if (error) {
        setDbStatus('offline');
      } else {
        setDbStatus('online');
      }
    } catch (err) {
      setDbStatus('offline');
    }
  };

  useEffect(() => {
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Check database health
    checkDbHealth();

    // Initial fetch
    fetchDeployments();

    // Poll every 5 seconds for live updates
    const interval = setInterval(() => {
      fetchDeployments();
    }, 5000);

    // Check health every 30 seconds
    const healthInterval = setInterval(() => {
      checkDbHealth();
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
                    <div className={`status-indicator ${dbStatus}`} title={dbStatus === 'online' ? 'Database Online' : 'Database Offline'}>
                      <span className="status-dot"></span>
                      <span className="status-text">{dbStatus === 'online' ? 'Online' : dbStatus === 'offline' ? 'Offline' : 'Checking...'}</span>
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
          <TokenFeed deployments={deployments} serverStatus={dbStatus} hasEnoughTokens={hasAccess} />
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

