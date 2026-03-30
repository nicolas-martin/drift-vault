'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import {
	DriftClient,
	IWallet,
	QUOTE_PRECISION,
	initialize,
	getMarketsAndOraclesForSubscription,
} from '@drift-labs/sdk';

// Drift's USDC mint per network — hardcoded so we don't rely on DriftClient
// spot market subscription (which is heavier and can fail during init)
const USDC_MINT: Record<string, string> = {
	'devnet': '8zGuJQqwhZafTah7Uc7Z4tXRnguqkn5KLFAP8oV6PHe2', // Drift devnet USDC
	'mainnet-beta': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};
import { VaultClient, getVaultDepositorAddressSync, type DriftVaults } from '@drift-labs/vaults-sdk';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { config } from '@/config';
import DRIFT_VAULTS_IDL from '@/idl/drift_vaults.json';

export interface VaultData {
	totalEquity: BN;
	sharePrice: number;
	totalShares: BN;
	estimatedApy: number;
}

export interface UserVaultData {
	shares: BN;
	value: BN;
	pendingWithdrawal: BN;
	withdrawalEligibleAt: Date | null;
}

export interface UseVaultReturn {
	vaultData: VaultData | null;
	userData: UserVaultData | null;
	userUsdcBalance: BN | null;
	isLoading: boolean;
	isInitialized: boolean;
	error: string | null;
	deposit: (amount: BN) => Promise<string>;
	requestWithdraw: (shares: BN) => Promise<string>;
	withdraw: () => Promise<string>;
	refresh: () => Promise<void>;
}

const USDC_DECIMALS = 6;

