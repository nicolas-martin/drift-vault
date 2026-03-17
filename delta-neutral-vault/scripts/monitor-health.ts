/**
 * Monitor Health Utility
 *
 * Quick health check script for the delta-neutral vault.
 * Displays account health, collateral, margin usage, and positions.
 * Exits with code 1 if health is below threshold (useful for alerting).
 *
 * Run with: npx ts-node scripts/monitor-health.ts
 *
 * Options:
 *   --threshold <n>  Health threshold to trigger alert (default: from config or 20)
 *   --json           Output as JSON (for programmatic use)
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  DriftClient,
  Wallet,
  BulkAccountLoader,
  initialize,
  getMarketsAndOraclesForSubscription,
  PRICE_PRECISION,
  QUOTE_PRECISION,
  BASE_PRECISION,
  convertToNumber,
} from '@drift-labs/sdk';
import * as fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';

// Load environment from keeper directory
dotenv.config({ path: path.resolve(__dirname, '../keeper/.env') });

// =============================================================================
// Configuration
// =============================================================================

const RPC_URL = process.env['RPC_URL'] || 'https://api.devnet.solana.com';
const DRIFT_ENV = (process.env['DRIFT_ENV'] || 'devnet') as 'devnet' | 'mainnet-beta';
const VAULT_ADDRESS = process.env['VAULT_ADDRESS'];
const DELEGATE_KEYPAIR_PATH = process.env['DELEGATE_KEYPAIR_PATH'] || './keypairs/delegate.json';
const DEFAULT_HEALTH_THRESHOLD = Number(process.env['HEALTH_MIN_THRESHOLD']) || 20;

// Market indexes
const SOL_PERP_INDEX = 0;
const BTC_PERP_INDEX = 1;
const ETH_PERP_INDEX = 2;
const USDC_SPOT_INDEX = 0;
const SOL_SPOT_INDEX = 1;

// =============================================================================
// Types
// =============================================================================

interface HealthReport {
  timestamp: string;
  vault: string;
  health: number;
  healthStatus: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  totalCollateral: number;
  freeCollateral: number;
  maintenanceMarginReq: number;
  marginUsagePct: number;
  unrealizedPnl: number;
  unrealizedFundingPnl: number;
  positions: PositionInfo[];
}

interface PositionInfo {
  market: string;
  type: 'perp' | 'spot';
  size: number;
  notionalValue: number;
  entryPrice?: number;
  unrealizedPnl?: number;
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

function parseArgs(): { threshold: number; json: boolean } {
  const args = process.argv.slice(2);
  let threshold = DEFAULT_HEALTH_THRESHOLD;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if (arg === '--threshold' && nextArg) {
      threshold = parseFloat(nextArg);
      i++;
    } else if (arg === '--json') {
      json = true;
    }
  }

  return { threshold, json };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const { threshold, json } = parseArgs();

  if (!json) {
    console.log('============================================');
    console.log('  Delta-Neutral Vault Health Monitor');
    console.log('============================================');
    console.log('');
  }

  // Validate configuration
  if (!VAULT_ADDRESS) {
    console.error('ERROR: VAULT_ADDRESS not configured in .env');
    console.error('Set VAULT_ADDRESS in keeper/.env or run init-vault.sh first');
    process.exit(1);
  }

  let driftClient: DriftClient | null = null;

  try {
    // Initialize connection
    const connection = new Connection(RPC_URL, 'confirmed');

    // Load delegate keypair
    let wallet: Wallet;
    const keypairPath = path.resolve(__dirname, '../keeper', DELEGATE_KEYPAIR_PATH);

    if (fs.existsSync(keypairPath)) {
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
      const delegateKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
      wallet = new Wallet(delegateKeypair);
      if (!json) {
        console.log(`Delegate: ${delegateKeypair.publicKey.toBase58()}`);
      }
    } else {
      // Use dummy wallet for read-only access
      wallet = new Wallet(Keypair.generate());
      if (!json) {
        console.log('Using read-only mode (no delegate keypair found)');
      }
    }

    // Initialize SDK config
    const sdkConfig = initialize({ env: DRIFT_ENV });

    // Create bulk account loader
    const bulkAccountLoader = new BulkAccountLoader(connection, 'confirmed', 1000);

    // Get markets and oracles
    const { perpMarketIndexes, spotMarketIndexes, oracleInfos } =
      getMarketsAndOraclesForSubscription(DRIFT_ENV);

    // Create vault authority public key
    const vaultAuthority = new PublicKey(VAULT_ADDRESS);

    // Create DriftClient
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
      authority: vaultAuthority,
      env: DRIFT_ENV,
    });

    if (!json) {
      console.log(`Vault: ${VAULT_ADDRESS}`);
      console.log(`Environment: ${DRIFT_ENV}`);
      console.log('');
      console.log('Connecting to Drift Protocol...');
    }

    // Subscribe to account data
    await driftClient.subscribe();

    if (!json) {
      console.log('Connected!\n');
    }

    // Generate health report
    const report = generateHealthReport(driftClient, VAULT_ADDRESS);

    if (json) {
      // Output JSON for programmatic use
      console.log(JSON.stringify(report, null, 2));
    } else {
      // Display formatted report
      displayReport(report, threshold);
    }

    // Exit with error code if health is below threshold
    if (report.health < threshold) {
      if (!json) {
        console.log(`\n[!] ALERT: Health (${report.health.toFixed(1)}) is below threshold (${threshold})`);
      }
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    if (json) {
      console.log(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
      );
    } else {
      console.error('Error:', error instanceof Error ? error.message : error);
    }
    process.exit(1);
  } finally {
    // Clean up
    if (driftClient) {
      await driftClient.unsubscribe();
    }
  }
}

// =============================================================================
// Health Report Generation
// =============================================================================

function generateHealthReport(driftClient: DriftClient, vaultAddress: string): HealthReport {
  const user = driftClient.getUser();

  // Get collateral values
  const totalCollateral = user.getTotalCollateral('Maintenance');
  const freeCollateral = user.getFreeCollateral();
  const maintenanceMarginReq = user.getMaintenanceMarginRequirement();

  // Convert to numbers
  const totalCollateralNum = convertToNumber(totalCollateral, QUOTE_PRECISION);
  const freeCollateralNum = convertToNumber(freeCollateral, QUOTE_PRECISION);
  const maintenanceMarginNum = convertToNumber(maintenanceMarginReq, QUOTE_PRECISION);

  // Calculate health (0-100)
  let health = 100;
  if (maintenanceMarginNum > 0) {
    const healthRatio = (totalCollateralNum - maintenanceMarginNum) / totalCollateralNum;
    health = Math.max(0, Math.min(100, healthRatio * 100));
  }

  // Calculate margin usage
  const marginUsagePct =
    totalCollateralNum > 0 ? (maintenanceMarginNum / totalCollateralNum) * 100 : 0;

  // Get PnL values
  const unrealizedPnl = user.getUnrealizedPNL();
  const unrealizedFundingPnl = user.getUnrealizedFundingPNL();

  // Determine health status
  let healthStatus: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  if (health > 50) {
    healthStatus = 'HEALTHY';
  } else if (health > 20) {
    healthStatus = 'WARNING';
  } else {
    healthStatus = 'CRITICAL';
  }

  // Get positions
  const positions = getPositions(driftClient);

  return {
    timestamp: new Date().toISOString(),
    vault: vaultAddress,
    health,
    healthStatus,
    totalCollateral: totalCollateralNum,
    freeCollateral: freeCollateralNum,
    maintenanceMarginReq: maintenanceMarginNum,
    marginUsagePct,
    unrealizedPnl: convertToNumber(unrealizedPnl, QUOTE_PRECISION),
    unrealizedFundingPnl: convertToNumber(unrealizedFundingPnl, QUOTE_PRECISION),
    positions,
  };
}

function getPositions(driftClient: DriftClient): PositionInfo[] {
  const user = driftClient.getUser();
  const positions: PositionInfo[] = [];

  // Check perp positions
  const perpMarkets = [
    { index: SOL_PERP_INDEX, name: 'SOL-PERP' },
    { index: BTC_PERP_INDEX, name: 'BTC-PERP' },
    { index: ETH_PERP_INDEX, name: 'ETH-PERP' },
  ];

  for (const market of perpMarkets) {
    const position = user.getPerpPosition(market.index);
    if (position && !position.baseAssetAmount.isZero()) {
      const size = convertToNumber(position.baseAssetAmount, BASE_PRECISION);
      const oracleData = driftClient.getOracleDataForPerpMarket(market.index);
      const oraclePrice = oracleData ? convertToNumber(oracleData.price, PRICE_PRECISION) : 0;
      const notionalValue = Math.abs(size) * oraclePrice;

      positions.push({
        market: market.name,
        type: 'perp',
        size,
        notionalValue,
        entryPrice: position.quoteEntryAmount.isZero()
          ? 0
          : Math.abs(
              convertToNumber(position.quoteEntryAmount, QUOTE_PRECISION) /
                convertToNumber(position.baseAssetAmount, BASE_PRECISION)
            ),
      });
    }
  }

  // Check spot positions
  const spotMarkets = [
    { index: USDC_SPOT_INDEX, name: 'USDC', decimals: 6 },
    { index: SOL_SPOT_INDEX, name: 'SOL', decimals: 9 },
  ];

  for (const market of spotMarkets) {
    const position = user.getSpotPosition(market.index);
    if (position) {
      const tokenAmount = user.getTokenAmount(market.index);
      const size = convertToNumber(tokenAmount, QUOTE_PRECISION);

      if (Math.abs(size) > 0.01) {
        // Get oracle price for non-USDC assets
        let notionalValue = size;
        if (market.index !== USDC_SPOT_INDEX) {
          const oracleData = driftClient.getOracleDataForSpotMarket(market.index);
          const oraclePrice = oracleData ? convertToNumber(oracleData.price, PRICE_PRECISION) : 0;
          notionalValue = size * oraclePrice;
        }

        positions.push({
          market: market.name,
          type: 'spot',
          size,
          notionalValue,
        });
      }
    }
  }

  return positions;
}

// =============================================================================
// Display Functions
// =============================================================================

function displayReport(report: HealthReport, threshold: number): void {
  console.log('============================================');
  console.log('  Account Health');
  console.log('============================================');
  console.log('');

  const healthBar = generateHealthBar(report.health);
  console.log(`Health:      ${healthBar} ${report.health.toFixed(1)}% [${report.healthStatus}]`);
  console.log('');

  console.log('--------------------------------------------');
  console.log('Collateral & Margin:');
  console.log('--------------------------------------------');
  console.log(`  Total Collateral:     $${report.totalCollateral.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Free Collateral:      $${report.freeCollateral.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Maintenance Margin:   $${report.maintenanceMarginReq.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Margin Usage:         ${report.marginUsagePct.toFixed(2)}%`);
  console.log('');

  console.log('--------------------------------------------');
  console.log('P&L:');
  console.log('--------------------------------------------');
  const pnlSign = report.unrealizedPnl >= 0 ? '+' : '';
  const fundingSign = report.unrealizedFundingPnl >= 0 ? '+' : '';
  console.log(`  Unrealized P&L:       ${pnlSign}$${report.unrealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Funding P&L:          ${fundingSign}$${report.unrealizedFundingPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log('');

  console.log('--------------------------------------------');
  console.log('Open Positions:');
  console.log('--------------------------------------------');

  if (report.positions.length === 0) {
    console.log('  No open positions');
  } else {
    for (const pos of report.positions) {
      const sizeStr = pos.size >= 0 ? `+${pos.size.toFixed(4)}` : pos.size.toFixed(4);
      const direction = pos.type === 'perp' ? (pos.size >= 0 ? 'LONG' : 'SHORT') : '';
      console.log(`  ${pos.market.padEnd(10)} ${pos.type.toUpperCase().padEnd(5)} ${sizeStr.padStart(12)} ($${pos.notionalValue.toFixed(2)}) ${direction}`);
    }
  }
  console.log('');

  console.log('--------------------------------------------');
  console.log(`Alert Threshold: ${threshold}%`);
  console.log(`Timestamp: ${report.timestamp}`);
  console.log('');
}

function generateHealthBar(health: number): string {
  const barLength = 20;
  const filled = Math.round((health / 100) * barLength);
  const empty = barLength - filled;

  let bar: string;
  if (health > 50) {
    bar = '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
  } else if (health > 20) {
    bar = '[' + '!'.repeat(filled) + '-'.repeat(empty) + ']';
  } else {
    bar = '[' + 'X'.repeat(filled) + '-'.repeat(empty) + ']';
  }

  return bar;
}

// =============================================================================
// Entry Point
// =============================================================================

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
