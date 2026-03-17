'use client';

import { FC, useState, useCallback } from 'react';
import BN from 'bn.js';
import { config } from '@/config';
import styles from './Form.module.css';

interface DepositFormProps {
  usdcBalance: BN | null;
  isLoading: boolean;
  onDeposit: (amount: BN) => Promise<string>;
}

export const DepositForm: FC<DepositFormProps> = ({
  usdcBalance,
  isLoading,
  onDeposit,
}) => {
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const balanceDisplay = usdcBalance
    ? (usdcBalance.toNumber() / 1e6).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : '0.00';

  const handleMaxClick = useCallback(() => {
    if (usdcBalance) {
      setAmount((usdcBalance.toNumber() / 1e6).toString());
    }
  }, [usdcBalance]);

  const handleDeposit = useCallback(async () => {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setErrorMessage('Please enter a valid amount');
      setStatus('error');
      return;
    }

    const amountBn = new BN(Math.floor(parsedAmount * 1e6));
    
    if (usdcBalance && amountBn.gt(usdcBalance)) {
      setErrorMessage('Insufficient USDC balance');
      setStatus('error');
      return;
    }

    setStatus('pending');
    setErrorMessage(null);
    setTxHash(null);

    try {
      const tx = await onDeposit(amountBn);
      setTxHash(tx);
      setStatus('success');
      setAmount('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Deposit failed');
      setStatus('error');
    }
  }, [amount, usdcBalance, onDeposit]);

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Deposit USDC</h2>

      <div className={styles.balanceRow}>
        <span className={styles.balanceLabel}>Wallet Balance:</span>
        <span className={styles.balanceValue}>{balanceDisplay} USDC</span>
      </div>

      <div className={styles.inputGroup}>
        <div className={styles.inputWrapper}>
          <input
            type="number"
            className={styles.input}
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isLoading || status === 'pending'}
            min="0"
            step="0.01"
          />
          <span className={styles.inputSuffix}>USDC</span>
        </div>
        <button
          type="button"
          className={styles.maxButton}
          onClick={handleMaxClick}
          disabled={isLoading || status === 'pending' || !usdcBalance}
        >
          MAX
        </button>
      </div>

      <button
        type="button"
        className={styles.submitButton}
        onClick={handleDeposit}
        disabled={isLoading || status === 'pending' || !amount}
      >
        {status === 'pending' ? 'Depositing...' : 'Deposit'}
      </button>

      {status === 'success' && txHash && (
        <div className={styles.success}>
          Deposit successful!{' '}
          <a
            href={`https://explorer.solana.com/tx/${txHash}${config.driftEnv === 'devnet' ? '?cluster=devnet' : ''}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.txLink}
          >
            View transaction
          </a>
        </div>
      )}

      {status === 'error' && errorMessage && (
        <div className={styles.error}>{errorMessage}</div>
      )}
    </div>
  );
};
