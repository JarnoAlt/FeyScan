import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi';
import { formatUnits } from 'viem';
import { useEffect } from 'react';

const FEYSCAN_TOKEN_ADDRESS = '0x1a013768E7c572d6F7369a3e5bC9b29b0a0f0659';
const REQUIRED_BALANCE = 10000000n; // 10 million tokens

// Dev whitelist - these addresses have free access
const DEV_WHITELIST = [
  '0x6A111F6a341e7110837FE3eA8e8F426Fc5FA2B32'.toLowerCase(),
  '0x8DFBdEEC8c5d4970BB5F481C6ec7f73fa1C65be5'.toLowerCase(),
];

export function isWhitelisted(address) {
  if (!address) return false;
  return DEV_WHITELIST.includes(address.toLowerCase());
}

function WalletConnect() {
  const { address, isConnected, connector } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  // Listen for account changes in MetaMask - wagmi handles this automatically
  // No need for manual reload, wagmi's useAccount hook will update reactively

  // Get token balance
  const { data: tokenBalance, isLoading: balanceLoading } = useBalance({
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

  const handleConnect = () => {
    if (connectors && connectors.length > 0) {
      connect({ connector: connectors[0] });
    }
  };

  const handleDisconnect = () => {
    disconnect();
  };

  if (!isConnected) {
    return (
      <button className="wallet-connect-btn" onClick={handleConnect}>
        Connect Wallet
      </button>
    );
  }

  return (
    <div className="wallet-info-container">
      <div className="wallet-address-display">
        <span className="wallet-address-text">
          {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected'}
        </span>
        {hasAccess && (
          <span className="token-badge" title={isWhitelistedDev ? 'Dev Access' : `You hold ${tokenBalance ? formatUnits(tokenBalance.value, tokenBalance.decimals) : '0'} FeyScan tokens`}>
            {isWhitelistedDev ? '✓ Dev' : '✓ Verified'}
          </span>
        )}
      </div>
      <button className="wallet-disconnect-btn" onClick={handleDisconnect}>
        Disconnect
      </button>
    </div>
  );
}

export default WalletConnect;
export { FEYSCAN_TOKEN_ADDRESS, REQUIRED_BALANCE };

