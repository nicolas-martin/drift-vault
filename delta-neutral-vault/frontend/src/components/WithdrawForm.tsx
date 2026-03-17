'use client';

import { FC, useState, useCallback } from 'react';
import BN from 'bn.js';
import { UserVaultData, VaultData } from '@/hooks/useVault';
import styles from './Form.module.css';

interface WithdrawFormProps {
  vaultData: VaultData | null;
  userData: UserVaultData | null;
  isLoading: boolean;
  onRequestWithdraw: (shares: BN) => Promise<string>;
  onWithdraw: () => Promise<string>;
}

function formatShares(amount: BN | null): string {
  if (!amount) return '0';
  return (amount.toNumber() / 1e6).toLocaleString('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function formatUsdc(amount: BN | null): string {
  if (!amount) return '0.00';
  return (amount.toNumber() / 1e6).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export const WithdrawForm: FC<WithdrawFormProps> = ({
  vaultData,
  userData,
  isLoading,
  onRequestWithdraw,
  onWithdraw,
}) => {
  const [shares, setShares] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasPendingWithdrawal = userData?.pendingWithdrawal.gt(new BN(0)) ?? false;
  const withdrawalReady = hasPendingWithdrawal && userData?.withdrawalEligibleAt
    ? new Date() >= userData.withdrawalEligibleAt
    : false;

  const timeRemaining = userData?.withdrawalEligibleAt
    ? Math.max(0, userData.withdrawalEligibleAt.getTime() - Date.now())
    : 0;

  const formatTimeRemaining = (ms: number): string => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const handleMaxClick = useCallback(() => {
    if (userData?.shares) {
      setShares((userData.shares.toNumber() / 1e6).toString());
    }
  }, [userData]);

  const handleRequestWithdraw = useCallback(async () => {
    const parsedShares = parseFloat(shares);
    if (isNaN(parsedShares) || parsedShares <= 0) {
      setErrorMessage('Please enter a valid share amount');
      setStatus('error');
      return;
    }

    const sharesBn = new BN(Math.floor(parsedShares * 1e6));
    
    if (userData?.shares && sharesBn.gt(userData.shares)) {
      setErrorMessage('Insufficient shares');
      setStatus('error');
      return;
    }

    setStatus('pending');
    setErrorMessage(null);
    setTxHash(null);

    try {
      const tx = await onRequestWithdraw(sharesBn);
      setTxHash(tx);
      setStatus('success');
      setShares('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Request failed');
      setStatus('error');
    }
  }, [shares, userData, onRequestWithdraw]);

  const handleCompleteWithdraw = useCallback(async () => {
    setStatus('pending');
    setErrorMessage(null);
    setTxHash(null);

    try {
      const tx = await onWithdraw();
      setTxHash(tx);
      setStatus('success');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Withdrawal failed');
      setStatus('error');
    }
  }, [onWithdraw]);

  const estimatedValue = shares && vaultData
    ? (parseFloat(shares) * vaultData.sharePrice).toFixed(2)
    : '0.00';

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Withdraw</h2>

      <div className={styles.balanceRow}>
        <span className={styles.balanceLabel}>Your Shares:</span>
        <span className={styles.balanceValue}>{formatShares(userData?.shares ?? null)}</span>
      </div>

      <div className={styles.balanceRow}>
        <span className={styles.balanceLabel}>Value:</span>
        <span className={styles.balanceValue}>${formatUsdc(userData?.value ?? null)} USDC</span>
      </div>

      {hasPendingWithdrawal && (
        <div className={styles.pendingSection}>
          <h3 className={styles.pendingTitle}>Pending Withdrawal</h3>
          <div className={styles.pendingInfo}>
            <span>{formatShares(userData?.pendingWithdrawal ?? null)} shares</span>
            {withdrawalReady ? (
              <span className={styles.ready}>Ready to withdraw</span>
            ) : (
              <span className={styles.waiting}>
                {formatTimeRemaining(timeRemaining)} remaining
              </span>
            )}
          </div>
          <button
            type="button"
            className={styles.submitButton}
            onClick={handleCompleteWithdraw}
            disabled={isLoading || status === 'pending' || !withdrawalReady}
          >
            {status === 'pending' ? 'Withdrawing...' : 'Complete Withdrawal'}
          </button>
        </div>
      )}

      {!hasPendingWithdrawal && (
        <>
          <div className={styles.inputGroup}>
            <div className={styles.inputWrapper}>
              <input
                type="number"
                className={styles.input}
                placeholder="0.0000"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                disabled={isLoading || status === 'pending'}
                min="0"
                step="0.0001"
              />
              <span className={styles.inputSuffix}>Shares</span>
            </div>
            <button
              type="button"
              className={styles.maxButton}
              onClick={handleMaxClick}
              disabled={isLoading || status === 'pending' || !userData?.shares}
            >
              MAX
            </button>
          </div>

          <div className={styles.estimateRow}>
            <span className={styles.estimateLabel}>Estimated value:</span>
            <span className={styles.estimateValue}>~${estimatedValue} USDC</span>
          </div>

          <button
            type="button"
            className={styles.submitButton}
            onClick={handleRequestWithdraw}
            disabled={isLoading || status === 'pending' || !shares}
          >
            {status === 'pending' ? 'Requesting...' : 'Request Withdrawal'}
          </button>

          <p className={styles.note}>
            Withdrawals have a redemption period. After requesting, you must wait
            before completing the withdrawal.
          </p>
        </>
      )}

      {status === 'success' && txHash && (
        <div className={styles.success}>
          Transaction successful!{' '}
          <a
            href={`https://explorer.solana.com/tx/${txHash}`}
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
