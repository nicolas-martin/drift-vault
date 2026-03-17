/**
 * Check Funding Rates Utility
 *
 * Standalone script to check current funding rates on Drift Protocol
 * without running the full keeper. Useful for manual monitoring.
 *
 * Run with: npx ts-node scripts/check-funding.ts
 *
 * Options:
 *   --all    Show funding for SOL, BTC, and ETH perps
 */

import { Connection, Keypair } from '@solana/web3.js';
import {
  DriftClient,
  Wallet,
  BulkAccountLoader,
  initialize,
  getMarketsAndOraclesForSubscription,
  PRICE_PRECISION,
  convertToNumber,
  PerpMarkets,
} from '@drift-labs/sdk';
import dotenv from 'dotenv';
import path from 'path';

// Load environment from keeper directory
dotenv.config({ path: path.resolve(__dirname, '../keeper/.env') });

// =============================================================================
// Configuration
// =============================================================================

const RPC_URL = process.env['RPC_URL'] || 'https://api.devnet.solana.com';
const DRIFT_ENV = (process.env['DRIFT_ENV'] || 'devnet') as 'devnet' | 'mainnet-beta';

// Strategy thresholds (annualized %)
const OPEN_THRESHOLD = Number(process.env['MIN_FUNDING_RATE_THRESHOLD']) || 10;
const CLOSE_THRESHOLD = Number(process.env['NEGATIVE_FUNDING_CLOSE_THRESHOLD']) || -5;
const WAIT_THRESHOLD = OPEN_THRESHOLD / 2; // Below this, recommend waiting

// Market indexes
const MARKETS = {
  'SOL-PERP': 0,
  'BTC-PERP': 1,
  'ETH-PERP': 2,
} as const;

// =============================================================================
// Types
// =============================================================================

interface FundingInfo {
  market: string;
  marketIndex: number;
  fundingRateHourly: number;
  fundingRateAnnualized: number;
  oraclePrice: number;
  recommendation: 'OPEN' | 'WAIT' | 'CLOSE' | 'NEUTRAL';
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const showAll = process.argv.includes('--all');

  console.log('============================================');
  console.log('  Drift Protocol Funding Rate Check');
  console.log('============================================');
  console.log(`Environment: ${DRIFT_ENV}`);
  console.log(`RPC: ${RPC_URL.substring(0, 40)}...`);
  console.log('');

  let driftClient: DriftClient | null = null;

