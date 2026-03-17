/**
 * Backtest Utility
 *
 * Fetches historical funding rate data from Drift's REST API and simulates
 * the delta-neutral funding rate strategy performance.
 *
 * Run with: npx ts-node scripts/backtest.ts
 *
 * Options:
 *   --days <n>     Number of days to backtest (default: 30)
 *   --capital <n>  Starting capital in USD (default: 10000)
 *   --market <s>   Market to backtest (default: SOL-PERP)
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment from keeper directory
dotenv.config({ path: path.resolve(__dirname, '../keeper/.env') });

// =============================================================================
// Configuration
// =============================================================================

const DRIFT_DATA_API = 'https://data.api.drift.trade';

// Strategy thresholds (annualized %)
const OPEN_THRESHOLD = Number(process.env['MIN_FUNDING_RATE_THRESHOLD']) || 10;
const CLOSE_THRESHOLD = Number(process.env['NEGATIVE_FUNDING_CLOSE_THRESHOLD']) || -5;

// =============================================================================
// Types
// =============================================================================

interface FundingRateData {
  ts: number;
  recordId: number;
  marketIndex: number;
  fundingRate: number;
  fundingRateLong: number;
  fundingRateShort: number;
  oraclePriceTwap: number;
  markPriceTwap: number;
}

interface BacktestResult {
  startDate: Date;
  endDate: Date;
  daysSimulated: number;
  startingCapital: number;
  endingCapital: number;
  totalFundingEarned: number;
  totalFundingPaid: number;
  netFundingPnl: number;
  openCloseCycles: number;
  percentTimeInPosition: number;
  effectiveApy: number;
  maxDrawdownPct: number;
  maxDrawdownPeriodDays: number;
  avgFundingWhenOpen: number;
}

interface SimulationState {
  capital: number;
  positionOpen: boolean;
  positionSize: number;
  fundingEarned: number;
  fundingPaid: number;
  cycles: number;
  hoursInPosition: number;
  peakCapital: number;
  maxDrawdown: number;
  currentDrawdownStart: number | null;
  maxDrawdownPeriod: number;
  fundingRatesWhenOpen: number[];
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

function parseArgs(): { days: number; capital: number; market: string } {
  const args = process.argv.slice(2);
  let days = 30;
  let capital = 10000;
  let market = 'SOL-PERP';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if (arg === '--days' && nextArg) {
      days = parseInt(nextArg, 10);
      i++;
    } else if (arg === '--capital' && nextArg) {
      capital = parseFloat(nextArg);
      i++;
    } else if (arg === '--market' && nextArg) {
      market = nextArg;
      i++;
    }
  }

  return { days, capital, market };
}

// =============================================================================
// API Functions
// =============================================================================

async function fetchFundingRates(
  marketName: string,
  days: number
): Promise<FundingRateData[]> {
  // Calculate time range
  const now = Date.now();
  const startTime = now - days * 24 * 60 * 60 * 1000;

  const url = `${DRIFT_DATA_API}/fundingRates?marketName=${marketName}`;

  console.log(`Fetching funding rates from Drift API...`);
  console.log(`URL: ${url}`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as FundingRateData[];

  // Filter to requested time range and sort by timestamp
  const filtered = data
    .filter((d) => d.ts * 1000 >= startTime)
    .sort((a, b) => a.ts - b.ts);

  console.log(`Fetched ${data.length} records, ${filtered.length} within ${days}-day window`);

  return filtered;
}

// =============================================================================
// Simulation Functions
// =============================================================================

function runBacktest(
  fundingData: FundingRateData[],
  startingCapital: number
): BacktestResult {
  if (fundingData.length === 0) {
    throw new Error('No funding data to backtest');
  }

  // Initialize state
  const state: SimulationState = {
    capital: startingCapital,
    positionOpen: false,
    positionSize: 0,
    fundingEarned: 0,
    fundingPaid: 0,
    cycles: 0,
    hoursInPosition: 0,
    peakCapital: startingCapital,
    maxDrawdown: 0,
    currentDrawdownStart: null,
    maxDrawdownPeriod: 0,
    fundingRatesWhenOpen: [],
  };

  const startDate = new Date(fundingData[0]!.ts * 1000);
  const endDate = new Date(fundingData[fundingData.length - 1]!.ts * 1000);
  const totalHours = fundingData.length;

  // Process each funding rate update (hourly)
  for (const data of fundingData) {
    // Convert funding rate to hourly percentage
    // fundingRate is in 1e-6 precision, per oracle price
    const oraclePrice = data.oraclePriceTwap / 1e6; // Oracle is in 1e6
    const fundingRateRaw = data.fundingRate / 1e9; // Funding is in 1e9
    const fundingRateHourlyPct = (fundingRateRaw / oraclePrice) * 100;
    const fundingRateAnnualized = fundingRateHourlyPct * 24 * 365;

    // Decision logic
    if (!state.positionOpen) {
      // Check if we should open
      if (fundingRateAnnualized > OPEN_THRESHOLD) {
        // Open short perp + long spot position
        state.positionOpen = true;
        state.positionSize = state.capital * 0.9; // Deploy 90% of capital
        state.cycles++;
      }
    } else {
      // Position is open, check if we should close
      if (fundingRateAnnualized < CLOSE_THRESHOLD) {
        // Close position
        state.positionOpen = false;
        state.positionSize = 0;
      } else {
        // Accrue funding (short position earns positive funding, pays negative)
        const fundingPayment = (state.positionSize * fundingRateHourlyPct) / 100;

        if (fundingPayment > 0) {
          state.fundingEarned += fundingPayment;
          state.capital += fundingPayment;
        } else {
          state.fundingPaid += Math.abs(fundingPayment);
          state.capital += fundingPayment; // This will subtract
        }

        state.hoursInPosition++;
        state.fundingRatesWhenOpen.push(fundingRateAnnualized);
      }
    }

    // Track drawdown
    if (state.capital > state.peakCapital) {
      state.peakCapital = state.capital;
      state.currentDrawdownStart = null;
    } else {
      const drawdown = ((state.peakCapital - state.capital) / state.peakCapital) * 100;
      if (drawdown > state.maxDrawdown) {
        state.maxDrawdown = drawdown;
      }

      if (state.currentDrawdownStart === null) {
        state.currentDrawdownStart = data.ts;
      } else {
        const drawdownPeriod = (data.ts - state.currentDrawdownStart) / (24 * 3600);
        if (drawdownPeriod > state.maxDrawdownPeriod) {
          state.maxDrawdownPeriod = drawdownPeriod;
        }
      }
    }
  }

  // Calculate final metrics
  const daysSimulated = (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
  const netFundingPnl = state.fundingEarned - state.fundingPaid;
  const percentTimeInPosition = (state.hoursInPosition / totalHours) * 100;

  // Calculate effective APY
  const totalReturn = (state.capital - startingCapital) / startingCapital;
  const effectiveApy = daysSimulated > 0 ? (totalReturn / daysSimulated) * 365 * 100 : 0;

  // Average funding rate when position was open
  const avgFundingWhenOpen =
    state.fundingRatesWhenOpen.length > 0
      ? state.fundingRatesWhenOpen.reduce((a, b) => a + b, 0) /
        state.fundingRatesWhenOpen.length
      : 0;

  return {
    startDate,
    endDate,
    daysSimulated,
    startingCapital,
    endingCapital: state.capital,
    totalFundingEarned: state.fundingEarned,
    totalFundingPaid: state.fundingPaid,
    netFundingPnl,
    openCloseCycles: state.cycles,
    percentTimeInPosition,
    effectiveApy,
    maxDrawdownPct: state.maxDrawdown,
    maxDrawdownPeriodDays: state.maxDrawdownPeriod,
    avgFundingWhenOpen,
  };
}

// =============================================================================
// Display Functions
// =============================================================================

function displayResults(result: BacktestResult, market: string): void {
  console.log('\n============================================');
  console.log('  Backtest Results');
  console.log('============================================\n');

  console.log(`Market: ${market}`);
  console.log(`Period: ${result.startDate.toISOString().split('T')[0]} to ${result.endDate.toISOString().split('T')[0]}`);
  console.log(`Duration: ${result.daysSimulated.toFixed(1)} days`);
  console.log('');

  console.log('--------------------------------------------');
  console.log('Capital Performance:');
  console.log('--------------------------------------------');
  console.log(`  Starting Capital:  $${result.startingCapital.toLocaleString()}`);
  console.log(`  Ending Capital:    $${result.endingCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Net P&L:           $${result.netFundingPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${((result.netFundingPnl / result.startingCapital) * 100).toFixed(2)}%)`);
  console.log(`  Effective APY:     ${result.effectiveApy.toFixed(2)}%`);
  console.log('');

  console.log('--------------------------------------------');
  console.log('Funding Breakdown:');
  console.log('--------------------------------------------');
  console.log(`  Funding Earned:    $${result.totalFundingEarned.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Funding Paid:      $${result.totalFundingPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Net Funding:       $${result.netFundingPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log('');

  console.log('--------------------------------------------');
  console.log('Strategy Statistics:');
  console.log('--------------------------------------------');
  console.log(`  Open/Close Cycles: ${result.openCloseCycles}`);
  console.log(`  Time in Position:  ${result.percentTimeInPosition.toFixed(1)}%`);
  console.log(`  Avg Funding (open): ${result.avgFundingWhenOpen.toFixed(2)}% APR`);
  console.log('');

  console.log('--------------------------------------------');
  console.log('Risk Metrics:');
  console.log('--------------------------------------------');
  console.log(`  Max Drawdown:      ${result.maxDrawdownPct.toFixed(2)}%`);
  console.log(`  Max DD Period:     ${result.maxDrawdownPeriodDays.toFixed(1)} days`);
  console.log('');

  console.log('--------------------------------------------');
  console.log('Strategy Thresholds Used:');
  console.log('--------------------------------------------');
  console.log(`  Open when APR >    ${OPEN_THRESHOLD}%`);
  console.log(`  Close when APR <   ${CLOSE_THRESHOLD}%`);
  console.log('');

  // Summary assessment
  console.log('============================================');
  console.log('  Assessment');
  console.log('============================================');

  if (result.effectiveApy > 15) {
    console.log('\n[+] Strong performance - strategy appears profitable');
  } else if (result.effectiveApy > 5) {
    console.log('\n[~] Moderate performance - consider adjusting thresholds');
  } else if (result.effectiveApy > 0) {
    console.log('\n[-] Weak performance - funding conditions may not be ideal');
  } else {
    console.log('\n[!] Negative returns - review strategy parameters');
  }

  if (result.maxDrawdownPct > 5) {
    console.log('[!] High drawdown detected - consider tighter risk management');
  }

  if (result.percentTimeInPosition < 30) {
    console.log('[~] Low time in position - threshold may be too strict');
  }

  console.log('');
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const { days, capital, market } = parseArgs();

  console.log('============================================');
  console.log('  Delta-Neutral Strategy Backtest');
  console.log('============================================');
  console.log('');
  console.log(`Market:           ${market}`);
  console.log(`Backtest Period:  ${days} days`);
  console.log(`Starting Capital: $${capital.toLocaleString()}`);
  console.log('');

  try {
    // Fetch historical funding data
    const fundingData = await fetchFundingRates(market, days);

    if (fundingData.length === 0) {
      console.error('No funding data available for the specified period');
      process.exit(1);
    }

    // Run simulation
    console.log('\nRunning simulation...');
    const result = runBacktest(fundingData, capital);

    // Display results
    displayResults(result, market);
  } catch (error) {
    console.error('Backtest failed:', error instanceof Error ? error.message : error);
    process.exit(1);
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
