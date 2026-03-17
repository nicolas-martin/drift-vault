'use client';

import { useState, useEffect, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import {
  DriftClient,
  IWallet,
  BulkAccountLoader,
  QUOTE_PRECISION,
} from '@drift-labs/sdk';
import { VaultClient, getVaultAddressSync } from '@drift-labs/vaults-sdk';
import { config } from '@/config';

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

        const accountLoader = new BulkAccountLoader(connection, 'confirmed', 1000);

        const drift = new DriftClient({
          connection,
          wallet: walletAdapter,
          env: config.driftEnv,
          accountSubscription: {
            type: 'polling',
            accountLoader,
          },
        });

        await drift.subscribe();
        setDriftClient(drift);

        const vault = new VaultClient({
          driftClient: drift,
          programId: getVaultAddressSync('protocol'),
        });

        setVaultClient(vault);
        setIsInitialized(true);
      } catch (err) {
        console.error('Failed to initialize clients:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize');
      } finally {
        setIsLoading(false);
      }
    };

    initClients();

    return () => {
      if (driftClient) {
        driftClient.unsubscribe();
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

      // Calculate vault stats
      const totalEquity = vaultAccount.netDeposits;
      const totalShares = vaultAccount.totalShares;
      
      // Share price = total equity / total shares (with precision handling)
      const sharePrice = totalShares.gt(new BN(0))
        ? totalEquity.mul(QUOTE_PRECISION).div(totalShares).toNumber() / QUOTE_PRECISION.toNumber()
        : 1;

      // Estimated APY from funding (placeholder - would need historical data)
      const estimatedApy = 15.5; // TODO: Calculate from actual funding rates

      setVaultData({
        totalEquity,
        sharePrice,
        totalShares,
        estimatedApy,
      });

      // Fetch user data if wallet connected
      if (wallet.publicKey) {
        try {
          const vaultDepositor = await vaultClient.getVaultDepositor(
            config.vaultAddress,
            wallet.publicKey
          );

          if (vaultDepositor) {
            const userShares = vaultDepositor.vaultShares;
            const userValue = userShares.mul(new BN(Math.floor(sharePrice * 1e6))).div(new BN(1e6));
            
            const pendingWithdrawal = vaultDepositor.lastWithdrawRequest?.shares ?? new BN(0);
            const withdrawalTs = vaultDepositor.lastWithdrawRequest?.ts;
            const redemptionPeriod = vaultAccount.redemptionPeriod?.toNumber() ?? 0;
            
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

          // Fetch user USDC balance
          const usdcMint = driftClient.getSpotMarketAccount(0)?.mint;
          if (usdcMint) {
            const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
              wallet.publicKey,
              { mint: usdcMint }
            );
            
            if (tokenAccounts.value.length > 0) {
              const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;
              setUserUsdcBalance(new BN(balance));
            } else {
              setUserUsdcBalance(new BN(0));
            }
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

  // Deposit USDC into vault
  const deposit = useCallback(
    async (amount: BN): Promise<string> => {
      if (!vaultClient || !wallet.publicKey || !config.vaultAddress) {
        throw new Error('Vault client not initialized');
      }

      setIsLoading(true);
      setError(null);

      try {
        const tx = await vaultClient.deposit(config.vaultAddress, amount);
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
        const tx = await vaultClient.requestWithdraw(config.vaultAddress, shares, {
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
      const tx = await vaultClient.withdraw(config.vaultAddress);
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
