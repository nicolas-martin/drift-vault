'use client';

import { FC, ReactNode, useMemo } from 'react';
import {
	ConnectionProvider,
	WalletProvider as SolanaWalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { config } from '@/config';

import '@solana/wallet-adapter-react-ui/styles.css';

interface WalletProviderProps {
	children: ReactNode;
}

export const WalletProvider: FC<WalletProviderProps> = ({ children }) => {
	// Phantom is the most popular Solana wallet
	// Other wallets can be auto-detected via Wallet Standard
	const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

	return (
		<ConnectionProvider endpoint={config.rpcUrl}>
			<SolanaWalletProvider wallets={wallets} autoConnect>
				<WalletModalProvider>{children}</WalletModalProvider>
			</SolanaWalletProvider>
		</ConnectionProvider>
	);
};