export function useVault(): UseVaultReturn {
	const { connection } = useConnection();
	const wallet = useWallet();

	const [driftClient, setDriftClient] = useState<DriftClient | null>(null);
	const [vaultClient, setVaultClient] = useState<VaultClient | null>(null);
	const [vaultData, setVaultData] = useState<VaultData | null>(null);
	const [userData, setUserData] = useState<UserVaultData | null>(null);
	const [userUsdcBalance, setUserUsdcBalance] = useState<BN | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isInitialized, setIsInitialized] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Ref so the cleanup function always sees the latest client without stale closure
	const driftClientRef = useRef<DriftClient | null>(null);

	// Initialize clients when wallet connects
	useEffect(() => {
		const initClients = async () => {
			if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
				setDriftClient(null);
				setVaultClient(null);
				setIsInitialized(false);
				return;
			}

			if (!config.vaultAddress) {
				setError('Vault address not configured');
				return;
			}

			setIsLoading(true);
			setError(null);

			try {
				const walletAdapter: IWallet = {
					publicKey: wallet.publicKey,
					signTransaction: wallet.signTransaction,
					signAllTransactions: wallet.signAllTransactions,
				};

				// @ts-ignore — accessing private rpcEndpoint for debugging
				const connEndpoint = (connection as any)?.rpcEndpoint || (connection as any)?._rpcEndpoint || 'unknown';
				console.log('[useVault] Initializing DriftClient...', {
					env: config.driftEnv,
					configRpcUrl: config.rpcUrl.substring(0, 60),
					connectionEndpoint: typeof connEndpoint === 'string' ? connEndpoint.substring(0, 60) : connEndpoint,
					wallet: wallet.publicKey.toBase58(),
				});

				const sdkConfig = initialize({ env: config.driftEnv });
				const { perpMarketIndexes, spotMarketIndexes, oracleInfos } =
					getMarketsAndOraclesForSubscription(config.driftEnv);

				const drift = new DriftClient({
					connection,
					wallet: walletAdapter,
					env: config.driftEnv,
					programID: new PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
					perpMarketIndexes,
					spotMarketIndexes,
					oracleInfos,
					accountSubscription: { type: 'websocket' },
				});

				console.log('[useVault] Subscribing to Drift...');
				await drift.subscribe();
				console.log('[useVault] Drift subscribed successfully');
				driftClientRef.current = drift;
				setDriftClient(drift);

				// Use bundled IDL — avoids on-chain IDL fetch which can fail
				const vaultsProgram = new Program<DriftVaults>(
					DRIFT_VAULTS_IDL as unknown as DriftVaults,
					config.vaultsProgramId,
					drift.provider as AnchorProvider
				);

				const vault = new VaultClient({
					driftClient: drift,
					program: vaultsProgram,
				});

				console.log('[useVault] VaultClient initialized');
				setVaultClient(vault);
				setIsInitialized(true);
			} catch (err) {
				console.error('[useVault] INIT FAILED:', err);
				setError(err instanceof Error ? err.message : 'Failed to initialize');
			} finally {
				setIsLoading(false);
			}
		};

		initClients();

		return () => {
			// Use ref to avoid stale closure — always unsubscribes the latest client
			if (driftClientRef.current) {
				driftClientRef.current.unsubscribe();
				driftClientRef.current = null;
			}
		};
	}, [wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions, connection]);

	// Fetch vault and user data
	const refresh = useCallback(async () => {
		if (!vaultClient || !driftClient || !config.vaultAddress) {
			return;
		}

		setIsLoading(true);
		setError(null);

		try {
			// Fetch vault account data
			const vaultAccount = await vaultClient.getVault(config.vaultAddress);

			if (!vaultAccount) {
				throw new Error('Vault not found');
			}

			// Use calculateVaultEquity for accurate on-chain equity (includes trading PnL + funding)
			// Falls back to netDeposits if the vault user hasn't loaded yet
			let totalEquityBN: BN;
			try {
				totalEquityBN = await vaultClient.calculateVaultEquity({ address: config.vaultAddress });
			} catch {
				totalEquityBN = vaultAccount.netDeposits;
			}

			const totalShares = vaultAccount.totalShares;

			// Share price in USDC (with QUOTE_PRECISION = 1e6)
			// Computed entirely in BN to avoid float precision loss
			const sharePriceBN = totalShares.gt(new BN(0))
				? totalEquityBN.mul(QUOTE_PRECISION).div(totalShares)
				: QUOTE_PRECISION; // 1.0 default

			const sharePrice = sharePriceBN.toNumber() / QUOTE_PRECISION.toNumber();

			// Estimated APY — shown as "--" until we wire up historical data
			const estimatedApy = 0; // TODO: fetch from Drift data API

			setVaultData({
				totalEquity: totalEquityBN,
				sharePrice,
				totalShares,
				estimatedApy,
			});

			// Fetch user data if wallet connected
			if (wallet.publicKey) {
				// Fetch vault depositor data (may not exist for new users)
				try {
					// Derive the vault depositor address from vault and user authority
					const vaultDepositorAddress = getVaultDepositorAddressSync(
						vaultClient.program.programId,
						config.vaultAddress,
						wallet.publicKey
					);
					const vaultDepositor = await vaultClient.getVaultDepositor(vaultDepositorAddress);

					if (vaultDepositor) {
						const userShares = vaultDepositor.vaultShares;
						// Value = userShares * totalEquity / totalShares  (all in BN, avoids float errors)
						const userValue = totalShares.gt(new BN(0))
							? userShares.mul(totalEquityBN).div(totalShares)
							: new BN(0);

						const pendingWithdrawal = vaultDepositor.lastWithdrawRequest?.shares ?? new BN(0);
						const withdrawalTs = vaultDepositor.lastWithdrawRequest?.ts;
						const redemptionPeriod = vaultAccount.redeemPeriod?.toNumber() ?? 0;

						const withdrawalEligibleAt = withdrawalTs
							? new Date((withdrawalTs.toNumber() + redemptionPeriod) * 1000)
							: null;

						setUserData({
							shares: userShares,
							value: userValue,
							pendingWithdrawal,
							withdrawalEligibleAt,
						});
					} else {
						setUserData({
							shares: new BN(0),
							value: new BN(0),
							pendingWithdrawal: new BN(0),
							withdrawalEligibleAt: null,
						});
					}
				} catch (err) {
					// User might not have a depositor account yet
					console.log('User vault data not found:', err);
					setUserData({
						shares: new BN(0),
						value: new BN(0),
						pendingWithdrawal: new BN(0),
						withdrawalEligibleAt: null,
					});
				}

				// Fetch user USDC balance — always runs regardless of depositor status
				const usdcMintStr = USDC_MINT[config.driftEnv];
				if (usdcMintStr) {
					try {
						const usdcMintPk = new PublicKey(usdcMintStr);
						const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
							wallet.publicKey,
							{ mint: usdcMintPk }
						);
						if (tokenAccounts.value.length > 0) {
							const balance = tokenAccounts.value[0]!.account.data.parsed.info.tokenAmount.amount;
							console.log('[useVault] USDC balance raw:', balance);
							setUserUsdcBalance(new BN(balance));
						} else {
							console.log('[useVault] No USDC token account found for', usdcMintStr);
							setUserUsdcBalance(new BN(0));
						}
					} catch (balanceErr) {
						console.warn('[useVault] Failed to fetch USDC balance:', balanceErr);
						setUserUsdcBalance(new BN(0));
					}
				}
			}
		} catch (err) {
			console.error('Failed to fetch vault data:', err);
			setError(err instanceof Error ? err.message : 'Failed to fetch data');
		} finally {
			setIsLoading(false);
		}
	}, [vaultClient, driftClient, wallet.publicKey, connection]);

	// Auto-refresh on initialization
	useEffect(() => {
		if (isInitialized) {
			refresh();
		}
	}, [isInitialized, refresh]);

	// Auto-refresh every 30 seconds while initialized
	useEffect(() => {
		if (!isInitialized) return;
		const interval = setInterval(() => { refresh(); }, 30_000);
		return () => clearInterval(interval);
	}, [isInitialized, refresh]);

	// Deposit USDC into vault
	const deposit = useCallback(
		async (amount: BN): Promise<string> => {
			if (!vaultClient || !wallet.publicKey || !config.vaultAddress) {
				throw new Error('Vault client not initialized');
			}

			setIsLoading(true);
			setError(null);

			try {
				const vaultDepositorAddress = getVaultDepositorAddressSync(
					vaultClient.program.programId,
					config.vaultAddress,
					wallet.publicKey
				);

				// Check if VaultDepositor account exists — if not, initialize on first deposit
				let needsInit = false;
				try {
					await vaultClient.getVaultDepositor(vaultDepositorAddress);
				} catch {
					needsInit = true;
				}

				const tx = await vaultClient.deposit(
					vaultDepositorAddress,
					amount,
					needsInit
						? { vault: config.vaultAddress, authority: wallet.publicKey }
						: undefined
				);
				await refresh();
				return tx;
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Deposit failed';
				setError(message);
				throw err;
			} finally {
				setIsLoading(false);
			}
		},
		[vaultClient, wallet.publicKey, refresh]
	);

	// Request withdrawal (starts redemption period)
	const requestWithdraw = useCallback(
		async (shares: BN): Promise<string> => {
			if (!vaultClient || !wallet.publicKey || !config.vaultAddress) {
				throw new Error('Vault client not initialized');
			}

			setIsLoading(true);
			setError(null);

			try {
				const vaultDepositorAddress = getVaultDepositorAddressSync(
					vaultClient.program.programId,
					config.vaultAddress,
					wallet.publicKey
				);
				const tx = await vaultClient.requestWithdraw(vaultDepositorAddress, shares, {
					subAccountId: 0,
				});
				await refresh();
				return tx;
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Withdrawal request failed';
				setError(message);
				throw err;
			} finally {
				setIsLoading(false);
			}
		},
		[vaultClient, wallet.publicKey, refresh]
	);

	// Complete withdrawal (after redemption period)
	const withdraw = useCallback(async (): Promise<string> => {
		if (!vaultClient || !wallet.publicKey || !config.vaultAddress) {
			throw new Error('Vault client not initialized');
		}

		setIsLoading(true);
		setError(null);

		try {
			const vaultDepositorAddress = getVaultDepositorAddressSync(
				vaultClient.program.programId,
				config.vaultAddress,
				wallet.publicKey
			);
			const tx = await vaultClient.withdraw(vaultDepositorAddress);
			await refresh();
			return tx;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Withdrawal failed';
			setError(message);
			throw err;
		} finally {
			setIsLoading(false);
		}
	}, [vaultClient, wallet.publicKey, refresh]);

	return {
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
	};
}