  try {
    // Initialize connection
    const connection = new Connection(RPC_URL, 'confirmed');

    // Create a dummy wallet (we're only reading data)
    const dummyKeypair = Keypair.generate();
    const wallet = new Wallet(dummyKeypair);

    // Initialize SDK config
    const sdkConfig = initialize({ env: DRIFT_ENV });

    // Create bulk account loader
    const bulkAccountLoader = new BulkAccountLoader(connection, 'confirmed', 1000);

    // Get markets and oracles
    const { perpMarketIndexes, spotMarketIndexes, oracleInfos } =
      getMarketsAndOraclesForSubscription(DRIFT_ENV);

    // Create DriftClient (read-only)
    driftClient = new DriftClient({
      connection,
      wallet,
      programID: sdkConfig.DRIFT_PROGRAM_ID,
      accountSubscription: {
        type: 'polling',
        accountLoader: bulkAccountLoader,
      },
      perpMarketIndexes,
      spotMarketIndexes,
      oracleInfos,
      env: DRIFT_ENV,
    });

    // Subscribe to market data
    console.log('Connecting to Drift Protocol...');
    await driftClient.subscribe();
    console.log('Connected!\n');

    // Determine which markets to check
    const marketsToCheck: Array<{ name: string; index: number }> = showAll
      ? [
          { name: 'SOL-PERP', index: MARKETS['SOL-PERP'] },
          { name: 'BTC-PERP', index: MARKETS['BTC-PERP'] },
          { name: 'ETH-PERP', index: MARKETS['ETH-PERP'] },
        ]
      : [{ name: 'SOL-PERP', index: MARKETS['SOL-PERP'] }];

    // Fetch and display funding info for each market
    const fundingInfos: FundingInfo[] = [];

    for (const market of marketsToCheck) {
      const info = getFundingInfo(driftClient, market.name, market.index);
      if (info) {
        fundingInfos.push(info);
      }
    }

    // Display results
    console.log('============================================');
    console.log('  Current Funding Rates');
    console.log('============================================');
    console.log('');

    for (const info of fundingInfos) {
      displayFundingInfo(info);
    }

    // Display thresholds
    console.log('--------------------------------------------');
    console.log('Strategy Thresholds:');
    console.log(`  OPEN position when APR > ${OPEN_THRESHOLD}%`);
    console.log(`  WAIT when APR between ${CLOSE_THRESHOLD}% and ${OPEN_THRESHOLD}%`);
    console.log(`  CLOSE position when APR < ${CLOSE_THRESHOLD}%`);
    console.log('');

    // Summary recommendation
    const solInfo = fundingInfos.find((i) => i.market === 'SOL-PERP');
    if (solInfo) {
      console.log('============================================');
      console.log('  Recommendation');
      console.log('============================================');
      console.log('');
      console.log(`SOL-PERP: ${getRecommendationText(solInfo)}`);
      console.log('');
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    // Clean up
    if (driftClient) {
      await driftClient.unsubscribe();
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function getFundingInfo(
  driftClient: DriftClient,
  marketName: string,
  marketIndex: number
): FundingInfo | null {
  try {
    const perpMarket = driftClient.getPerpMarketAccount(marketIndex);

    if (!perpMarket) {
      console.warn(`Market ${marketName} not found`);
      return null;
    }

    // Get last funding rate
    const lastFundingRate = perpMarket.amm.lastFundingRate;
    const oraclePrice = perpMarket.amm.historicalOracleData.lastOraclePrice;

    // Convert to numbers
    const fundingRateNum = convertToNumber(lastFundingRate, PRICE_PRECISION);
    const oraclePriceNum = convertToNumber(oraclePrice, PRICE_PRECISION);

    // Calculate hourly rate (funding rate is per oracle price)
    const fundingRateHourly = oraclePriceNum > 0 ? (fundingRateNum / oraclePriceNum) * 100 : 0;

    // Annualize: hourly * 24 * 365
    const fundingRateAnnualized = fundingRateHourly * 24 * 365;

    // Determine recommendation
    let recommendation: 'OPEN' | 'WAIT' | 'CLOSE' | 'NEUTRAL';
    if (fundingRateAnnualized > OPEN_THRESHOLD) {
      recommendation = 'OPEN';
    } else if (fundingRateAnnualized < CLOSE_THRESHOLD) {
      recommendation = 'CLOSE';
    } else if (fundingRateAnnualized > WAIT_THRESHOLD) {
      recommendation = 'NEUTRAL';
    } else {
      recommendation = 'WAIT';
    }

    return {
      market: marketName,
      marketIndex,
      fundingRateHourly,
      fundingRateAnnualized,
      oraclePrice: oraclePriceNum,
      recommendation,
    };
  } catch (error) {
    console.error(`Error getting funding for ${marketName}:`, error);
    return null;
  }
}

function displayFundingInfo(info: FundingInfo): void {
  const signHourly = info.fundingRateHourly >= 0 ? '+' : '';
  const signAnnual = info.fundingRateAnnualized >= 0 ? '+' : '';

  console.log(`${info.market}:`);
  console.log(`  Oracle Price:    $${info.oraclePrice.toFixed(2)}`);
  console.log(`  Funding Rate:    ${signHourly}${info.fundingRateHourly.toFixed(4)}%/hour`);
  console.log(`  Annualized APR:  ${signAnnual}${info.fundingRateAnnualized.toFixed(2)}%`);
  console.log(`  Signal:          ${getSignalEmoji(info.recommendation)} ${info.recommendation}`);
  console.log('');
}

function getSignalEmoji(recommendation: string): string {
  switch (recommendation) {
    case 'OPEN':
      return '[+]';
    case 'CLOSE':
      return '[-]';
    case 'WAIT':
      return '[~]';
    default:
      return '[ ]';
  }
}

function getRecommendationText(info: FundingInfo): string {
  switch (info.recommendation) {
    case 'OPEN':
      return `Funding is favorable (${info.fundingRateAnnualized.toFixed(1)}% APR). Consider opening/maintaining position.`;
    case 'CLOSE':
      return `Funding is negative (${info.fundingRateAnnualized.toFixed(1)}% APR). Consider closing position.`;
    case 'WAIT':
      return `Funding is low (${info.fundingRateAnnualized.toFixed(1)}% APR). Wait for better conditions.`;
    default:
      return `Funding is neutral (${info.fundingRateAnnualized.toFixed(1)}% APR). Monitor closely.`;
  }
}

// =============================================================================
// Entry Point
// =============================================================================

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
