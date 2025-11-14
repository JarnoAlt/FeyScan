import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi';
import { formatUnits } from 'viem';

const FEYSCAN_TOKEN_ADDRESS = '0x1a013768E7c572d6F7369a3e5bC9b29b0a0f0659';
const REQUIRED_BALANCE = 10000000n; // 10 million tokens

function WalletConnect() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  // Get token balance
  const { data: tokenBalance, isLoading: balanceLoading } = useBalance({
    address: address,
    token: FEYSCAN_TOKEN_ADDRESS,
    chainId: 8453, // Base mainnet
    query: {
      enabled: isConnected && !!address,
    },
  });

  const hasEnoughTokens = tokenBalance && tokenBalance.value >= REQUIRED_BALANCE;

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
        {hasEnoughTokens && (
          <span className="token-badge" title={`You hold ${tokenBalance ? formatUnits(tokenBalance.value, tokenBalance.decimals) : '0'} FeyScan tokens`}>
            ✓ Verified
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

