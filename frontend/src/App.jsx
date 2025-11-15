import { useState, useEffect } from 'react';
import { useAccount, useBalance } from 'wagmi';
import { formatUnits } from 'viem';
import TokenFeed from './components/TokenFeed';
import WalletConnect from './components/WalletConnect';
import MessageBoard from './components/MessageBoard';
import { FEYSCAN_TOKEN_ADDRESS, REQUIRED_BALANCE, isWhitelisted } from './components/WalletConnect';
import { getAllDeployments, getLatestDeployment, supabase } from './config/supabase.js';
import './App.css';
import feyLogo from '/FeyScanner.jpg';

function App() {
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dbStatus, setDbStatus] = useState('checking');
  const [showAbout, setShowAbout] = useState(false);
  const [seenDeployments, setSeenDeployments] = useState(new Set());
  const [isMuted, setIsMuted] = useState(false);
  const [isSupportExpanded, setIsSupportExpanded] = useState(false);
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

  // Different thresholds for different sections
  const ALERTS_THRESHOLD = 25000000n; // 25M
  const HOT_RUNNERS_THRESHOLD = 15000000n; // 15M
  const NEWEST_5_THRESHOLD = 10000000n; // 10M
  const ALL_DEPLOYMENTS_THRESHOLD = 5000000n; // 5M

  const hasAlertsAccess = isWhitelistedDev || (tokenBalance && tokenBalance.value >= ALERTS_THRESHOLD);
  const hasHotRunnersAccess = isWhitelistedDev || (tokenBalance && tokenBalance.value >= HOT_RUNNERS_THRESHOLD);
  const hasNewest5Access = isWhitelistedDev || (tokenBalance && tokenBalance.value >= NEWEST_5_THRESHOLD);
  const hasAllDeploymentsAccess = isWhitelistedDev || (tokenBalance && tokenBalance.value >= ALL_DEPLOYMENTS_THRESHOLD);

  const playDeploymentSound = () => {
    if (isMuted) return;

    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // Play a distinctive "new deployment" sound - ascending chime
      const playTone = (frequency, startTime, duration, volume = 0.3) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
      };

      // Play ascending three-tone chime for new deployment
      const baseTime = audioContext.currentTime;
      playTone(600, baseTime, 0.2, 0.3);
      playTone(800, baseTime + 0.1, 0.2, 0.35);
      playTone(1000, baseTime + 0.2, 0.3, 0.4);
    } catch (e) {
      // Fallback: browser notification if audio fails
      if (Notification.permission === 'granted') {
        new Notification('🚀 New Token Deployment', {
          body: 'A new token has been deployed!',
          icon: '🚀'
        });
      }
    }
  };

  const fetchDeployments = async () => {
    try {
      if (!supabase) {
        throw new Error('Supabase not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
      }

      console.log('🔄 Fetching deployments from database...');
      const newDeployments = await getAllDeployments();
      console.log(`✅ Successfully loaded ${newDeployments.length} deployments`);

      if (newDeployments.length === 0) {
        console.warn('⚠️  No deployments found in database. This is normal if the backend hasn\'t populated data yet.');
      }

      // Check for new deployments (not seen before)
      // Only check if we already have seen deployments (to avoid beeping on initial load)
      if (seenDeployments.size > 0 && newDeployments.length > 0) {
        const newDeploymentHashes = new Set();
        newDeployments.forEach(deployment => {
          if (deployment.txHash && !seenDeployments.has(deployment.txHash)) {
            // New deployment detected!
            newDeploymentHashes.add(deployment.txHash);
          }
        });

        // Only play sound once if there are truly new deployments
        if (newDeploymentHashes.size > 0) {
          console.log(`🔔 New deployment(s) detected: ${newDeploymentHashes.size} new token(s)`);
          playDeploymentSound();
        }
      }

      // Update seen deployments AFTER checking for new ones
      // Use functional update to ensure we're working with the latest state
      setSeenDeployments(prevSeen => {
        const newSeenSet = new Set(prevSeen);
        newDeployments.forEach(deployment => {
          if (deployment.txHash) {
            newSeenSet.add(deployment.txHash);
          }
        });
        return newSeenSet;
      });

      setDeployments(newDeployments);
      setError(null);
      setDbStatus('online');
    } catch (err) {
      console.error('❌ Error fetching deployments from Supabase:', err);
      console.error('Error details:', {
        message: err.message,
        stack: err.stack,
        name: err.name
      });
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

    // Poll every 15 seconds for live updates (reduced frequency to avoid excessive API calls)
    const interval = setInterval(() => {
      fetchDeployments();
    }, 15000);

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

          {/* *** CHANGED *** */}
          <div className="header-top">
            <div className="brand-row">
              <img src={feyLogo} alt="Fey Scanner" className="fey-logo" />
              <span className="brand-title">FEYSCAN</span>
            </div>
            <div
              className="wallet-connect-wrapper"
              style={{ transform: 'scale(0.8)', transformOrigin: 'top right' }} // *** CHANGED ***
            >
              <WalletConnect />
            </div>
          </div>
          {/* *** END CHANGED *** */}

          <div className="header-main">
            {/* *** CHANGED *** */}
            <div className="monitor-section">
              <h1 className="monitor-title">Fey Token Launchpad Monitor</h1>
              <div
                className={`status-indicator ${dbStatus} status-below-title`}
                title={dbStatus === 'online' ? 'Database Online' : 'Database Offline'}
              >
                <span className="status-dot"></span>
                <span className="status-text">
                  {dbStatus === 'online'
                    ? 'Online'
                    : dbStatus === 'offline'
                    ? 'Offline'
                    : 'Checking...'}
                </span>
              </div>
            </div>

            <p className="subtitle">
              Live monitoring of token deployments on Base Network &mdash; track fresh launches,
              holder trends, and dev activity from the Fey launchpad in real time.
            </p>
            {/* *** END CHANGED *** */}

            {/* *** CHANGED *** */}
            <div className="buy-section">
              <div className="token-hub-header">
                <h2 className="token-hub-title">Token Hub</h2>
                <p className="token-hub-subtitle">Buy FeyScan ($FSCN)</p>
              </div>

              <div className="buy-buttons">
                <a
                  href="https://app.uniswap.org/#/tokens/base/0x1a013768E7c572d6F7369a3e5bC9b29b0a0f0659"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="buy-button primary"
                >
                  🚀 Buy FeyScan
                </a>
                <a
                  href="https://app.uniswap.org/#/swap?chain=base&outputCurrency=0x1a013768E7c572d6F7369a3e5bC9b29b0a0f0659"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="buy-button secondary"
                >
                  📊 Trade Page
                </a>
                <a
                  href="https://basescan.org/token/0x1a013768E7c572d6F7369a3e5bC9b29b0a0f0659"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="buy-button tertiary"
                >
                  🔍 Explorer
                </a>
              </div>

              <button
                className="token-address-display"
                onClick={() => {
                  navigator.clipboard.writeText('0x1a013768E7c572d6F7369a3e5bC9b29b0a0f0659');
                  alert('Token address copied!');
                }}
                title="Click to copy token address"
              >
                <span className="token-label">FeyScan Token</span>
                <code className="token-address-code">
                  0x1a013768E7c5…0f0659
                </code>
                <span className="token-copy-hint">Tap to copy</span>
              </button>
            </div>
            {/* *** END CHANGED *** */}
          </div>

          <div className="donation-section">
            <div
              className="donation-header clickable"
              onClick={() => setIsSupportExpanded(!isSupportExpanded)}
            >
              <span className="donation-icon">💝</span>
              <span className="donation-title">Support the Dev</span>
              <span className="donation-preview">
                {!isSupportExpanded && '• Donation • Links • Message Board'}
              </span>
              <span className="expand-icon">{isSupportExpanded ? '▼' : '▶'}</span>
            </div>
            {isSupportExpanded && (
              <div className="donation-content">
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
                  <div className="donation-links">
                    <a
                      href="https://github.com/dutchiono/FeyScan"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="donation-link github-link"
                      title="View on GitHub"
                    >
                      <span className="link-icon">🔗</span>
                      <span>GitHub</span>
                    </a>
                    <a
                      href="https://warpcast.com/ionoi"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="donation-link farcaster-link"
                      title="Follow on Farcaster"
                    >
                      <span className="link-icon">🔗</span>
                      <span>Farcaster</span>
                    </a>
                    <a
                      href="https://x.com/FeyScan"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="donation-link twitter-link"
                      title="Follow on X (Twitter)"
                    >
                      <span className="link-icon">🔗</span>
                      <span>X (Twitter)</span>
                    </a>
                    <button
                      className="donation-link about-link"
                      onClick={() => setShowAbout(true)}
                      title="About FeyScan"
                    >
                      <span className="link-icon">ℹ️</span>
                      <span>About</span>
                    </button>
                  </div>
                </div>
                <MessageBoard />
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="App-main">
        {loading && <div className="loading">Loading deployments...</div>}
        {error && <div className="error">Error: {error}</div>}
        {!loading && !error && (
          <TokenFeed
            deployments={deployments}
            serverStatus={dbStatus}
            hasEnoughTokens={hasEnoughTokens}
            hasAccess={hasAccess}
            hasAlertsAccess={hasAlertsAccess}
            hasHotRunnersAccess={hasHotRunnersAccess}
            hasNewest5Access={hasNewest5Access}
            hasAllDeploymentsAccess={hasAllDeploymentsAccess}
            onMuteChange={setIsMuted}
          />
        )}
      </main>

      {/* About Modal */}
      {showAbout && (
        <div className="modal-overlay" onClick={() => setShowAbout(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>About FeyScan</h2>
              <button className="modal-close" onClick={() => setShowAbout(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>
                <strong>FeyScan</strong> is a real-time monitoring dashboard for token deployments on the Fey launchpad on Base Network.
              </p>
              <h3>Features</h3>
              <ul>
                <li>Live token deployment tracking</li>
                <li>Holder count monitoring with trend indicators</li>
                <li>Dev buy alerts (notifications for high dev buys &gt; 0.25 ETH)</li>
                <li>Priority-based holder checking (focuses on high-volume tokens)</li>
                <li>Advanced filtering (hide zero dev buys, remove duplicates, filter serial deployers)</li>
                <li>Token gating (requires 10M FeyScan tokens for premium features)</li>
              </ul>
              <h3>Tech Stack</h3>
              <ul>
                <li><strong>Frontend:</strong> React + Vite</li>
                <li><strong>Backend:</strong> Node.js + Express</li>
                <li><strong>Database:</strong> Supabase (PostgreSQL)</li>
                <li><strong>Blockchain:</strong> ethers.js (Base Network)</li>
                <li><strong>RPC Providers:</strong> Alchemy, Infura</li>
              </ul>
              <h3>Links</h3>
              <div className="modal-links">
                <a
                  href="https://github.com/dutchiono/FeyScan"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="modal-link"
                >
                  🔗 GitHub Repository
                </a>
                <a
                  href="https://warpcast.com/ionoi"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="modal-link"
                >
                  🔗 Farcaster (@ionoi)
                </a>
                <a
                  href="https://x.com/FeyScan"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="modal-link"
                >
                  🔗 X (Twitter) @FeyScan
                </a>
                <a
                  href="https://basescan.org/address/0x8EEF0dC80ADf57908bB1be0236c2a72a7e379C2d"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="modal-link"
                >
                  🔗 Fey Launcher Contract
                </a>
                <a
                  href="https://basescan.org/address/0x1a013768E7c572d6F7369a3e5bC9b29b0a0f0659"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="modal-link"
                >
                  🔗 FeyScan Token
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

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
