'use client';

import { FC } from 'react';
import BN from 'bn.js';
import { VaultData, UserVaultData } from '@/hooks/useVault';
import styles from './VaultStats.module.css';

interface VaultStatsProps {
  vaultData: VaultData | null;
  userData: UserVaultData | null;
  isLoading: boolean;
}

// Safe formatter — handles large BN values by dividing before converting to avoid overflow
function formatUsdc(amount: BN | null): string {
  if (!amount) return '0.00';
  // Divide by 1e3 first (BN safe), then divide remaining 1e3 as float
  const value = amount.divn(1_000).toNumber() / 1_000;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatShares(amount: BN | null): string {
  if (!amount) return '0';
  const value = amount.divn(1_000).toNumber() / 1_000;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export const VaultStats: FC<VaultStatsProps> = ({ vaultData, userData, isLoading }) => {
  if (isLoading && !vaultData) {
    return (
      <div className={styles.container}>
        <h2 className={styles.title}>Vault Statistics</h2>
        <div className={styles.loading}>Loading vault data...</div>
      </div>
    );
  }

  if (!vaultData) {
    return (
      <div className={styles.container}>
        <h2 className={styles.title}>Vault Statistics</h2>
        <div className={styles.empty}>Connect wallet to view vault data</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Vault Statistics</h2>
      
      <div className={styles.grid}>
        <div className={styles.stat}>
          <span className={styles.label}>Total Vault Equity</span>
          <span className={styles.value}>${formatUsdc(vaultData.totalEquity)} USDC</span>
        </div>
        
        <div className={styles.stat}>
          <span className={styles.label}>Share Price</span>
          <span className={styles.value}>
            ${vaultData.sharePrice.toFixed(4)}
          </span>
        </div>
        
        <div className={styles.stat}>
          <span className={styles.label}>Estimated APY</span>
          <span className={styles.valueHighlight}>
            {vaultData.estimatedApy > 0 ? `${vaultData.estimatedApy.toFixed(2)}%` : '--'}
          </span>
        </div>
        
        <div className={styles.stat}>
          <span className={styles.label}>Total Shares</span>
          <span className={styles.value}>{formatShares(vaultData.totalShares)}</span>
        </div>
      </div>

      {userData && (
        <>
          <h3 className={styles.subtitle}>Your Position</h3>
          <div className={styles.grid}>
            <div className={styles.stat}>
              <span className={styles.label}>Your Shares</span>
              <span className={styles.value}>{formatShares(userData.shares)}</span>
            </div>
            
            <div className={styles.stat}>
              <span className={styles.label}>Your Value</span>
              <span className={styles.value}>${formatUsdc(userData.value)} USDC</span>
            </div>

            {userData.pendingWithdrawal.gt(new BN(0)) && (
              <div className={styles.stat}>
                <span className={styles.label}>Pending Withdrawal</span>
                <span className={styles.valueWarning}>
                  {formatShares(userData.pendingWithdrawal)} shares
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
