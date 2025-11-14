import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { createWeb3Modal } from '@web3modal/wagmi/react';
import { walletConnect, injected } from 'wagmi/connectors';

// Get projectId from environment or use a default
// You can get a free project ID from https://cloud.walletconnect.com
const projectId = import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID || 'YOUR_PROJECT_ID';

// Create wagmi config
export const config = createConfig({
  chains: [base],
  connectors: [
    ...(projectId && projectId !== 'YOUR_PROJECT_ID' ? [walletConnect({ projectId })] : []),
    injected({ shimDisconnect: true }),
  ],
  transports: {
    [base.id]: http(),
  },
  ssr: false, // Disable SSR to prevent hydration issues
});

// Create Web3Modal (only if projectId is set)
if (projectId && projectId !== 'YOUR_PROJECT_ID') {
  createWeb3Modal({
    wagmiConfig: config,
    projectId,
    chains: [base],
    themeMode: 'dark',
    themeVariables: {
      '--w3m-color-mix': '#10b981',
      '--w3m-color-mix-strength': 40,
      '--w3m-accent': '#10b981',
    },
  });
}

