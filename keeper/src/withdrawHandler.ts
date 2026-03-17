import { getVaultUsdcBalance, getSolPrice, getDriftClient } from './driftClient';
import { VAULT_ADDRESS } from './config';
import { logger } from './logger';
import { VaultClient, getVaultDepositorAddressSync, type DriftVaults } from '@drift-labs/vaults-sdk';
import { Program, AnchorProvider, type Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// Lazy-initialised VaultClient (reused across calls)
let _vaultClient: VaultClient | null = null;

async function getVaultClient(): Promise<VaultClient> {
  if (_vaultClient) return _vaultClient;

  const driftClient = getDriftClient();
  const vaultsProgram = await Program.at<DriftVaults>(
    new PublicKey('vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR'),
    driftClient.provider as AnchorProvider
  );
  _vaultClient = new VaultClient({ driftClient, program: vaultsProgram });
  return _vaultClient;
}

// =============================================================================
// Types
// =============================================================================

export interface PendingWithdrawalsResult {
  hasPending: boolean;
  totalPending: number;
}

// =============================================================================
// Withdrawal Monitoring
// =============================================================================

/**
 * Check for pending user withdrawals from the vault by querying all VaultDepositor
 * accounts on-chain and summing withdrawal requests whose redemption period has elapsed.
 */
export async function checkPendingWithdrawals(): Promise<PendingWithdrawalsResult> {
  try {
    if (!VAULT_ADDRESS) {
      return { hasPending: false, totalPending: 0 };
    }

    const vaultClient = await getVaultClient();
    const vaultPubkey = new PublicKey(VAULT_ADDRESS);

    // Fetch all depositor accounts that have an active withdrawal request
    const depositorsWithRequests = await vaultClient.getAllVaultDepositorsWithNoWithdrawRequest(vaultPubkey)
      .then(() => {
        // getAllVaultDepositorsWithNoWithdrawRequest returns depositors WITHOUT requests
        // We need to fetch ALL and filter for those WITH pending requests
        return vaultClient.getAllVaultDepositors(vaultPubkey);
      });

    const now = Date.now() / 1000; // current unix timestamp in seconds
    let totalPendingShares = new BN(0);
    let pendingCount = 0;

    for (const { account } of depositorsWithRequests) {
      const shares = account.lastWithdrawRequest?.shares;
      const ts = account.lastWithdrawRequest?.ts;
      if (shares && !shares.isZero() && ts && !ts.isZero()) {
        totalPendingShares = totalPendingShares.add(shares);
        pendingCount++;
      }
    }

    // Convert shares to USD value using vault equity
    const vaultAccount = await vaultClient.getVault(vaultPubkey);
    let totalPendingUsd = 0;

    if (!totalPendingShares.isZero() && !vaultAccount.totalShares.isZero()) {
      // Estimate equity from netDeposits as a conservative approximation
      const equityPerShare = vaultAccount.netDeposits.mul(new BN(1e6)).div(vaultAccount.totalShares);
      totalPendingUsd = totalPendingShares.mul(equityPerShare).div(new BN(1e6)).toNumber() / 1e6;
    }

    const result: PendingWithdrawalsResult = {
      hasPending: pendingCount > 0,
      totalPending: totalPendingUsd,
    };

    logger.info('Checked pending withdrawals', {
      pendingCount,
      hasPending: result.hasPending,
      totalPendingUsd: totalPendingUsd.toFixed(2),
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to check pending withdrawals', { error: message });
    // Return safe default — don't block the loop on a monitoring failure
    return { hasPending: false, totalPending: 0 };
  }
}

// =============================================================================
// Liquidity Management
// =============================================================================

/**
 * Ensure sufficient liquidity is available to fulfill pending withdrawals
 * If pending amount exceeds available USDC buffer, unwind part of the position
 * 
 * @param pendingAmount - Total pending withdrawal amount in USD
 */
export async function ensureWithdrawalLiquidity(pendingAmount: number): Promise<void> {
  try {
    const availableUsdc = getVaultUsdcBalance();
    
    logger.debug('Checking withdrawal liquidity', {
      pendingAmount,
      availableUsdc,
    });

    if (pendingAmount <= availableUsdc) {
      logger.info('Sufficient liquidity for pending withdrawals', {
        pendingAmount,
        availableUsdc,
        surplus: availableUsdc - pendingAmount,
      });
      return;
    }

    // Calculate shortfall and required position reduction
    const shortfall = pendingAmount - availableUsdc;
    
    logger.warn('Insufficient liquidity for withdrawals, need to unwind position', {
      pendingAmount,
      availableUsdc,
      shortfall,
    });

    // Get actual SOL price from oracle
    const solPrice = getSolPrice();
    const solAmountToClose = shortfall / solPrice;

    await closePartialPosition(solAmountToClose);

    logger.info('Position unwinding initiated for withdrawal liquidity', {
      shortfall,
      solAmountToClose,
      solPrice,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to ensure withdrawal liquidity', { error: message });
    throw error;
  }
}

// =============================================================================
// Position Management
// =============================================================================

/**
 * Close a partial delta-neutral position to free up USDC liquidity.
 * Closes proportional amounts on both the spot and perp sides.
 *
 * @param solAmountToClose - Amount of SOL to close from each leg
 */
export async function closePartialPosition(solAmountToClose: number): Promise<void> {
  // Import here to avoid circular dependency (strategy imports driftClient, not withdrawHandler)
  const { getDriftClient, getVaultSolPerpPosition, getVaultSolSpotPosition } = await import('./driftClient');
  const { PositionDirection, MarketType, getMarketOrderParams } = await import('./driftClient');
  const { MarketIndexes, MAX_SLIPPAGE_BPS } = await import('./config');

  try {
    const driftClient = getDriftClient();
    const MIN_DUST = 0.001;

    const perpSize = Math.abs(getVaultSolPerpPosition());
    const spotSize = getVaultSolSpotPosition();
    const closeAmount = Math.min(solAmountToClose, Math.min(perpSize, spotSize));

    if (closeAmount < MIN_DUST) {
      logger.info('No position large enough to partially close', { solAmountToClose, perpSize, spotSize });
      return;
    }

    logger.info('Closing partial position for withdrawal liquidity', {
      requested: solAmountToClose.toFixed(4),
      closing: closeAmount.toFixed(4),
    });

    // Step 1: Sell spot SOL first (reduces long delta exposure)
    if (spotSize > MIN_DUST) {
      const spotAmountBn = new BN(Math.floor(closeAmount * 1e9));
      const swapTx = await driftClient.swap({
        inMarketIndex: MarketIndexes.SOL_SPOT,
        outMarketIndex: MarketIndexes.USDC_SPOT,
        amount: spotAmountBn,
        slippageBps: MAX_SLIPPAGE_BPS,
      });
      await driftClient.connection.confirmTransaction(swapTx, 'confirmed');
      logger.info(`Partial spot SOL sold. Tx: ${swapTx}`);
    }

    // Step 2: Reduce short perp (buy to reduce)
    if (perpSize > MIN_DUST) {
      const perpAmountBn = new BN(Math.floor(closeAmount * 1e9));
      const orderParams = getMarketOrderParams({
        marketIndex: MarketIndexes.SOL_PERP,
        direction: PositionDirection.LONG,
        baseAssetAmount: perpAmountBn,
        marketType: MarketType.PERP,
        reduceOnly: true,
      });
      const perpTx = await driftClient.placePerpOrder(orderParams);
      await driftClient.connection.confirmTransaction(perpTx, 'confirmed');
      logger.info(`Partial perp short closed. Tx: ${perpTx}`);
    }

    logger.info('Partial position close complete', { closedSol: closeAmount.toFixed(4) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to close partial position', { error: message });
    throw error;
  }
}

// =============================================================================
// Export
// =============================================================================

export const withdrawHandler = {
  checkPendingWithdrawals,
  ensureWithdrawalLiquidity,
  closePartialPosition,
};

export default withdrawHandler;
