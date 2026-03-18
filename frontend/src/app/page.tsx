'use client';

import { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useVault } from '@/hooks/useVault';
import { VaultStats } from '@/components/VaultStats';
import { DepositForm } from '@/components/DepositForm';
import { WithdrawForm } from '@/components/WithdrawForm';
import { config } from '@/config';
import styles from './page.module.css';

// Defers rendering until after hydration to avoid SSR/client mismatch
// from wallet adapter injecting browser-only icons into buttons
function ClientOnly({ children }: { children: React.ReactNode }) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	if (!mounted) return null;
	return <>{children}</>;
}

// Maps Phantom's network label (from its RPC URL) to our env string
function detectWalletNetwork(endpoint: string): string {
	if (endpoint.includes('devnet')) return 'devnet';
	if (endpoint.includes('testnet')) return 'testnet';
	if (endpoint.includes('mainnet')) return 'mainnet-beta';
	return 'unknown';
}

export default function Home() {
	const { connected } = useWallet();
	const { connection } = useConnection();
	const walletNetwork = detectWalletNetwork(connection.rpcEndpoint);
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
				<ClientOnly>
					<WalletMultiButton />
				</ClientOnly>
			</header>

			<ClientOnly>
				{connected && walletNetwork !== config.driftEnv && (
					<div className={styles.networkBanner}>
						⚠️ Wallet is on <strong>{walletNetwork}</strong> but this app runs on <strong>{config.driftEnv}</strong>.
						Switch Phantom to <strong>{config.driftEnv}</strong> to interact.
					</div>
				)}
			</ClientOnly>

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
