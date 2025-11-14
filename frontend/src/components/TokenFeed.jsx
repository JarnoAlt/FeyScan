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

function TokenFeed({ deployments, hasEnoughTokens = false }) {
  const [sortField, setSortField] = useState('timestamp');
  const [sortDirection, setSortDirection] = useState('desc');
  const [ensNames, setEnsNames] = useState({});
  const [playedAlerts, setPlayedAlerts] = useState(new Set());
  const [devBuyThreshold, setDevBuyThreshold] = useState('');
  const [hideZeroDevBuy, setHideZeroDevBuy] = useState(true); // Default ON
  const [removeDuplicates, setRemoveDuplicates] = useState(true); // Default ON
  const [removeSerialDeployers, setRemoveSerialDeployers] = useState(true); // Default ON
  const [isMuted, setIsMuted] = useState(false);
  const [serverStatus, setServerStatus] = useState('checking');

  const formatTimeAgo = (timestamp) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
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

    return filtered;
  }, [deployments, devBuyThreshold, hideZeroDevBuy, removeDuplicates, removeSerialDeployers]);

  // Get alerts (dev buy > 0.25 ETH) - exclude dev sold items, apply filters
  const alerts = useMemo(() => {
    return filteredDeployments
      .filter(d => d.devBuyAmount > 0.25 && !d.devSold)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [filteredDeployments]);

  // Play bell sound for new alerts (only if not muted)
  useEffect(() => {
    if (isMuted) return; // Don't play sound if muted

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
  }, [alerts, playedAlerts, isMuted]);

  // Get newest 5 from filtered
  const newest5 = useMemo(() => {
    return [...filteredDeployments]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);
  }, [filteredDeployments]);

  // Get all deployments, sorted (including newest 5)
  const sortedDeployments = useMemo(() => {
    const rest = filteredDeployments;
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
  }, [filteredDeployments, sortField, sortDirection]);

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

  return (
    <div className="token-feed-container">
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
            <button
              className={`mute-button ${isMuted ? 'muted' : ''}`}
              onClick={() => setIsMuted(!isMuted)}
              title={isMuted ? 'Unmute alerts' : 'Mute alerts'}
            >
              {isMuted ? '🔇 MUTE' : '🔔 MUTE'}
            </button>
          </div>
        </div>
      </div>

      <div className="content-wrapper">
        {/* Alerts Sidebar */}
        <div className="alerts-sidebar">
        <div className="alerts-header">
          <h2>🔔 Alerts</h2>
          <span className="alert-count">{alerts.length}</span>
        </div>
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
      </div>

      {/* Main Content */}
      <div className="main-content">
        {/* Newest 5 Section - Token Gated */}
        {!hasEnoughTokens && (
          <div className="token-gate-message">
            <div className="gate-content">
              <h2>🔒 Token Gated Content</h2>
              <p>Hold at least 10,000,000 FeyScan tokens to view the newest 5 deployments.</p>
              <p className="gate-subtext">Connect your wallet to check your balance.</p>
            </div>
          </div>
        )}
        {hasEnoughTokens && newest5.length > 0 && (
          <div className="newest-section">
            <div className="section-header">
              <h2>Newest 5 Deployments</h2>
            </div>
            <div className="newest-table-container">
              <table className="newest-table">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => handleSort('tokenName')}>
                      Token <SortArrow field="tokenName" />
                    </th>
                    <th>Address</th>
                    <th>Dev</th>
                    <th className="sortable" onClick={() => handleSort('devBuyAmount')}>
                      Dev Buy <SortArrow field="devBuyAmount" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('holderCount')}>
                      Holders <SortArrow field="holderCount" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('timestamp')}>
                      Age <SortArrow field="timestamp" />
                    </th>
                    <th>Links</th>
                  </tr>
                </thead>
                <tbody>
                  {newest5.map((deployment, index) => {
                    const ensName = getENSName(deployment.from);
                    return (
                      <tr key={deployment.txHash || index} className="newest-row">
                        <td className="token-name-cell">
                          <strong>{deployment.tokenName || 'Unknown'}</strong>
                        </td>
                        <td className="address-cell">
                          <code onClick={() => copyToClipboard(deployment.tokenAddress)}>
                            {truncateAddress(deployment.tokenAddress)}
                          </code>
                        </td>
                        <td className="dev-cell">
                          {ensName ? (
                            <span className="ens-name">{ensName}</span>
                          ) : (
                            <code onClick={() => copyToClipboard(deployment.from)}>
                              {truncateAddress(deployment.from)}
                            </code>
                          )}
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
                        <td className="holder-count-cell">
                          <div className="holder-count-display">
                            <div className="holder-count-main">
                              {deployment.holderCountHistory && deployment.holderCountHistory.length > 1 ? (() => {
                                const history = deployment.holderCountHistory;
                                const current = history[history.length - 1].count;
                                const previous = history[history.length - 2].count;
                                const change = current - previous;
                                const changePercent = previous > 0 ? ((change / previous) * 100).toFixed(1) : 0;
                                const isRapid = Math.abs(changePercent) > 10;
                                const trendClass = change > 0 ? 'up' : change < 0 ? 'down' : '';

                                return (
                                  <>
                                    <span className={`holder-count-number ${trendClass} ${isRapid ? 'rapid' : ''}`}>
                                      {deployment.holderCount !== undefined ? deployment.holderCount : '-'}
                                    </span>
                                    {change > 0 && <span className={`holder-trend up ${isRapid ? 'rapid' : ''}`} title={`+${change} (+${changePercent}%)`}>↑</span>}
                                    {change < 0 && <span className={`holder-trend down ${isRapid ? 'rapid' : ''}`} title={`${change} (${changePercent}%)`}>↓</span>}
                                  </>
                                );
                              })() : (
                                <span className="holder-count-number">{deployment.holderCount !== undefined ? deployment.holderCount : '-'}</span>
                              )}
                            </div>
                            <HolderCheckTime lastCheckTime={deployment.lastHolderCheck || (deployment.holderCountHistory && deployment.holderCountHistory.length > 0 ? deployment.holderCountHistory[deployment.holderCountHistory.length - 1].timestamp : null)} />
                          </div>
                        </td>
                        <td className="time-cell">
                          <LiveTime timestamp={deployment.timestamp} />
                        </td>
                        <td className="links-cell">
                          <div className="compact-links">
                            {deployment.links?.dexscreener && (
                              <a href={deployment.links.dexscreener} target="_blank" rel="noopener noreferrer" className="compact-link">DS</a>
                            )}
                            {deployment.links?.defined && (
                              <a href={deployment.links.defined} target="_blank" rel="noopener noreferrer" className="compact-link">DF</a>
                            )}
                            {deployment.links?.basescan && (
                              <a href={deployment.links.basescan} target="_blank" rel="noopener noreferrer" className="compact-link">BS</a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Sortable Database Section */}
        {sortedDeployments.length > 0 && (
          <div className="database-section">
            <div className="section-header">
              <h2>All Deployments ({filteredDeployments.length}{filteredDeployments.length !== deployments.length ? ` / ${deployments.length}` : ''})</h2>
            </div>
            <div className="table-container">
              <table className="deployments-table">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => handleSort('tokenName')}>
                      Token <SortArrow field="tokenName" />
                    </th>
                    <th>Address</th>
                    <th>Dev</th>
                    <th className="sortable" onClick={() => handleSort('devBuyAmount')}>
                      Dev Buy <SortArrow field="devBuyAmount" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('holderCount')}>
                      Holders <SortArrow field="holderCount" />
                    </th>
                    <th className="sortable" onClick={() => handleSort('timestamp')}>
                      Age <SortArrow field="timestamp" />
                    </th>
                    <th>Links</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDeployments.map((deployment, index) => {
                    const ensName = getENSName(deployment.from);
                    return (
                      <tr key={deployment.txHash || index + 5}>
                        <td className="token-name-cell">
                          <strong>{deployment.tokenName || 'Unknown'}</strong>
                        </td>
                        <td className="address-cell">
                          <code onClick={() => copyToClipboard(deployment.tokenAddress)} title={deployment.tokenAddress}>
                            {truncateAddress(deployment.tokenAddress)}
                          </code>
                        </td>
                        <td className="dev-cell">
                          {ensName ? (
                            <span className="ens-name">{ensName}</span>
                          ) : (
                            <code onClick={() => copyToClipboard(deployment.from)} title={deployment.from}>
                              {truncateAddress(deployment.from)}
                            </code>
                          )}
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
                        <td className="holder-count-cell">
                          <div className="holder-count-display">
                            <div className="holder-count-main">
                              {deployment.holderCountHistory && deployment.holderCountHistory.length > 1 ? (() => {
                                const history = deployment.holderCountHistory;
                                const current = history[history.length - 1].count;
                                const previous = history[history.length - 2].count;
                                const change = current - previous;
                                const changePercent = previous > 0 ? ((change / previous) * 100).toFixed(1) : 0;
                                const isRapid = Math.abs(changePercent) > 10;
                                const trendClass = change > 0 ? 'up' : change < 0 ? 'down' : '';

                                return (
                                  <>
                                    <span className={`holder-count-number ${trendClass} ${isRapid ? 'rapid' : ''}`}>
                                      {deployment.holderCount !== undefined ? deployment.holderCount : '-'}
                                    </span>
                                    {change > 0 && <span className={`holder-trend up ${isRapid ? 'rapid' : ''}`} title={`+${change} (+${changePercent}%)`}>↑</span>}
                                    {change < 0 && <span className={`holder-trend down ${isRapid ? 'rapid' : ''}`} title={`${change} (${changePercent}%)`}>↓</span>}
                                  </>
                                );
                              })() : (
                                <span className="holder-count-number">{deployment.holderCount !== undefined ? deployment.holderCount : '-'}</span>
                              )}
                            </div>
                            <HolderCheckTime lastCheckTime={deployment.lastHolderCheck || (deployment.holderCountHistory && deployment.holderCountHistory.length > 0 ? deployment.holderCountHistory[deployment.holderCountHistory.length - 1].timestamp : null)} />
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
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

export default TokenFeed;
