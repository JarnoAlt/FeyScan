import { useState, useMemo, useEffect } from 'react';
import './TokenFeed.css';

// Component to show live updating time
function LiveTime({ timestamp }) {
  const [timeSince, setTimeSince] = useState(() => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  });

  useEffect(() => {
    const updateTime = () => {
      const now = Math.floor(Date.now() / 1000);
      const diff = now - timestamp;
      if (diff < 60) {
        setTimeSince(`${diff}s`);
      } else if (diff < 3600) {
        setTimeSince(`${Math.floor(diff / 60)}m`);
      } else if (diff < 86400) {
        setTimeSince(`${Math.floor(diff / 3600)}h`);
      } else {
        setTimeSince(`${Math.floor(diff / 86400)}d`);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000); // Update every second
    return () => clearInterval(interval);
  }, [timestamp]);

  return <span>{timeSince}</span>;
}

// Component to show live updating time since last holder check
function HolderCheckTime({ lastCheckTime }) {
  const [timeSince, setTimeSince] = useState(() => {
    if (!lastCheckTime) return 'Never';
    const now = Math.floor(Date.now() / 1000);
    const diff = now - lastCheckTime;
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  });

  useEffect(() => {
    if (!lastCheckTime) {
      setTimeSince('Never');
      return;
    }

    const updateTime = () => {
      const now = Math.floor(Date.now() / 1000);
      const diff = now - lastCheckTime;
      if (diff < 60) {
        setTimeSince(`${diff}s`);
      } else if (diff < 3600) {
        setTimeSince(`${Math.floor(diff / 60)}m`);
      } else if (diff < 86400) {
        setTimeSince(`${Math.floor(diff / 3600)}h`);
      } else {
        setTimeSince(`${Math.floor(diff / 86400)}d`);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000); // Update every second
    return () => clearInterval(interval);
  }, [lastCheckTime]);

  return (
    <div className="holder-update-time" title={lastCheckTime ? `Last checked: ${new Date(lastCheckTime * 1000).toLocaleString()}` : 'Never checked'}>
      {timeSince}
    </div>
  );
}

function TokenFeed({
  deployments,
  hasEnoughTokens = false,
  hasAccess = false,
  hasAlertsAccess = false,
  hasHotRunnersAccess = false,
  hasNewest5Access = false,
  hasAllDeploymentsAccess = false,
  onMuteChange
}) {
  const [sortField, setSortField] = useState('timestamp');
  const [sortDirection, setSortDirection] = useState('desc');
  const [ensNames, setEnsNames] = useState({});
  const [playedAlerts, setPlayedAlerts] = useState(new Set());
  const [devBuyThreshold, setDevBuyThreshold] = useState('');
  const [hideZeroDevBuy, setHideZeroDevBuy] = useState(false); // Default OFF
  const [removeDuplicates, setRemoveDuplicates] = useState(true); // Default ON
  const [removeSerialDeployers, setRemoveSerialDeployers] = useState(true); // Default ON
  const [hideDeadTokens, setHideDeadTokens] = useState(false); // Default OFF
  const [isMuted, setIsMuted] = useState(false);
  const [serverStatus, setServerStatus] = useState('checking');
  const [notifiedAboutMissingAlerts, setNotifiedAboutMissingAlerts] = useState(new Set());
  const [showScoreHelp, setShowScoreHelp] = useState(false);
  const [isAlertsCollapsed, setIsAlertsCollapsed] = useState(false);
  const [isHotRunnersCollapsed, setIsHotRunnersCollapsed] = useState(false);
  const [isNewest5Collapsed, setIsNewest5Collapsed] = useState(false);
  const [isAllDeploymentsCollapsed, setIsAllDeploymentsCollapsed] = useState(false);

  // Sync mute state with parent
  const handleMuteToggle = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    if (onMuteChange) {
      onMuteChange(newMuted);
    }
  };

  const formatTimeAgo = (timestamp) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  };

  const formatVolume = (volume) => {
    if (!volume || volume === 0) return '-';
    if (volume >= 1) return `${volume.toFixed(2)} ETH`;
    if (volume >= 0.01) return `${volume.toFixed(3)} ETH`;
    return `<0.01 ETH`;
  };

  const formatMarketCap = (mcap) => {
    // Handle null, undefined, or invalid values
    if (mcap === null || mcap === undefined || mcap === '' || mcap === 'N/A') return '-';

    // Convert to number if it's a string
    const numValue = typeof mcap === 'string' ? parseFloat(mcap) : Number(mcap);

    // Check if it's a valid number
    if (isNaN(numValue) || !isFinite(numValue) || numValue === 0) return '-';

    // Format the number
    if (numValue >= 1000000) return `$${(numValue / 1000000).toFixed(2)}M`;
    if (numValue >= 1000) return `$${(numValue / 1000).toFixed(2)}K`;
    return `$${numValue.toFixed(2)}`;
  };

  // Score Help Modal Component
  const ScoreHelpModal = () => (
    <div className="modal-overlay" onClick={() => setShowScoreHelp(false)}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Runner Score Calculation</h2>
          <button className="modal-close" onClick={() => setShowScoreHelp(false)}>×</button>
        </div>
        <div className="modal-body">
          <p>The <strong>Runner Score</strong> identifies tokens with high activity and growth potential.</p>

          <h3>Formula</h3>
          <div className="score-formula">
            <code>
              Score = (Volume 24h × 0.4) + (Growth % × 0.4) + (Absolute Growth × 0.2)
            </code>
          </div>

          <h3>Components</h3>
          <ul>
            <li>
              <strong>Volume 24h (40% weight):</strong> Trading volume in ETH over the last 24 hours.
              Higher volume indicates more market activity.
            </li>
            <li>
              <strong>Growth % (40% weight):</strong> Percentage increase in holder count.
              Normalized: 10% growth = 1.0 point, capped at 100% growth = 10 points.
              Formula: <code>(Current Holders - Previous Holders) / Previous Holders × 100</code>
            </li>
            <li>
              <strong>Absolute Growth (20% weight):</strong> Raw number of new holders added.
              Capped at 50 holders = 10 points.
              Formula: <code>Current Holders - Previous Holders</code>
            </li>
          </ul>

          <h3>Score Interpretation</h3>
          <ul>
            <li><strong>0.0 - 0.2:</strong> Low activity</li>
            <li><strong>0.2 - 0.5:</strong> Moderate activity</li>
            <li><strong>0.5 - 1.0:</strong> High activity</li>
            <li><strong>1.0+:</strong> Very high activity (Hot Runner)</li>
          </ul>

          <h3>Example</h3>
          <p>
            A token with 0.5 ETH volume, 25% holder growth (from 20 to 25 holders),
            and 5 new holders would score:
          </p>
          <div className="score-formula">
            <code>
              (0.5 × 0.4) + (2.5 × 0.4) + (5 × 0.2) = 0.2 + 1.0 + 1.0 = <strong>2.2</strong>
            </code>
          </div>
        </div>
      </div>
    </div>
  );

  // Calculate runner score: combines volume, holder growth %, and absolute growth
  const calculateRunnerScore = (deployment) => {
    const volume24h = deployment.volume24h || 0;

    // Calculate holder growth
    let growthPercent = 0;
    let absGrowth = 0;
    const history = deployment.holderCountHistory || [];
    if (history.length >= 2) {
      const recent = history[history.length - 1];
      const previous = history[history.length - 2];
      const currentCount = recent.count || 0;
      const previousCount = previous.count || 0;
      absGrowth = currentCount - previousCount;
      growthPercent = previousCount > 0 ? (absGrowth / previousCount) * 100 : (absGrowth > 0 ? 100 : 0);
    }

    // Normalize values for scoring
    // Volume: use as-is (already in ETH)
    // Growth %: divide by 10 to normalize (so 10% = 1.0)
    // Abs growth: use as-is but cap at 50 for scoring
    const normalizedGrowth = Math.min(growthPercent / 10, 10); // Cap at 100% growth = 10 points
    const normalizedAbsGrowth = Math.min(absGrowth, 50); // Cap at 50 holders growth

    // Score formula: (volume24h * 0.4) + (growthPercent * 0.4) + (absGrowth * 0.2)
    const score = (volume24h * 0.4) + (normalizedGrowth * 0.4) + (normalizedAbsGrowth * 0.2);

    return {
      score: Math.max(0, score), // Ensure non-negative
      volume24h,
      growthPercent,
      absGrowth
    };
  };

  const truncateAddress = (address) => {
    if (!address || address === 'N/A') return 'N/A';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  // Use ENS names from backend data
  useEffect(() => {
    const newEnsNames = {};
    deployments.forEach(d => {
      if (d.from && d.ensName) {
        newEnsNames[d.from.toLowerCase()] = d.ensName;
      }
    });
    setEnsNames(prev => ({ ...prev, ...newEnsNames }));
  }, [deployments]);

  // Filter deployments based on all filters
  const filteredDeployments = useMemo(() => {
    let filtered = [...deployments];

    // Filter by dev buy threshold
    if (devBuyThreshold !== '' && !isNaN(parseFloat(devBuyThreshold))) {
      const threshold = parseFloat(devBuyThreshold);
      filtered = filtered.filter(d => (d.devBuyAmount || 0) >= threshold);
    }

    // Filter out zero dev buys if checkbox is checked
    if (hideZeroDevBuy) {
      filtered = filtered.filter(d => (d.devBuyAmount || 0) > 0);
    }

    // Remove duplicates by token name (keep first occurrence)
    if (removeDuplicates) {
      const seen = new Set();
      filtered = filtered.filter(d => {
        const name = (d.tokenName || 'Unknown').toLowerCase();
        if (seen.has(name)) {
          return false;
        }
        seen.add(name);
        return true;
      });
    }

    // Remove serial deployers (wallets that deployed 2+ tokens)
    if (removeSerialDeployers) {
      // Count deployments per wallet address
      const deployerCounts = new Map();
      deployments.forEach(d => {
        if (d.from) {
          const addr = d.from.toLowerCase();
          deployerCounts.set(addr, (deployerCounts.get(addr) || 0) + 1);
        }
      });

      // Find serial deployers (2+ deployments)
      const serialDeployers = new Set();
      deployerCounts.forEach((count, addr) => {
        if (count >= 2) {
          serialDeployers.add(addr);
        }
      });

      // Filter out all deployments from serial deployers
      if (serialDeployers.size > 0) {
        filtered = filtered.filter(d => {
          if (!d.from) return true;
          return !serialDeployers.has(d.from.toLowerCase());
        });
      }
    }

    // Hide dead tokens (tokens with no activity)
    // IMPORTANT: Never hide tokens less than 5 minutes old (they're still being processed)
    if (hideDeadTokens) {
      const now = Math.floor(Date.now() / 1000);
      filtered = filtered.filter(d => {
        const age = now - d.timestamp;
        const holderCount = d.holderCount || 0;
        const volume24h = d.volume24h || 0;
        const volume1h = d.volume1h || 0;
        const volume6h = d.volume6h || 0;
        const marketCap = d.marketCap || 0;

        // Never hide tokens less than 5 minutes old (still being processed)
        if (age < 300) {
          return true;
        }

        // A token is "dead" if:
        // - Older than 1 hour AND
        // - Has <=5 holders AND
        // - No volume (all volume metrics are 0) AND
        // - No market cap (or market cap is 0)
        const isDead = age > 3600 &&
                      holderCount <= 5 &&
                      volume24h === 0 &&
                      volume1h === 0 &&
                      volume6h === 0 &&
                      marketCap === 0;

        return !isDead;
      });
    }

    return filtered;
  }, [deployments, devBuyThreshold, hideZeroDevBuy, removeDuplicates, removeSerialDeployers, hideDeadTokens]);

  // Get alerts (dev buy > 0.25 ETH) - exclude dev sold items, apply filters
  const alerts = useMemo(() => {
    return filteredDeployments
      .filter(d => d.devBuyAmount > 0.25 && !d.devSold)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [filteredDeployments]);

  // Play bell sound for new alerts (only if not muted and has token access)
  useEffect(() => {
    if (isMuted || !hasAlertsAccess) return; // Don't play sound if muted or no token access

    alerts.forEach(alert => {
      if (!playedAlerts.has(alert.txHash)) {
        const isHighValue = (alert.devBuyAmount || 0) > 1.0;

        // Play bell sound using Web Audio API
        try {
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();

          if (isHighValue) {
            // High value alert (>1 ETH): Play two-tone chime
            const playTone = (frequency, startTime, duration) => {
              const oscillator = audioContext.createOscillator();
              const gainNode = audioContext.createGain();

              oscillator.connect(gainNode);
              gainNode.connect(audioContext.destination);

              oscillator.frequency.value = frequency;
              oscillator.type = 'sine';

              gainNode.gain.setValueAtTime(0, startTime);
              gainNode.gain.linearRampToValueAtTime(0.4, startTime + 0.05);
              gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

              oscillator.start(startTime);
              oscillator.stop(startTime + duration);
            };

            // Play two tones: higher pitch for high value
            playTone(1000, audioContext.currentTime, 0.3);
            playTone(1200, audioContext.currentTime + 0.15, 0.3);
          } else {
            // Regular alert (0.25-1 ETH): Single tone
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 800;
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
          }
        } catch (e) {
          // Fallback: browser notification if audio fails
          if (Notification.permission === 'granted') {
            new Notification(`High Dev Buy Alert: ${alert.devBuyAmountFormatted}`, {
              body: `${alert.tokenName || 'Unknown Token'}`,
              icon: isHighValue ? '💰' : '🔔'
            });
          }
        }
        setPlayedAlerts(prev => new Set([...prev, alert.txHash]));
      }
    });
  }, [alerts, playedAlerts, isMuted, hasAlertsAccess]);

  // Notify users about missing alerts if they don't have token access
  useEffect(() => {
    if (isMuted || hasAlertsAccess || alerts.length === 0) return; // Don't notify if muted, has access, or no alerts

    // Create a unique key for this alert set (based on count and newest alert)
    const alertKey = alerts.length > 0
      ? `${alerts.length}-${alerts[0].txHash}`
      : `${alerts.length}`;

    if (!notifiedAboutMissingAlerts.has(alertKey)) {
      // Play a different sound to indicate they're missing alerts
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Play a lower, more urgent tone to indicate missing content
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 600; // Lower pitch for "missing something" alert
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.6);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.6);
      } catch (e) {
        // Fallback: browser notification
        if (Notification.permission === 'granted') {
          new Notification('🔒 Alerts Available', {
            body: `You're missing ${alerts.length} high-value alert${alerts.length > 1 ? 's' : ''}. Hold 25M FeyScan tokens to view them.`,
            icon: '🔔'
          });
        }
      }

      setNotifiedAboutMissingAlerts(prev => new Set([...prev, alertKey]));
    }
  }, [alerts, hasAlertsAccess, isMuted, notifiedAboutMissingAlerts]);

  // Calculate runners: tokens with high volume and growing holder counts
  const runners = useMemo(() => {
    return filteredDeployments
      .map(deployment => ({
        ...deployment,
        runnerData: calculateRunnerScore(deployment)
      }))
      .filter(d => d.runnerData.score > 0.1) // Threshold for runner
      .sort((a, b) => b.runnerData.score - a.runnerData.score)
      .slice(0, 10); // Top 10 runners
  }, [filteredDeployments]);

  // Get newest 5 from filtered (with runner data)
  const newest5 = useMemo(() => {
    return [...filteredDeployments]
      .map(d => ({
        ...d,
        runnerData: calculateRunnerScore(d)
      }))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
  }, [filteredDeployments]);

  // Get all deployments, sorted (excluding tokens in Hot Runners or Alerts)
  const sortedDeployments = useMemo(() => {
    // Get txHashes of tokens in Hot Runners and Alerts to exclude them
    const runnerTxHashes = new Set(runners.map(r => r.txHash));
    const alertTxHashes = new Set(alerts.map(a => a.txHash));
    const excludedTxHashes = new Set([...runnerTxHashes, ...alertTxHashes]);

    // Filter out tokens that are in Hot Runners or Alerts
    const rest = filteredDeployments
      .filter(d => !excludedTxHashes.has(d.txHash))
      .map(d => ({
        ...d,
        runnerData: calculateRunnerScore(d)
      }));
    return [...rest].sort((a, b) => {
      let aVal, bVal;
      switch (sortField) {
        case 'devBuyAmount':
          aVal = a.devBuyAmount || 0;
          bVal = b.devBuyAmount || 0;
          break;
        case 'timestamp':
          aVal = a.timestamp || 0;
          bVal = b.timestamp || 0;
          break;
        case 'tokenName':
          aVal = (a.tokenName || '').toLowerCase();
          bVal = (b.tokenName || '').toLowerCase();
          break;
        case 'holderCount':
          aVal = a.holderCount || 0;
          bVal = b.holderCount || 0;
          break;
        case 'volume1h':
          aVal = a.volume1h || 0;
          bVal = b.volume1h || 0;
          break;
        case 'volume6h':
          aVal = a.volume6h || 0;
          bVal = b.volume6h || 0;
          break;
        case 'volume24h':
          aVal = a.volume24h || 0;
          bVal = b.volume24h || 0;
          break;
        case 'marketCap':
          aVal = a.marketCap || 0;
          bVal = b.marketCap || 0;
          break;
        case 'runnerScore':
          aVal = a.runnerData?.score || 0;
          bVal = b.runnerData?.score || 0;
          break;
        default:
          aVal = a.timestamp || 0;
          bVal = b.timestamp || 0;
      }
      if (sortDirection === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
      }
    });
  }, [filteredDeployments, runners, alerts, sortField, sortDirection]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortArrow = ({ field }) => {
    if (sortField !== field) return null;
    return <span>{sortDirection === 'asc' ? ' ↑' : ' ↓'}</span>;
  };

  const getENSName = (address) => {
    if (!address) return null;
    return ensNames[address.toLowerCase()] || null;
  };

  // Mobile Deployment Card Component
  const MobileDeploymentCard = ({ deployment }) => {
    const ensName = getENSName(deployment.from);
    const history = deployment.holderCountHistory || [];
    const holderTrend = history.length >= 2 ? (() => {
      const recent = history[history.length - 1];
      const previous = history[history.length - 2];
      const change = recent.count - previous.count;
      const changePercent = previous.count > 0 ? (change / previous.count) * 100 : 0;
      return { change, changePercent, isRapid: Math.abs(changePercent) > 20 };
    })() : null;

    return (
      <div className="mobile-deployment-card">
        {/* Row 1: Token Name, Age, Holders, Growth */}
        <div className="mobile-card-row-1">
          <div className="mobile-card-title-section">
            <div className="mobile-card-title">{deployment.tokenName || 'Unknown'}</div>
            <div className="mobile-card-age">
              <LiveTime timestamp={deployment.timestamp} />
            </div>
          </div>
          <div className="mobile-card-metrics-section">
            <div className="mobile-card-metric">
              <span className="mobile-card-metric-label">Holders:</span>
              <div className="mobile-card-metric-value">
                <span className={`holder-count-number ${holderTrend?.change > 0 ? 'up' : holderTrend?.change < 0 ? 'down' : ''} ${holderTrend?.isRapid ? 'rapid' : ''}`}>
                  {deployment.holderCount !== undefined ? deployment.holderCount : '-'}
                </span>
                {holderTrend && holderTrend.change > 0 && (
                  <span className={`holder-trend up ${holderTrend.isRapid ? 'rapid' : ''}`}>↑</span>
                )}
                {holderTrend && holderTrend.change < 0 && (
                  <span className={`holder-trend down`}>↓</span>
                )}
              </div>
            </div>
            <div className="mobile-card-metric">
              <span className="mobile-card-metric-label">Growth:</span>
              <span className="mobile-card-metric-value">
                {holderTrend && holderTrend.changePercent > 0 ? (
                  <span className={`growth-indicator ${holderTrend.changePercent > 20 ? 'rapid' : holderTrend.changePercent > 10 ? 'high' : 'medium'}`}>
                    +{holderTrend.changePercent.toFixed(1)}%
                  </span>
                ) : (
                  <span className="growth-indicator">-</span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Row 2: Volume, MCAP, Score, Dev Buy, Links */}
        <div className="mobile-card-row-2">
          <div className="mobile-card-data-grid">
            <div className="mobile-card-data-item">
              <span className="mobile-card-data-label">Vol 1h:</span>
              <span className="mobile-card-data-value">{formatVolume(deployment.volume1h)}</span>
            </div>
            <div className="mobile-card-data-item">
              <span className="mobile-card-data-label">Vol 6h:</span>
              <span className="mobile-card-data-value">{formatVolume(deployment.volume6h)}</span>
            </div>
            <div className="mobile-card-data-item">
              <span className="mobile-card-data-label">Vol 24h:</span>
              <span className="mobile-card-data-value">{formatVolume(deployment.volume24h)}</span>
            </div>
            <div className="mobile-card-data-item">
              <span className="mobile-card-data-label">MCAP:</span>
              <span className="mobile-card-data-value">{formatMarketCap(deployment.marketCap)}</span>
            </div>
            <div className="mobile-card-data-item">
              <span className="mobile-card-data-label">Score:</span>
              <span className="mobile-card-data-value">
                {(() => {
                  const score = calculateRunnerScore(deployment);
                  return score.score > 0 ? score.score.toFixed(2) : '-';
                })()}
              </span>
            </div>
            <div className="mobile-card-data-item">
              <span className="mobile-card-data-label">Dev Buy:</span>
              <div className="mobile-card-data-value">
                <span>{deployment.devBuyAmountFormatted || `${deployment.devBuyAmount || 0} ETH`}</span>
                {deployment.devSold && <span className="dev-sold-badge">SOLD</span>}
              </div>
            </div>
          </div>
          <div className="mobile-card-links">
            {deployment.links?.dexscreener && (
              <a href={deployment.links.dexscreener} target="_blank" rel="noopener noreferrer" className="compact-link" title="DexScreener">DS</a>
            )}
            {deployment.links?.defined && (
              <a href={deployment.links.defined} target="_blank" rel="noopener noreferrer" className="compact-link" title="Defined.fi">DF</a>
            )}
            {deployment.links?.basescan && (
              <a href={deployment.links.basescan} target="_blank" rel="noopener noreferrer" className="compact-link" title="BaseScan">BS</a>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (deployments.length === 0) {
    return (
      <div className="empty-state">
        <p>No deployments detected yet.</p>
        <p className="empty-subtitle">Monitoring contract for new token deployments...</p>
      </div>
    );
  }

  if (filteredDeployments.length === 0 && (devBuyThreshold !== '' || hideZeroDevBuy)) {
    return (
      <div className="empty-state">
        <p>No deployments match your filters.</p>
        <p className="empty-subtitle">Try adjusting the dev buy threshold or uncheck "Hide 0 Dev Buy"</p>
      </div>
    );
  }

  // Calculate catch-up progress
  const calculateCatchUpProgress = () => {
    if (deployments.length === 0) return { progress: 0, complete: 0, total: 0, estimatedTime: null };

    const total = deployments.length;
    let complete = 0;

    deployments.forEach(d => {
      // Consider a token "complete" if it has been checked by the backend
      // A token is complete if it has:
      // - Holder count checked (even if 0, as long as it's been checked)
      // - OR has holder history (means backend has processed it)
      // - OR volume data exists (even if 0, means backend checked it)
      // - OR market cap has been checked (even if 0)
      const hasHolders = d.holderCount !== undefined && d.holderCount !== null;
      const hasHolderHistory = d.holderCountHistory && d.holderCountHistory.length > 0;
      const hasVolume = d.volume1h !== undefined || d.volume6h !== undefined || d.volume24h !== undefined || d.volume7d !== undefined;
      const hasMarketCap = d.marketCap !== undefined && d.marketCap !== null;

      // Token is "complete" if backend has checked at least holders OR volume OR market cap
      // This is more lenient - as long as backend has touched it, it's considered "complete"
      if (hasHolders || hasHolderHistory || hasVolume || hasMarketCap) {
        complete++;
      }
    });

    const progress = total > 0 ? (complete / total) * 100 : 0;
    const remaining = total - complete;

    // Estimate time: in catch-up mode, processing ~5 holder checks + ~10 volume updates per cycle
    // Each cycle is 15 seconds, so ~15 tokens per cycle
    // But some tokens need multiple cycles, so estimate ~10 tokens per cycle
    const tokensPerCycle = 10;
    const cyclesNeeded = Math.ceil(remaining / tokensPerCycle);
    const estimatedSeconds = cyclesNeeded * 15; // 15s per cycle in catch-up mode
    const estimatedMinutes = Math.ceil(estimatedSeconds / 60);

    return {
      progress: Math.round(progress),
      complete,
      total,
      remaining,
      estimatedTime: remaining > 0 ? estimatedMinutes : null
    };
  };

  const catchUpProgress = calculateCatchUpProgress();

  return (
    <div className="token-feed-container">
      {/* Catch-Up Progress Meter */}
      {catchUpProgress.progress < 100 && (
        <div className="catch-up-progress">
          <div className="catch-up-header">
            <span className="catch-up-title">⚡ Catching Up Data</span>
            <span className="catch-up-stats">
              {catchUpProgress.complete} / {catchUpProgress.total} tokens ({catchUpProgress.progress}%)
            </span>
          </div>
          <div className="catch-up-bar-container">
            <div
              className="catch-up-bar"
              style={{ width: `${catchUpProgress.progress}%` }}
            />
          </div>
          {catchUpProgress.estimatedTime && (
            <div className="catch-up-time">
              Estimated time remaining: ~{catchUpProgress.estimatedTime} minute{catchUpProgress.estimatedTime !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {/* Global Filters */}
      <div className="global-filters">
        <div className="filters-section">
          <div className="filter-group">
            <label className="filter-label">
              Min Dev Buy (ETH):
              <input
                type="number"
                step="0.001"
                min="0"
                value={devBuyThreshold}
                onChange={(e) => setDevBuyThreshold(e.target.value)}
                placeholder="0"
                className="threshold-input"
              />
            </label>
          </div>
          <div className="filter-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={hideZeroDevBuy}
                onChange={(e) => setHideZeroDevBuy(e.target.checked)}
                className="filter-checkbox"
              />
              <span>Hide 0 Dev Buy</span>
            </label>
          </div>
          <div className="filter-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={removeDuplicates}
                onChange={(e) => setRemoveDuplicates(e.target.checked)}
                className="filter-checkbox"
              />
              <span>Remove Duplicate Names</span>
            </label>
          </div>
          <div className="filter-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={removeSerialDeployers}
                onChange={(e) => setRemoveSerialDeployers(e.target.checked)}
                className="filter-checkbox"
              />
              <span>Remove Serial Deployers (2+ tokens)</span>
            </label>
          </div>
          <div className="filter-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={hideDeadTokens}
                onChange={(e) => setHideDeadTokens(e.target.checked)}
                className="filter-checkbox"
              />
              <span>Hide Dead Tokens</span>
              <button
                className="help-icon-small"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  alert('Hide Dead Tokens: Hides tokens older than 1 hour with ≤5 holders, no volume, and no market cap. These tokens show no activity and are likely inactive.');
                }}
                title="What are dead tokens?"
                style={{ marginLeft: '4px', verticalAlign: 'middle' }}
              >
                ?
              </button>
            </label>
          </div>
          <div className="filter-group">
            <button
              className={`mute-button ${isMuted ? 'muted' : ''}`}
              onClick={handleMuteToggle}
              title={isMuted ? 'Unmute all sounds' : 'Mute all sounds'}
            >
              {isMuted ? '🔇 MUTE' : '🔔 MUTE'}
            </button>
          </div>
        </div>
      </div>

      {/* Alerts Section - Full Width at Top */}
      <div className="alerts-section-full">
        {!hasAlertsAccess && (
          <div className="token-gate-message">
            <div className="gate-content">
              <h2>🔒 Token Gated</h2>
              <p>Hold at least 25,000,000 FeyScan tokens to view alerts.</p>
              <p className="gate-subtext">Connect your wallet to check your balance.</p>
            </div>
          </div>
        )}
        {hasAlertsAccess && (
          <div>
            <div className="alerts-header">
              <h2>🔔 Alerts</h2>
              <span className="alert-count">{alerts.length}</span>
              <button
                className="collapse-button"
                onClick={() => setIsAlertsCollapsed(!isAlertsCollapsed)}
                title={isAlertsCollapsed ? 'Expand' : 'Collapse'}
              >
                {isAlertsCollapsed ? '▼' : '▲'}
              </button>
            </div>
            {!isAlertsCollapsed && (
              <div className="alerts-list">
              {alerts.length === 0 ? (
                <div className="no-alerts">No high dev buy alerts</div>
              ) : (
                alerts.map((alert, index) => {
                  const ensName = getENSName(alert.from);
                  return (
                    <div key={alert.txHash || index} className="alert-item-compact">
                      <div className="alert-row-1">
                        <span className="alert-token-compact">{alert.tokenName || 'Unknown'}</span>
                        <span className="alert-dev-buy-compact">{alert.devBuyAmountFormatted || `${alert.devBuyAmount} ETH`}</span>
                      </div>
                      <div className="alert-row-2">
                        <span className="alert-dev-compact">
                          {ensName ? (
                            <span className="ens-name">{ensName}</span>
                          ) : (
                            <code className="alert-address" onClick={() => copyToClipboard(alert.from)} title={alert.from}>
                              {truncateAddress(alert.from)}
                            </code>
                          )}
                        </span>
                        <span className="alert-time-compact">{formatTimeAgo(alert.timestamp)}</span>
                        <div className="alert-links-compact">
                          {alert.links?.dexscreener && (
                            <a href={alert.links.dexscreener} target="_blank" rel="noopener noreferrer" className="compact-link" title="DexScreener">DS</a>
                          )}
                          {alert.links?.defined && (
                            <a href={alert.links.defined} target="_blank" rel="noopener noreferrer" className="compact-link" title="Defined.fi">DF</a>
                          )}
                          {alert.links?.basescan && (
                            <a href={alert.links.basescan} target="_blank" rel="noopener noreferrer" className="compact-link" title="Basescan">BS</a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Hot Runners Section - Token Gated at 15M */}
        {!hasHotRunnersAccess && runners.length > 0 && (
          <div className="token-gate-message">
            <div className="gate-content">
              <h2>🔒 Token Gated Content</h2>
              <p>Hold at least 15,000,000 FeyScan tokens to view Hot Runners.</p>
              <p className="gate-subtext">Connect your wallet to check your balance.</p>
            </div>
          </div>
        )}
        {hasHotRunnersAccess && runners.length > 0 && (
          <div className="runners-section">
            <div className="section-header">
              <h2>🔥 Hot Runners</h2>
              <span className="runners-count">{runners.length} active</span>
              <button
                className="collapse-button"
                onClick={() => setIsHotRunnersCollapsed(!isHotRunnersCollapsed)}
                title={isHotRunnersCollapsed ? 'Expand' : 'Collapse'}
              >
                {isHotRunnersCollapsed ? '▼' : '▲'}
              </button>
            </div>
            {!isHotRunnersCollapsed && (
            <div className="runners-table-container">
              <table className="runners-table">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => handleSort('tokenName')}>
                      Token <SortArrow field="tokenName" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('holderCount')}>
                      Holders
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Holders: Total number of unique addresses that hold this token.');
                        }}
                        title="What are holders?"
                      >
                        ?
                      </button>
                      <SortArrow field="holderCount" />
                    </th>
                    <th>
                      Growth
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Growth: Percentage change in holder count since last check. Shows how quickly the token is gaining holders.');
                        }}
                        title="What is growth?"
                      >
                        ?
                      </button>
                    </th>
                    <th className="sortable" onClick={() => handleSort('volume1h')}>
                      Volume 1h
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Volume 1h: Total trading volume in ETH over the last 1 hour. Shows very recent activity.');
                        }}
                        title="What is 1h volume?"
                      >
                        ?
                      </button>
                      <SortArrow field="volume1h" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('volume6h')}>
                      Volume 6h
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Volume 6h: Total trading volume in ETH over the last 6 hours. Shows short-term activity.');
                        }}
                        title="What is 6h volume?"
                      >
                        ?
                      </button>
                      <SortArrow field="volume6h" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('volume24h')}>
                      Volume 24h
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Volume 24h: Total trading volume in ETH over the last 24 hours.');
                        }}
                        title="What is 24h volume?"
                      >
                        ?
                      </button>
                      <SortArrow field="volume24h" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('marketCap')}>
                      MCAP
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('MCAP: Market capitalization in USD, calculated from token price and total supply.');
                        }}
                        title="What is market cap?"
                      >
                        ?
                      </button>
                      <SortArrow field="marketCap" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('runnerScore')}>
                      Score
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowScoreHelp(true);
                        }}
                        title="How is the score calculated?"
                      >
                        ?
                      </button>
                      <SortArrow field="runnerScore" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('devBuyAmount')}>
                      Dev Buy
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Dev Buy: Amount of ETH the deployer spent to buy tokens immediately after deployment. Higher amounts indicate more confidence.');
                        }}
                        title="What is dev buy?"
                      >
                        ?
                      </button>
                      <SortArrow field="devBuyAmount" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('timestamp')}>
                      Age
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Age: Time since the token was deployed. Shows how new the token is.');
                        }}
                        title="What is age?"
                      >
                        ?
                      </button>
                      <SortArrow field="timestamp" />
                    </th>
                    <th>
                      Links
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Links: Quick access to DexScreener (DS), Defined.fi (DF), and BaseScan (BS) for this token.');
                        }}
                        title="What are links?"
                      >
                        ?
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runners.map((runner, index) => {
                    const ensName = getENSName(runner.from);
                    const history = runner.holderCountHistory || [];
                    const holderTrend = history.length >= 2 ? (() => {
                      const recent = history[history.length - 1];
                      const previous = history[history.length - 2];
                      const change = recent.count - previous.count;
                      const changePercent = previous.count > 0 ? (change / previous.count) * 100 : 0;
                      return { change, changePercent, isRapid: Math.abs(changePercent) > 20 };
                    })() : null;

                    return (
                      <tr key={runner.txHash || index} className={`runner-row ${index < 3 ? 'top-runner' : ''}`}>
                        <td className="token-name-cell">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {index < 3 && <span className="runner-badge-small" title="Hot Runner">🔥</span>}
                            <strong>{runner.tokenName || 'Unknown'}</strong>
                          </div>
                        </td>
                        <td className="holder-count-cell">
                          <div className="holder-count-display">
                            <div className="holder-count-main">
                              <span className={`holder-count-number ${holderTrend?.change > 0 ? 'up' : ''}`}>
                                {runner.holderCount !== undefined ? runner.holderCount : '-'}
                              </span>
                              {holderTrend && holderTrend.change > 0 && (
                                <span className={`holder-trend up ${holderTrend.isRapid ? 'rapid' : ''}`}>↑</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="growth-cell">
                          {holderTrend && holderTrend.changePercent > 0 ? (
                            <span className={`growth-indicator ${holderTrend.changePercent > 20 ? 'rapid' : holderTrend.changePercent > 10 ? 'high' : 'medium'}`}>
                              +{holderTrend.changePercent.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="growth-indicator">-</span>
                          )}
                        </td>
                        <td className="volume-cell">
                          {formatVolume(runner.volume1h || 0)}
                        </td>
                        <td className="volume-cell">
                          {formatVolume(runner.volume6h || 0)}
                        </td>
                        <td className="volume-cell">
                          {formatVolume(runner.volume24h || 0)}
                          {(runner.volume24h || 0) > 0.1 && <span className="volume-badge">💰</span>}
                        </td>
                        <td className="mcap-cell">
                          {formatMarketCap(runner.marketCap || 0)}
                        </td>
                        <td className="score-cell">
                          <span className={`runner-score ${runner.runnerData.score > 0.5 ? 'high' : runner.runnerData.score > 0.2 ? 'medium' : 'low'}`}>
                            {runner.runnerData.score.toFixed(2)}
                          </span>
                        </td>
                        <td className="dev-buy-cell">
                          <div className="dev-buy-content">
                            {runner.devBuyAmountFormatted || `${runner.devBuyAmount || 0} ETH`}
                            {runner.devSold && (
                              <span className="dev-sold-badge" title={`Dev sold ${runner.devSoldAmount?.toFixed(4) || 'tokens'}`}>
                                SOLD
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="time-cell">
                          <LiveTime timestamp={runner.timestamp} />
                        </td>
                        <td className="links-cell">
                          <div className="compact-links">
                            {runner.links?.dexscreener && (
                              <a href={runner.links.dexscreener} target="_blank" rel="noopener noreferrer" className="compact-link">DS</a>
                            )}
                            {runner.links?.defined && (
                              <a href={runner.links.defined} target="_blank" rel="noopener noreferrer" className="compact-link">DF</a>
                            )}
                            {runner.links?.basescan && (
                              <a href={runner.links.basescan} target="_blank" rel="noopener noreferrer" className="compact-link">BS</a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>
        )}

        {/* Newest 5 Section - Token Gated */}
        {!hasNewest5Access && (
          <div className="token-gate-message">
            <div className="gate-content">
              <h2>🔒 Token Gated Content</h2>
              <p>Hold at least 10,000,000 FeyScan tokens to view the newest 5 deployments.</p>
              <p className="gate-subtext">Connect your wallet to check your balance.</p>
            </div>
          </div>
        )}
        {hasNewest5Access && newest5.length > 0 && (
          <div className="newest-section">
            <div className="section-header">
              <h2>Newest 5 Deployments</h2>
            </div>
            {/* Mobile Card View */}
            <div className="mobile-deployments-list">
              {newest5.map((deployment, index) => (
                <MobileDeploymentCard key={deployment.txHash || index} deployment={deployment} />
              ))}
            </div>
            {/* Desktop Table View */}
            <div className="newest-table-container">
              <table className="newest-table">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => handleSort('tokenName')}>
                      Token <SortArrow field="tokenName" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('holderCount')}>
                      Holders
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Holders: Total number of unique addresses that hold this token.');
                        }}
                        title="What are holders?"
                      >
                        ?
                      </button>
                      <SortArrow field="holderCount" />
                    </th>
                    <th>
                      Growth
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Growth: Percentage change in holder count since last check. Shows how quickly the token is gaining holders.');
                        }}
                        title="What is growth?"
                      >
                        ?
                      </button>
                    </th>
                    <th className="sortable" onClick={() => handleSort('volume1h')}>
                      Volume 1h
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Volume 1h: Total trading volume in ETH over the last 1 hour. Shows very recent activity.');
                        }}
                        title="What is 1h volume?"
                      >
                        ?
                      </button>
                      <SortArrow field="volume1h" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('volume6h')}>
                      Volume 6h
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Volume 6h: Total trading volume in ETH over the last 6 hours. Shows short-term activity.');
                        }}
                        title="What is 6h volume?"
                      >
                        ?
                      </button>
                      <SortArrow field="volume6h" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('volume24h')}>
                      Volume 24h
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Volume 24h: Total trading volume in ETH over the last 24 hours.');
                        }}
                        title="What is 24h volume?"
                      >
                        ?
                      </button>
                      <SortArrow field="volume24h" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('marketCap')}>
                      MCAP
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('MCAP: Market capitalization in USD, calculated from token price and total supply.');
                        }}
                        title="What is market cap?"
                      >
                        ?
                      </button>
                      <SortArrow field="marketCap" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('runnerScore')}>
                      Score
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowScoreHelp(true);
                        }}
                        title="How is the score calculated?"
                      >
                        ?
                      </button>
                      <SortArrow field="runnerScore" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('devBuyAmount')}>
                      Dev Buy
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Dev Buy: Amount of ETH the deployer spent to buy tokens immediately after deployment. Higher amounts indicate more confidence.');
                        }}
                        title="What is dev buy?"
                      >
                        ?
                      </button>
                      <SortArrow field="devBuyAmount" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('timestamp')}>
                      Age
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Age: Time since the token was deployed. Shows how new the token is.');
                        }}
                        title="What is age?"
                      >
                        ?
                      </button>
                      <SortArrow field="timestamp" />
                    </th>
                    <th>
                      Links
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Links: Quick access to DexScreener (DS), Defined.fi (DF), and BaseScan (BS) for this token.');
                        }}
                        title="What are links?"
                      >
                        ?
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {newest5.map((deployment, index) => {
                    const ensName = getENSName(deployment.from);
                    const history = deployment.holderCountHistory || [];
                    const holderTrend = history.length >= 2 ? (() => {
                      const recent = history[history.length - 1];
                      const previous = history[history.length - 2];
                      const change = recent.count - previous.count;
                      const changePercent = previous.count > 0 ? (change / previous.count) * 100 : 0;
                      return { change, changePercent, isRapid: Math.abs(changePercent) > 20 };
                    })() : null;
                    const isRunner = deployment.runnerData?.score > 0.1;
                    const isHighVolume = (deployment.volume24h || 0) > 0.1;

                    return (
                      <tr key={deployment.txHash || index} className={`newest-row ${isRunner ? 'runner-highlight' : ''}`}>
                        <td className="token-name-cell">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <strong>{deployment.tokenName || 'Unknown'}</strong>
                            {isRunner && <span className="runner-badge-small" title="Hot Runner">🔥</span>}
                            {holderTrend && holderTrend.change > 0 && <span className="growth-badge-small" title="Growing">📈</span>}
                            {isHighVolume && <span className="volume-badge-small" title="High Volume">💰</span>}
                          </div>
                        </td>
                        <td className="holder-count-cell">
                          <div className="holder-count-display">
                            <div className="holder-count-main">
                              <span className={`holder-count-number ${holderTrend?.change > 0 ? 'up' : holderTrend?.change < 0 ? 'down' : ''} ${holderTrend?.isRapid ? 'rapid' : ''}`}>
                                {deployment.holderCount !== undefined ? deployment.holderCount : '-'}
                              </span>
                              {holderTrend && holderTrend.change > 0 && (
                                <span className={`holder-trend up ${holderTrend.isRapid ? 'rapid' : ''}`} title={`+${holderTrend.change} (+${holderTrend.changePercent.toFixed(1)}%)`}>↑</span>
                              )}
                              {holderTrend && holderTrend.change < 0 && (
                                <span className={`holder-trend down`} title={`${holderTrend.change} (${holderTrend.changePercent.toFixed(1)}%)`}>↓</span>
                              )}
                            </div>
                            <HolderCheckTime lastCheckTime={deployment.lastHolderCheck || (history.length > 0 ? history[history.length - 1].timestamp : null)} />
                          </div>
                        </td>
                        <td className="growth-cell">
                          {holderTrend && holderTrend.changePercent > 0 ? (
                            <span className={`growth-indicator ${holderTrend.changePercent > 20 ? 'rapid' : holderTrend.changePercent > 10 ? 'high' : 'medium'}`}>
                              +{holderTrend.changePercent.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="growth-indicator">-</span>
                          )}
                        </td>
                        <td className="volume-cell">
                          {formatVolume(deployment.volume1h)}
                        </td>
                        <td className="volume-cell">
                          {formatVolume(deployment.volume6h)}
                        </td>
                        <td className="volume-cell">
                          {formatVolume(deployment.volume24h)}
                        </td>
                        <td className="mcap-cell">
                          {formatMarketCap(deployment.marketCap || 0)}
                        </td>
                        <td className="score-cell">
                          {(() => {
                            const score = calculateRunnerScore(deployment).score;
                            if (score === 0 || isNaN(score)) {
                              return <span className="growth-indicator">-</span>;
                            }
                            return (
                              <span className={`runner-score ${score > 0.5 ? 'high' : score > 0.2 ? 'medium' : 'low'}`}>
                                {score.toFixed(2)}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="dev-buy-cell">
                          <div className="dev-buy-content">
                            {deployment.devBuyAmountFormatted || `${deployment.devBuyAmount || 0} ETH`}
                            {deployment.devSold && (
                              <span className="dev-sold-badge" title={`Dev sold ${deployment.devSoldAmount?.toFixed(4) || 'tokens'}`}>
                                SOLD
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="time-cell">
                          <LiveTime timestamp={deployment.timestamp} />
                        </td>
                        <td className="links-cell">
                          <div className="compact-links">
                            {deployment.links?.dexscreener && (
                              <a href={deployment.links.dexscreener} target="_blank" rel="noopener noreferrer" className="compact-link" title="DexScreener">DS</a>
                            )}
                            {deployment.links?.defined && (
                              <a href={deployment.links.defined} target="_blank" rel="noopener noreferrer" className="compact-link" title="Defined.fi">DF</a>
                            )}
                            {deployment.links?.basescan && (
                              <a href={deployment.links.basescan} target="_blank" rel="noopener noreferrer" className="compact-link" title="BaseScan">BS</a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>
        )}

        {/* All Deployments Section - Free (public) */}
        {sortedDeployments.length > 0 && (
          <div className="database-section">
            <div className="section-header">
              <h2>All Deployments ({filteredDeployments.length}{filteredDeployments.length !== deployments.length ? ` / ${deployments.length}` : ''})</h2>
            </div>
            {/* Mobile Card View */}
            <div className="mobile-deployments-list">
              {sortedDeployments.map((deployment, index) => (
                <MobileDeploymentCard key={deployment.txHash || index + 5} deployment={deployment} />
              ))}
            </div>
            {/* Desktop Table View */}
            <div className="table-container">
              <table className="deployments-table">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => handleSort('tokenName')}>
                      Token <SortArrow field="tokenName" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('holderCount')}>
                      Holders
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Holders: Total number of unique addresses that hold this token.');
                        }}
                        title="What are holders?"
                      >
                        ?
                      </button>
                      <SortArrow field="holderCount" />
                    </th>
                    <th>
                      Growth
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Growth: Percentage change in holder count since last check. Shows how quickly the token is gaining holders.');
                        }}
                        title="What is growth?"
                      >
                        ?
                      </button>
                    </th>
                    <th className="sortable" onClick={() => handleSort('volume1h')}>
                      Volume 1h
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Volume 1h: Total trading volume in ETH over the last 1 hour. Shows very recent activity.');
                        }}
                        title="What is 1h volume?"
                      >
                        ?
                      </button>
                      <SortArrow field="volume1h" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('volume6h')}>
                      Volume 6h
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Volume 6h: Total trading volume in ETH over the last 6 hours. Shows short-term activity.');
                        }}
                        title="What is 6h volume?"
                      >
                        ?
                      </button>
                      <SortArrow field="volume6h" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('volume24h')}>
                      Volume 24h
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Volume 24h: Total trading volume in ETH over the last 24 hours.');
                        }}
                        title="What is 24h volume?"
                      >
                        ?
                      </button>
                      <SortArrow field="volume24h" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('marketCap')}>
                      MCAP
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('MCAP: Market capitalization in USD, calculated from token price and total supply.');
                        }}
                        title="What is market cap?"
                      >
                        ?
                      </button>
                      <SortArrow field="marketCap" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('runnerScore')}>
                      Score
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowScoreHelp(true);
                        }}
                        title="How is the score calculated?"
                      >
                        ?
                      </button>
                      <SortArrow field="runnerScore" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('devBuyAmount')}>
                      Dev Buy
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Dev Buy: Amount of ETH the deployer spent to buy tokens immediately after deployment. Higher amounts indicate more confidence.');
                        }}
                        title="What is dev buy?"
                      >
                        ?
                      </button>
                      <SortArrow field="devBuyAmount" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('timestamp')}>
                      Age
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Age: Time since the token was deployed. Shows how new the token is.');
                        }}
                        title="What is age?"
                      >
                        ?
                      </button>
                      <SortArrow field="timestamp" />
                    </th>
                    <th>
                      Links
                      <button
                        className="help-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert('Links: Quick access to DexScreener (DS), Defined.fi (DF), and BaseScan (BS) for this token.');
                        }}
                        title="What are links?"
                      >
                        ?
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDeployments.map((deployment, index) => {
                    const ensName = getENSName(deployment.from);
                    const history = deployment.holderCountHistory || [];
                    const holderTrend = history.length >= 2 ? (() => {
                      const recent = history[history.length - 1];
                      const previous = history[history.length - 2];
                      const change = recent.count - previous.count;
                      const changePercent = previous.count > 0 ? (change / previous.count) * 100 : 0;
                      return { change, changePercent, isRapid: Math.abs(changePercent) > 20 };
                    })() : null;
                    const isRunner = deployment.runnerData?.score > 0.1;
                    const isHighVolume = (deployment.volume24h || 0) > 0.1;

                    return (
                      <tr key={deployment.txHash || index + 5} className={isRunner ? 'runner-highlight' : ''}>
                        <td className="token-name-cell">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <strong>{deployment.tokenName || 'Unknown'}</strong>
                            {isRunner && <span className="runner-badge-small" title="Hot Runner">🔥</span>}
                            {holderTrend && holderTrend.change > 0 && <span className="growth-badge-small" title="Growing">📈</span>}
                            {isHighVolume && <span className="volume-badge-small" title="High Volume">💰</span>}
                          </div>
                        </td>
                        <td className="holder-count-cell">
                          <div className="holder-count-display">
                            <div className="holder-count-main">
                              <span className={`holder-count-number ${holderTrend?.change > 0 ? 'up' : holderTrend?.change < 0 ? 'down' : ''} ${holderTrend?.isRapid ? 'rapid' : ''}`}>
                                {deployment.holderCount !== undefined ? deployment.holderCount : '-'}
                              </span>
                              {holderTrend && holderTrend.change > 0 && (
                                <span className={`holder-trend up ${holderTrend.isRapid ? 'rapid' : ''}`} title={`+${holderTrend.change} (+${holderTrend.changePercent.toFixed(1)}%)`}>↑</span>
                              )}
                              {holderTrend && holderTrend.change < 0 && (
                                <span className={`holder-trend down`} title={`${holderTrend.change} (${holderTrend.changePercent.toFixed(1)}%)`}>↓</span>
                              )}
                            </div>
                            <HolderCheckTime lastCheckTime={deployment.lastHolderCheck || (history.length > 0 ? history[history.length - 1].timestamp : null)} />
                          </div>
                        </td>
                        <td className="growth-cell">
                          {holderTrend && holderTrend.changePercent > 0 ? (
                            <span className={`growth-indicator ${holderTrend.changePercent > 20 ? 'rapid' : holderTrend.changePercent > 10 ? 'high' : 'medium'}`}>
                              +{holderTrend.changePercent.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="growth-indicator">-</span>
                          )}
                        </td>
                        <td className="volume-cell">
                          {formatVolume(deployment.volume1h)}
                        </td>
                        <td className="volume-cell">
                          {formatVolume(deployment.volume6h)}
                        </td>
                        <td className="volume-cell">
                          {formatVolume(deployment.volume24h)}
                        </td>
                        <td className="mcap-cell">
                          {formatMarketCap(deployment.marketCap || 0)}
                        </td>
                        <td className="score-cell">
                          {(() => {
                            const score = calculateRunnerScore(deployment).score;
                            if (score === 0 || isNaN(score)) {
                              return <span className="growth-indicator">-</span>;
                            }
                            return (
                              <span className={`runner-score ${score > 0.5 ? 'high' : score > 0.2 ? 'medium' : 'low'}`}>
                                {score.toFixed(2)}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="dev-buy-cell">
                          <div className="dev-buy-content">
                            {deployment.devBuyAmountFormatted || `${deployment.devBuyAmount || 0} ETH`}
                            {deployment.devSold && (
                              <span className="dev-sold-badge" title={`Dev sold ${deployment.devSoldAmount?.toFixed(4) || 'tokens'}`}>
                                SOLD
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="time-cell">
                          <LiveTime timestamp={deployment.timestamp} />
                        </td>
                        <td className="links-cell">
                          <div className="compact-links">
                            {deployment.links?.dexscreener && (
                              <a href={deployment.links.dexscreener} target="_blank" rel="noopener noreferrer" className="compact-link" title="DexScreener">DS</a>
                            )}
                            {deployment.links?.defined && (
                              <a href={deployment.links.defined} target="_blank" rel="noopener noreferrer" className="compact-link" title="Defined.fi">DF</a>
                            )}
                            {deployment.links?.basescan && (
                              <a href={deployment.links.basescan} target="_blank" rel="noopener noreferrer" className="compact-link" title="BaseScan">BS</a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>
        )}
      </div>

      {/* Score Help Modal */}
      {showScoreHelp && <ScoreHelpModal />}
    </div>
  );
}

export default TokenFeed;
