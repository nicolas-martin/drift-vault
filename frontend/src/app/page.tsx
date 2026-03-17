'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useVault } from '@/hooks/useVault';
import { VaultStats } from '@/components/VaultStats';
import { DepositForm } from '@/components/DepositForm';
import { WithdrawForm } from '@/components/WithdrawForm';
import styles from './page.module.css';

export default function Home() {
  const { connected } = useWallet();
  const {
    vaultData,
    userData,
    userUsdcBalance,
    isLoading,
    isInitialized,
    error,
    deposit,
    requestWithdraw,
    withdraw,
    refresh,
  } = useVault();

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <h1>Delta-Neutral Vault</h1>
          <span className={styles.tagline}>Funding Rate Arbitrage on Drift</span>
        </div>
        <WalletMultiButton />
      </header>

      {error && (
        <div className={styles.errorBanner}>
          {error}
          <button onClick={refresh} className={styles.retryButton}>
            Retry
          </button>
        </div>
      )}

      <div className={styles.content}>
        <VaultStats
          vaultData={vaultData}
          userData={userData}
          isLoading={isLoading}
        />

        {connected && isInitialized ? (
          <div className={styles.forms}>
            <DepositForm
              usdcBalance={userUsdcBalance}
              isLoading={isLoading}
              onDeposit={deposit}
            />
            <WithdrawForm
              vaultData={vaultData}
              userData={userData}
              isLoading={isLoading}
              onRequestWithdraw={requestWithdraw}
              onWithdraw={withdraw}
            />
          </div>
        ) : connected && isLoading ? (
          <div className={styles.connectPrompt}>
            <p>Initializing vault connection...</p>
          </div>
        ) : (
          <div className={styles.connectPrompt}>
            <p>Connect your wallet to deposit or withdraw from the vault.</p>
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        <p>
          Powered by{' '}
          <a
            href="https://www.drift.trade/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Drift Protocol
          </a>
        </p>
      </footer>
    </main>
  );
}
