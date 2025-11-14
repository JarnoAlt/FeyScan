import { useState, useEffect } from 'react';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { supabase } from '../config/supabase.js';
import './MessageBoard.css';

const DEV_WALLET = '0x8DFBdEEC8c5d4970BB5F481C6ec7f73fa1C65be5'; // ionoi.eth
const MIN_PAYMENT_USD = 1.0; // $1 minimum
const ETH_PRICE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

let ethPriceCache = { price: null, timestamp: 0 };

async function getETHPrice() {
  const now = Date.now();
  if (ethPriceCache.price && (now - ethPriceCache.timestamp) < ETH_PRICE_CACHE_DURATION) {
    return ethPriceCache.price;
  }

  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    const data = await response.json();
    const price = data.ethereum?.usd || 3000; // Fallback to $3000 if API fails
    ethPriceCache = { price, timestamp: now };
    return price;
  } catch (error) {
    console.error('Error fetching ETH price:', error);
    return ethPriceCache.price || 3000; // Use cached price or fallback
  }
}

function MessageBoard() {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ethPrice, setEthPrice] = useState(null);
  const [ethAmount, setEthAmount] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const { address, isConnected } = useAccount();

  const { data: hash, sendTransaction, isPending, error: txError } = useSendTransaction();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  useEffect(() => {
    fetchETHPrice();
    fetchMessages();
  }, []);

  useEffect(() => {
    if (isConfirmed && hash) {
      submitMessage(hash);
    }
  }, [isConfirmed, hash]);

  async function fetchETHPrice() {
    const price = await getETHPrice();
    setEthPrice(price);
    const amount = MIN_PAYMENT_USD / price;
    setEthAmount(amount);
  }

  async function fetchMessages() {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('status', 'verified')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setMessages(data || []);
    } catch (err) {
      console.error('Error fetching messages:', err);
    }
  }

  async function submitMessage(txHash) {
    if (!message.trim() || !txHash) return;

    setLoading(true);
    setError(null);

    try {
      // Get transaction details to verify amount using public RPC
      const rpcUrl = import.meta.env.VITE_ALCHEMY_API_KEY
        ? `https://base-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`
        : 'https://mainnet.base.org';

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getTransactionByHash',
          params: [txHash],
        }),
      });

      const txData = await response.json();
      if (!txData.result) {
        throw new Error('Transaction not found. Please wait a moment and try again.');
      }

      const txValue = BigInt(txData.result.value);
      const txValueEth = parseFloat(formatEther(txValue));
      const txValueUsd = txValueEth * (ethPrice || 3000);

      if (txValueUsd < MIN_PAYMENT_USD) {
        throw new Error(`Payment too low. Minimum $${MIN_PAYMENT_USD} required. You sent $${txValueUsd.toFixed(2)}.`);
      }

      // Verify transaction is to dev wallet
      if (txData.result.to?.toLowerCase() !== DEV_WALLET.toLowerCase()) {
        throw new Error('Transaction must be sent to the dev wallet');
      }

      // Store message in Supabase
      const { data, error: insertError } = await supabase
        .from('messages')
        .insert({
          sender_address: address,
          message: message.trim(),
          payment_tx_hash: txHash,
          payment_amount_eth: txValueEth,
          payment_amount_usd: txValueUsd,
          status: 'pending', // Will be verified by backend or manually
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Refresh messages
      await fetchMessages();
      setMessage('');
      setShowForm(false);
      alert('Message sent! It will appear after verification.');
    } catch (err) {
      console.error('Error submitting message:', err);
      setError(err.message || 'Failed to submit message');
    } finally {
      setLoading(false);
    }
  }

  async function handleSendPayment() {
    if (!isConnected) {
      alert('Please connect your wallet first');
      return;
    }

    if (!message.trim()) {
      setError('Please enter a message');
      return;
    }

    if (!ethAmount) {
      await fetchETHPrice();
      return;
    }

    setError(null);

    try {
      await sendTransaction({
        to: DEV_WALLET,
        value: parseEther(ethAmount.toFixed(6)),
      });
    } catch (err) {
      console.error('Error sending transaction:', err);
      setError(err.message || 'Failed to send payment');
    }
  }

  const truncateAddress = (addr) => {
    if (!addr) return 'Unknown';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div className="message-board">
      <div className="message-board-header">
        <h3>💬 Message Board</h3>
        <p className="message-board-subtitle">Send a message to the dev ($1 minimum)</p>
      </div>

      {!isConnected && (
        <div className="message-board-connect">
          <p>Connect your wallet to send a message</p>
        </div>
      )}

      {isConnected && !showForm && (
        <button
          className="message-board-button"
          onClick={() => setShowForm(true)}
        >
          ✍️ Write a Message
        </button>
      )}

      {isConnected && showForm && (
        <div className="message-board-form">
          <textarea
            className="message-board-textarea"
            placeholder="Type your message here..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            rows={4}
          />
          <div className="message-board-payment-info">
            <p>
              Cost: <strong>${MIN_PAYMENT_USD.toFixed(2)}</strong> (
              {ethAmount ? `${ethAmount.toFixed(6)} ETH` : 'Loading...'})
            </p>
            {ethPrice && <p className="eth-price">ETH Price: ${ethPrice.toFixed(2)}</p>}
          </div>

          {error && <div className="message-board-error">{error}</div>}
          {txError && <div className="message-board-error">{txError.message}</div>}

          <div className="message-board-actions">
            <button
              className="message-board-button secondary"
              onClick={() => {
                setShowForm(false);
                setMessage('');
                setError(null);
              }}
              disabled={isPending || isConfirming}
            >
              Cancel
            </button>
            <button
              className="message-board-button primary"
              onClick={handleSendPayment}
              disabled={isPending || isConfirming || !message.trim() || !ethAmount}
            >
              {isPending
                ? 'Confirm in Wallet...'
                : isConfirming
                ? 'Confirming...'
                : `Send $${MIN_PAYMENT_USD.toFixed(2)} & Message`}
            </button>
          </div>
        </div>
      )}

      <div className="message-board-list">
        <h4>Recent Messages ({messages.length})</h4>
        {messages.length === 0 ? (
          <p className="no-messages">No messages yet. Be the first!</p>
        ) : (
          <div className="messages">
            {messages.map((msg) => (
              <div key={msg.id} className="message-item">
                <div className="message-header">
                  <span className="message-sender">{truncateAddress(msg.sender_address)}</span>
                  <span className="message-time">
                    {new Date(msg.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="message-content">{msg.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MessageBoard;

