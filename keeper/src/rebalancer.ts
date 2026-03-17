import {
  getVaultSolSpotPosition,
  getVaultSolPerpPosition,
  getSolPrice,
} from './driftClient';
import { StrategyParams } from './config';
import { logger } from './logger';

// =============================================================================
// Types
// =============================================================================

export interface PositionState {
  /** SOL spot position size in SOL units */
  spotSolSize: number;
  /** SOL perp position size in SOL units (negative = short) */
  perpSolSize: number;
  /** Spot position USD value */
  spotUsdValue: number;
  /** Perp position USD value (absolute) */
  perpUsdValue: number;
  /** Imbalance percentage between spot and perp */
  imbalancePct: number;
  /** Whether positions are balanced within threshold */
  isBalanced: boolean;
}

// =============================================================================
// Position State Functions
// =============================================================================

/**
 * Get the current state of spot and perp positions
 * @returns PositionState with all position details
 */
export function getPositionState(): PositionState {
  const spotSolSize = getVaultSolSpotPosition();
  const perpSolSize = getVaultSolPerpPosition();
  const solPrice = getSolPrice();

  // Calculate USD values
  const spotUsdValue = spotSolSize * solPrice;
  const perpUsdValue = Math.abs(perpSolSize) * solPrice;

  // Calculate imbalance percentage
  // For delta-neutral: spot should equal |perp| (perp is negative for short)
  // Imbalance = |spotUsd - perpUsd| / max(spotUsd, perpUsd) * 100
  const maxValue = Math.max(spotUsdValue, perpUsdValue);
  const imbalancePct = maxValue > 0
    ? (Math.abs(spotUsdValue - perpUsdValue) / maxValue) * 100
    : 0;

  const isBalanced = imbalancePct < StrategyParams.REBALANCE_THRESHOLD_PCT;

  return {
    spotSolSize,
    perpSolSize,
    spotUsdValue,
    perpUsdValue,
    imbalancePct,
    isBalanced,
  };
}

/**
 * Log the current position state in human-readable format
 * @param state Position state to log
 */
export function logPositionState(state: PositionState): void {
  const perpDirection = state.perpSolSize < 0 ? 'SHORT' : state.perpSolSize > 0 ? 'LONG' : 'NONE';

  logger.info('Position State', {
    component: 'rebalancer',
    spotSol: state.spotSolSize.toFixed(4),
    spotUsd: `$${state.spotUsdValue.toFixed(2)}`,
    perpSol: `${state.perpSolSize.toFixed(4)} (${perpDirection})`,
    perpUsd: `$${state.perpUsdValue.toFixed(2)}`,
    imbalance: `${state.imbalancePct.toFixed(2)}%`,
    isBalanced: state.isBalanced,
  });

  if (!state.isBalanced) {
    logger.warn('Position imbalance detected', {
      component: 'rebalancer',
      imbalancePct: state.imbalancePct.toFixed(2),
      threshold: StrategyParams.REBALANCE_THRESHOLD_PCT,
    });
  }
}

/**
 * Check if positions exist (either spot or perp)
 * @param state Position state
 * @returns true if there are any open positions
 */
export function hasOpenPositions(state: PositionState): boolean {
  return Math.abs(state.spotSolSize) > 0.0001 || Math.abs(state.perpSolSize) > 0.0001;
}
