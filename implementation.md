# IMPLEMENTATION GUIDE: Delta-Neutral Funding Rate Vault on Drift Protocol (Solana)

## OVERVIEW

You are building a delta-neutral funding rate arbitrage vault on the Solana blockchain using Drift Protocol. The vault accepts USDC deposits from users, then the keeper bot (which you build) executes a hedged strategy: it buys spot SOL and simultaneously opens an equally-sized short SOL-PERP position on Drift. This neutralizes price exposure while collecting hourly funding rate payments that flow from longs to shorts when the market is bullish. Users deposit USDC, receive proportional vault shares, and can withdraw their share of the vault's USDC plus accumulated profits.

You do NOT need to write a Solana smart contract. You will use Drift's existing open-source vault program for on-chain deposit/withdrawal/share accounting, and build only two things:
1. A TypeScript keeper bot that runs 24/7 executing the delta-neutral strategy
2. A Next.js frontend for users to deposit/withdraw

## PROJECT STRUCTURE

```
delta-neutral-vault/
├── keeper/                    # The keeper bot (TypeScript, runs 24/7)
│   ├── src/
│   │   ├── index.ts           # Entry point, main loop
│   │   ├── driftClient.ts     # Drift SDK initialization and helpers
│   │   ├── strategy.ts        # Delta-neutral strategy logic
│   │   ├── fundingMonitor.ts  # Funding rate monitoring and decision engine
│   │   ├── rebalancer.ts      # Position rebalancing logic
│   │   ├── withdrawHandler.ts # Handle pending user withdrawals
│   │   ├── health.ts          # Account health monitoring and alerts
│   │   ├── config.ts          # Configuration constants
│   │   └── logger.ts          # Structured logging
│   ├── package.json
│   ├── tsconfig.json
│   └── .env                   # RPC URL, keypair path, vault address
├── frontend/                  # Next.js app (fork of Drift vault UI template)
│   └── ...
├── scripts/
│   ├── init-vault.sh          # Script to initialize the vault on-chain
│   ├── check-funding.ts       # Utility to check current funding rates
│   └── backtest.ts            # Backtest strategy against historical data
└── README.md
```

## PART 1: ENVIRONMENT SETUP

### 1.1 Prerequisites

Install the following tools on the development machine:

```bash
# Install Rust (needed for Anchor CLI if you ever need to interact with programs)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable

# Install Solana CLI (version 1.16.27 or later)
sh -c "$(curl -sSfL https://release.solana.com/v1.18.18/install)"

# Install Node.js 18+ and Yarn
# (use nvm or your preferred method)
nvm install 18
npm install -g yarn

# Install Anchor CLI (version 0.29.0)
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.29.0
avm use 0.29.0
```

### 1.2 Generate Solana Keypairs

You need TWO keypairs:
- **Manager keypair**: Owns the vault. Used only during vault initialization.
- **Delegate keypair**: The keeper bot uses this to trade on behalf of the vault. It can place/cancel orders but CANNOT withdraw funds. This is a security feature.

```bash
# Generate manager keypair
solana-keygen new --outfile ~/.config/solana/vault-manager.json
# SAVE THE PUBKEY. Example output: "pubkey: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"

# Generate delegate keypair (for the keeper bot)
solana-keygen new --outfile ~/.config/solana/vault-delegate.json
# SAVE THE PUBKEY. Example output: "pubkey: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"

# Fund both with SOL for transaction fees (on mainnet, send ~0.5 SOL to each)
# On devnet:
solana airdrop 5 --keypair ~/.config/solana/vault-manager.json --url devnet
solana airdrop 5 --keypair ~/.config/solana/vault-delegate.json --url devnet
```

### 1.3 Clone Required Repositories

```bash
# Clone the drift-vaults repo (contains vault program CLI and SDK)
git clone https://github.com/drift-labs/drift-vaults.git
cd drift-vaults/ts/sdk
yarn install
yarn build
cd ../..

# Clone the drift-funding-arb repo (reference implementation for strategy logic)
git clone https://github.com/drift-labs/drift-funding-arb.git
```

### 1.4 Initialize the Keeper Project

```bash
mkdir -p delta-neutral-vault/keeper
cd delta-neutral-vault/keeper
yarn init -y
yarn add @drift-labs/sdk @drift-labs/vaults-sdk @solana/web3.js @coral-xyz/anchor bn.js dotenv winston
yarn add -D typescript ts-node @types/node @types/bn.js nodemon
```

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Create `.env`:
```bash
# Solana RPC URL - use a paid RPC like Helius, Triton, or QuickNode for production
# Devnet for testing:
RPC_URL=https://api.devnet.solana.com
# Mainnet for production:
# RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY

# Path to the delegate keypair (the bot's trading key)
DELEGATE_KEYPAIR_PATH=/home/user/.config/solana/vault-delegate.json

# Vault address (you get this after running init-vault in Part 2)
VAULT_ADDRESS=

# Environment: 'devnet' or 'mainnet-beta'
DRIFT_ENV=devnet

# Strategy parameters
MIN_FUNDING_RATE_THRESHOLD=0.0001
NEGATIVE_FUNDING_CLOSE_THRESHOLD=-0.0001
MAX_POSITION_SIZE_USD=100000
REBALANCE_THRESHOLD_PCT=0.02
HEALTH_MIN_THRESHOLD=50
LOOP_INTERVAL_MS=60000
```

## PART 2: INITIALIZE THE VAULT ON-CHAIN

Use the drift-vaults CLI to create the vault. This only needs to be done once.

### 2.1 Using the CLI

Navigate to the drift-vaults repo you cloned:

```bash
cd drift-vaults/ts/sdk

# Initialize a vault that accepts USDC deposits
# --market-index 0 means USDC (spot market index 0 on Drift)
# --redeem-period 86400 means 24-hour withdrawal delay (in seconds)
# --max-tokens 1000000 means 1,000,000 USDC max capacity
# --management-fee 1 means 1% annual management fee
# --profit-share 15 means 15% performance fee on profits
# --min-deposit-amount 10 means $10 minimum deposit

yarn cli init-vault \
  --name "delta-neutral-funding-v1" \
  --market-index 0 \
  --redeem-period 86400 \
  --max-tokens 1000000 \
  --management-fee 1 \
  --profit-share 15 \
  --min-deposit-amount 10 \
  --url $RPC_URL \
  --keypair ~/.config/solana/vault-manager.json
```

This command will output the **vault address** (a Solana public key). Save this — it goes into your `.env` as `VAULT_ADDRESS`.

### 2.2 Set the Delegate

After initialization, set the delegate to your keeper bot's keypair. The delegate can trade on behalf of the vault but cannot withdraw funds:

```bash
yarn cli manager-update-delegate \
  --vault-address <VAULT_ADDRESS_FROM_STEP_2.1> \
  --delegate <DELEGATE_PUBKEY_FROM_STEP_1.2> \
  --url $RPC_URL \
  --keypair ~/.config/solana/vault-manager.json
```

### 2.3 Verify the Vault

```bash
yarn cli view-vault \
  --vault-address <VAULT_ADDRESS> \
  --url $RPC_URL
```

This should display the vault's configuration including name, fees, redemption period, delegate, etc.

## PART 3: THE KEEPER BOT

### 3.1 Configuration (src/config.ts)

```typescript
import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  // Solana/Drift
  RPC_URL: process.env.RPC_URL!,
  DELEGATE_KEYPAIR_PATH: process.env.DELEGATE_KEYPAIR_PATH!,
  VAULT_ADDRESS: process.env.VAULT_ADDRESS!,
  DRIFT_ENV: (process.env.DRIFT_ENV || 'devnet') as 'devnet' | 'mainnet-beta',

  // Drift market indexes (these are fixed constants on Drift Protocol)
  USDC_SPOT_MARKET_INDEX: 0,     // USDC is spot market index 0
  SOL_SPOT_MARKET_INDEX: 1,      // SOL is spot market index 1
  SOL_PERP_MARKET_INDEX: 0,      // SOL-PERP is perp market index 0
  BTC_PERP_MARKET_INDEX: 1,      // BTC-PERP is perp market index 1 (for future expansion)
  ETH_PERP_MARKET_INDEX: 2,      // ETH-PERP is perp market index 2 (for future expansion)

  // Strategy parameters
  // Minimum hourly funding rate (as a fraction, e.g., 0.0001 = 0.01%/hour ≈ 8.76% APR)
  // Only open positions when funding is above this threshold
  MIN_FUNDING_RATE_THRESHOLD: parseFloat(process.env.MIN_FUNDING_RATE_THRESHOLD || '0.0001'),

  // If funding rate drops below this, close all positions to stop bleeding
  NEGATIVE_FUNDING_CLOSE_THRESHOLD: parseFloat(process.env.NEGATIVE_FUNDING_CLOSE_THRESHOLD || '-0.0001'),

  // Maximum total position size in USD for the vault
  MAX_POSITION_SIZE_USD: parseFloat(process.env.MAX_POSITION_SIZE_USD || '100000'),

  // If spot and perp positions differ by more than this %, trigger rebalance
  // 0.02 = 2%
  REBALANCE_THRESHOLD_PCT: parseFloat(process.env.REBALANCE_THRESHOLD_PCT || '0.02'),

  // Minimum Drift account health (0-100). If below this, reduce positions.
  // Drift health = 100 means fully collateralized, 0 means liquidatable
  HEALTH_MIN_THRESHOLD: parseInt(process.env.HEALTH_MIN_THRESHOLD || '50'),

  // How often the main loop runs in milliseconds
  LOOP_INTERVAL_MS: parseInt(process.env.LOOP_INTERVAL_MS || '60000'),

  // Maximum slippage for Jupiter swaps in basis points (50 = 0.5%)
  MAX_SLIPPAGE_BPS: 50,

  // What fraction of total vault USDC to deploy into the strategy (rest stays as buffer)
  // 0.9 means deploy 90% of USDC, keep 10% as safety buffer for withdrawals/margin
  DEPLOY_FRACTION: 0.9,
} as const;
```

### 3.2 Drift Client Initialization (src/driftClient.ts)

```typescript
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  DriftClient,
  Wallet,
  loadKeypair,
  BulkAccountLoader,
  initialize,
  User,
  getMarketsAndOraclesForSubscription,
  PerpMarkets,
  SpotMarkets,
  BN,
  PRICE_PRECISION,
  BASE_PRECISION,
  QUOTE_PRECISION,
  convertToNumber,
  calculateFundingRate,
  PositionDirection,
  OrderType,
  MarketType,
  getMarketOrderParams,
} from '@drift-labs/sdk';
import { JupiterClient } from '@drift-labs/sdk';
import { CONFIG } from './config';
import fs from 'fs';

// Re-export SDK types so other files don't need to import from @drift-labs/sdk directly
export {
  BN, PRICE_PRECISION, BASE_PRECISION, QUOTE_PRECISION,
  convertToNumber, PositionDirection, OrderType, MarketType,
  getMarketOrderParams, User
};

let driftClient: DriftClient;
let jupiterClient: JupiterClient;
let vaultUser: User;

/**
 * Initialize the Drift SDK client using the delegate keypair.
 * The delegate has permission to trade on behalf of the vault but cannot withdraw.
 *
 * IMPORTANT: The `authority` parameter must be set to the vault's Drift user account authority,
 * NOT the delegate's public key. The vault program creates a Drift user account owned by the
 * vault PDA. The delegate keypair signs transactions, but the authority is the vault.
 */
export async function initializeDriftClient(): Promise<{
  driftClient: DriftClient;
  jupiterClient: JupiterClient;
}> {
  const connection = new Connection(CONFIG.RPC_URL, {
    commitment: 'confirmed',
    wsEndpoint: CONFIG.RPC_URL.replace('https', 'wss'),
  });

  // Load delegate keypair from file
  const keypairData = JSON.parse(fs.readFileSync(CONFIG.DELEGATE_KEYPAIR_PATH, 'utf-8'));
  const delegateKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  const wallet = new Wallet(delegateKeypair);

  // Initialize SDK config (sets up program IDs, market configs, etc.)
  const sdkConfig = initialize({ env: CONFIG.DRIFT_ENV });

  // Use BulkAccountLoader for polling-based subscription (more reliable than websockets for bots)
  const bulkAccountLoader = new BulkAccountLoader(
    connection,
    'confirmed',
    1000 // poll every 1000ms
  );

  // Get the vault's public key
  const vaultPubkey = new PublicKey(CONFIG.VAULT_ADDRESS);

  // The vault's Drift user account is a PDA derived from the vault address.
  // We need to discover this. The drift-vaults SDK provides helpers for this,
  // but we can also derive it from the drift program.
  // For now, we'll use the DriftClient with the delegate as the signer
  // and the vault as the authority.

  const { perpMarketIndexes, spotMarketIndexes, oracleInfos } =
    getMarketsAndOraclesForSubscription(CONFIG.DRIFT_ENV);

  driftClient = new DriftClient({
    connection,
    wallet,
    programID: new PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
    env: CONFIG.DRIFT_ENV,
    perpMarketIndexes,
    spotMarketIndexes,
    oracleInfos,
    accountSubscription: {
      type: 'polling',
      accountLoader: bulkAccountLoader,
    },
    activeSubAccountId: 0,
    // CRITICAL: Set authority to the vault's Drift user authority (the vault PDA)
    // The delegate signs txs but acts on behalf of the vault's account
    authority: vaultPubkey,
    includeDelegates: true,
  });

  await driftClient.subscribe();
  console.log('DriftClient subscribed successfully');

  // Initialize Jupiter client for spot swaps
  jupiterClient = new JupiterClient({ connection });

  return { driftClient, jupiterClient };
}

/**
 * Get the vault's current USDC balance (deposits not yet deployed into positions)
 */
export function getVaultUsdcBalance(): number {
  const user = driftClient.getUser();
  const spotPosition = user.getSpotPosition(CONFIG.USDC_SPOT_MARKET_INDEX);
  if (!spotPosition) return 0;

  // scaledBalance is in QUOTE_PRECISION (1e6 for USDC)
  return convertToNumber(spotPosition.scaledBalance, QUOTE_PRECISION);
}

/**
 * Get the vault's current SOL spot position size (in SOL units)
 */
export function getVaultSolSpotPosition(): number {
  const user = driftClient.getUser();
  const spotPosition = user.getSpotPosition(CONFIG.SOL_SPOT_MARKET_INDEX);
  if (!spotPosition) return 0;

  const spotMarket = driftClient.getSpotMarketAccount(CONFIG.SOL_SPOT_MARKET_INDEX);
  if (!spotMarket) return 0;

  // Get the token amount (handling precision)
  return convertToNumber(
    spotPosition.scaledBalance,
    new BN(10).pow(new BN(spotMarket.decimals))
  );
}

/**
 * Get the vault's current SOL-PERP position size (in SOL units, negative = short)
 */
export function getVaultSolPerpPosition(): number {
  const user = driftClient.getUser();
  const perpPosition = user.getPerpPosition(CONFIG.SOL_PERP_MARKET_INDEX);
  if (!perpPosition) return 0;

  // baseAssetAmount is in BASE_PRECISION (1e9)
  return convertToNumber(perpPosition.baseAssetAmount, BASE_PRECISION);
}

/**
 * Get the current hourly funding rate for SOL-PERP.
 * Positive = longs pay shorts (we earn as shorts).
 * Negative = shorts pay longs (we pay as shorts).
 *
 * Returns the funding rate as a decimal fraction per hour.
 * Example: 0.0001 means 0.01% per hour ≈ 8.76% APR
 */
export function getCurrentFundingRate(): number {
  const perpMarket = driftClient.getPerpMarketAccount(CONFIG.SOL_PERP_MARKET_INDEX);
  if (!perpMarket) throw new Error('SOL-PERP market account not found');

  // lastFundingRate is in PRICE_PRECISION (1e6)
  // It represents the payment per unit of base asset per hour
  const fundingRate = convertToNumber(perpMarket.amm.lastFundingRate, PRICE_PRECISION);

  // Get oracle price to convert to percentage
  const oracleData = driftClient.getOracleDataForPerpMarket(CONFIG.SOL_PERP_MARKET_INDEX);
  const oraclePrice = convertToNumber(oracleData.price, PRICE_PRECISION);

  if (oraclePrice === 0) return 0;

  // Funding rate as a fraction of price per hour
  return fundingRate / oraclePrice;
}

/**
 * Get current SOL oracle price in USD
 */
export function getSolPrice(): number {
  const oracleData = driftClient.getOracleDataForPerpMarket(CONFIG.SOL_PERP_MARKET_INDEX);
  return convertToNumber(oracleData.price, PRICE_PRECISION);
}

/**
 * Get the vault's Drift account health (0-100)
 * 100 = fully safe, 0 = liquidatable
 */
export function getAccountHealth(): number {
  const user = driftClient.getUser();
  const totalCollateral = user.getTotalCollateral();
  const marginReq = user.getMaintenanceMarginRequirement();

  if (totalCollateral.isZero()) return 100;
  if (marginReq.isZero()) return 100;

  // health = (collateral - margin_req) / collateral * 100
  const health = totalCollateral.sub(marginReq).muln(100).div(totalCollateral);
  return Math.max(0, Math.min(100, health.toNumber()));
}

/**
 * Get unrealized funding PnL for SOL-PERP
 */
export function getUnrealizedFundingPnl(): number {
  const user = driftClient.getUser();
  const fundingPnl = user.getUnrealizedFundingPNL();
  return convertToNumber(fundingPnl, QUOTE_PRECISION);
}

/**
 * Get the vault's total equity in USDC terms
 */
export function getVaultTotalEquity(): number {
  const user = driftClient.getUser();
  const totalCollateral = user.getTotalCollateral('Maintenance');
  return convertToNumber(totalCollateral, QUOTE_PRECISION);
}

export function getDriftClient(): DriftClient {
  return driftClient;
}

export function getJupiterClient(): JupiterClient {
  return jupiterClient;
}
```

### 3.3 Strategy Logic (src/strategy.ts)

```typescript
import {
  getDriftClient,
  getJupiterClient,
  getVaultUsdcBalance,
  getVaultSolSpotPosition,
  getVaultSolPerpPosition,
  getCurrentFundingRate,
  getSolPrice,
  getAccountHealth,
  BN,
  PositionDirection,
  OrderType,
  MarketType,
  getMarketOrderParams,
  convertToNumber,
  PRICE_PRECISION,
  BASE_PRECISION,
} from './driftClient';
import { CONFIG } from './config';

/**
 * OPEN a delta-neutral position.
 *
 * Steps:
 * 1. Calculate how much USDC to deploy (based on available balance and deploy fraction)
 * 2. Swap half to SOL via Jupiter (this is the long spot leg)
 * 3. Open a SHORT SOL-PERP position of equal SOL size (this is the short perp leg)
 *
 * After this:
 * - Spot SOL position = +X SOL (long, gains when SOL goes up)
 * - Perp position = -X SOL (short, gains when SOL goes down)
 * - Net delta ≈ 0 (price neutral)
 * - Short perp earns funding when funding rate is positive
 */
export async function openDeltaNeutralPosition(): Promise<void> {
  const driftClient = getDriftClient();
  const jupiterClient = getJupiterClient();

  const usdcBalance = getVaultUsdcBalance();
  const solPrice = getSolPrice();

  // Calculate deployment amount
  // Use DEPLOY_FRACTION of available USDC, split in half between spot and perp margin
  const deployableUsdc = usdcBalance * CONFIG.DEPLOY_FRACTION;
  const halfUsdc = deployableUsdc / 2;

  if (halfUsdc < 10) {
    console.log(`Insufficient USDC to open position: $${usdcBalance.toFixed(2)}`);
    return;
  }

  // Cap at max position size
  const cappedHalfUsdc = Math.min(halfUsdc, CONFIG.MAX_POSITION_SIZE_USD / 2);
  const solAmount = cappedHalfUsdc / solPrice;

  console.log(`Opening delta-neutral position:`);
  console.log(`  USDC to deploy: $${(cappedHalfUsdc * 2).toFixed(2)}`);
  console.log(`  SOL amount: ${solAmount.toFixed(4)} SOL @ $${solPrice.toFixed(2)}`);

  // STEP 1: Buy spot SOL using Jupiter swap through Drift
  // This executes a swap from USDC (spot market 0) to SOL (spot market 1)
  // The swap happens atomically within Drift's cross-margin system
  console.log('Step 1: Buying spot SOL via Jupiter...');
  const swapTxSig = await driftClient.swap({
    jupiterClient,
    inMarketIndex: CONFIG.USDC_SPOT_MARKET_INDEX,  // 0 = USDC
    outMarketIndex: CONFIG.SOL_SPOT_MARKET_INDEX,   // 1 = SOL
    amountIn: driftClient.convertToSpotPrecision(
      CONFIG.USDC_SPOT_MARKET_INDEX,
      cappedHalfUsdc
    ),
    inTokenDecimals: 6,   // USDC has 6 decimals
    outTokenDecimals: 9,  // SOL has 9 decimals
    slippageBps: CONFIG.MAX_SLIPPAGE_BPS,
    onlyDirectRoutes: false,
  });
  console.log(`  Spot buy tx: ${swapTxSig}`);

  // STEP 2: Open SHORT SOL-PERP position
  // The remaining half of USDC serves as margin for this short position
  // Using a MARKET order type with auction parameters for best execution
  console.log('Step 2: Opening short SOL-PERP...');
  const perpOrderParams = getMarketOrderParams({
    marketIndex: CONFIG.SOL_PERP_MARKET_INDEX, // 0 = SOL-PERP
    direction: PositionDirection.SHORT,
    baseAssetAmount: driftClient.convertToPerpPrecision(solAmount),
    marketType: MarketType.PERP,
  });

  const perpTxSig = await driftClient.placePerpOrder(perpOrderParams);
  console.log(`  Perp short tx: ${perpTxSig}`);

  console.log('Delta-neutral position opened successfully');
}

/**
 * CLOSE all positions.
 *
 * Steps:
 * 1. Close the short SOL-PERP position (buy back to close)
 * 2. Swap SOL back to USDC via Jupiter
 *
 * Called when:
 * - Funding rate flips negative (we'd be paying instead of earning)
 * - Account health is too low
 * - Manual shutdown
 */
export async function closeAllPositions(): Promise<void> {
  const driftClient = getDriftClient();
  const jupiterClient = getJupiterClient();

  const perpPosition = getVaultSolPerpPosition();
  const spotPosition = getVaultSolSpotPosition();

  // STEP 1: Close short SOL-PERP (buy to close)
  if (perpPosition < 0) {
    console.log(`Closing short perp: ${perpPosition} SOL`);
    const closeAmount = Math.abs(perpPosition);

    const orderParams = getMarketOrderParams({
      marketIndex: CONFIG.SOL_PERP_MARKET_INDEX,
      direction: PositionDirection.LONG, // buying to close a short
      baseAssetAmount: driftClient.convertToPerpPrecision(closeAmount),
      marketType: MarketType.PERP,
      reduceOnly: true, // IMPORTANT: ensures this only closes, never opens a new long
    });

    const txSig = await driftClient.placePerpOrder(orderParams);
    console.log(`  Perp close tx: ${txSig}`);
  }

  // STEP 2: Swap SOL back to USDC
  if (spotPosition > 0.001) { // more than dust
    console.log(`Swapping ${spotPosition.toFixed(4)} SOL back to USDC`);

    const swapTxSig = await driftClient.swap({
      jupiterClient,
      inMarketIndex: CONFIG.SOL_SPOT_MARKET_INDEX,  // 1 = SOL
      outMarketIndex: CONFIG.USDC_SPOT_MARKET_INDEX, // 0 = USDC
      amountIn: driftClient.convertToSpotPrecision(
        CONFIG.SOL_SPOT_MARKET_INDEX,
        spotPosition
      ),
      inTokenDecimals: 9,
      outTokenDecimals: 6,
      slippageBps: CONFIG.MAX_SLIPPAGE_BPS,
      onlyDirectRoutes: false,
    });
    console.log(`  Spot sell tx: ${swapTxSig}`);
  }

  console.log('All positions closed');
}

/**
 * REBALANCE the hedge if spot and perp positions have drifted apart.
 *
 * Over time, the spot SOL position and the short perp position can become unequal due to:
 * - Funding payments changing available margin
 * - Slippage on initial entry
 * - Partial fills
 *
 * If the imbalance exceeds REBALANCE_THRESHOLD_PCT, adjust the smaller side.
 */
export async function rebalanceIfNeeded(): Promise<void> {
  const driftClient = getDriftClient();

  const spotSolSize = getVaultSolSpotPosition();      // positive = long SOL
  const perpSolSize = Math.abs(getVaultSolPerpPosition()); // absolute value of short

  if (spotSolSize <= 0 && perpSolSize <= 0) {
    // No positions open, nothing to rebalance
    return;
  }

  const maxSize = Math.max(spotSolSize, perpSolSize);
  if (maxSize === 0) return;

  const imbalancePct = Math.abs(spotSolSize - perpSolSize) / maxSize;

  if (imbalancePct <= CONFIG.REBALANCE_THRESHOLD_PCT) {
    return; // within tolerance
  }

  console.log(`Rebalancing: spot=${spotSolSize.toFixed(4)} SOL, perp=${perpSolSize.toFixed(4)} SOL, imbalance=${(imbalancePct * 100).toFixed(2)}%`);

  if (spotSolSize > perpSolSize) {
    // Spot is larger than perp short — increase the short
    const deficit = spotSolSize - perpSolSize;
    console.log(`  Increasing short by ${deficit.toFixed(4)} SOL`);

    const orderParams = getMarketOrderParams({
      marketIndex: CONFIG.SOL_PERP_MARKET_INDEX,
      direction: PositionDirection.SHORT,
      baseAssetAmount: driftClient.convertToPerpPrecision(deficit),
      marketType: MarketType.PERP,
    });
    await driftClient.placePerpOrder(orderParams);
  } else {
    // Perp short is larger than spot — reduce the short
    const surplus = perpSolSize - spotSolSize;
    console.log(`  Reducing short by ${surplus.toFixed(4)} SOL`);

    const orderParams = getMarketOrderParams({
      marketIndex: CONFIG.SOL_PERP_MARKET_INDEX,
      direction: PositionDirection.LONG,
      baseAssetAmount: driftClient.convertToPerpPrecision(surplus),
      marketType: MarketType.PERP,
      reduceOnly: true,
    });
    await driftClient.placePerpOrder(orderParams);
  }

  console.log('Rebalance complete');
}

/**
 * SETTLE funding payments.
 * Drift accrues funding payments but they need to be settled to realize PnL.
 * This should be called periodically (e.g., every loop iteration).
 */
export async function settleFunding(): Promise<void> {
  const driftClient = getDriftClient();

  try {
    const user = driftClient.getUser();
    await driftClient.settlePNL(
      await driftClient.getUserAccountPublicKey(),
      driftClient.getUserAccount()!,
      CONFIG.SOL_PERP_MARKET_INDEX
    );
  } catch (e: any) {
    // settlePNL can fail if there's nothing to settle — this is expected
    if (!e.message?.includes('Nothing to settle')) {
      console.error('Failed to settle PNL:', e.message);
    }
  }
}
```

### 3.4 Main Loop (src/index.ts)

```typescript
import { initializeDriftClient } from './driftClient';
import {
  getVaultUsdcBalance,
  getVaultSolSpotPosition,
  getVaultSolPerpPosition,
  getCurrentFundingRate,
  getSolPrice,
  getAccountHealth,
  getUnrealizedFundingPnl,
  getVaultTotalEquity,
} from './driftClient';
import {
  openDeltaNeutralPosition,
  closeAllPositions,
  rebalanceIfNeeded,
  settleFunding,
} from './strategy';
import { CONFIG } from './config';

async function main() {
  console.log('=== Delta-Neutral Funding Rate Vault Keeper ===');
  console.log(`Environment: ${CONFIG.DRIFT_ENV}`);
  console.log(`Vault: ${CONFIG.VAULT_ADDRESS}`);
  console.log(`Loop interval: ${CONFIG.LOOP_INTERVAL_MS}ms`);
  console.log('');

  // Initialize Drift SDK
  console.log('Initializing Drift client...');
  await initializeDriftClient();
  console.log('Drift client initialized');

  // Main keeper loop
  let loopCount = 0;
  while (true) {
    try {
      loopCount++;
      const timestamp = new Date().toISOString();

      // === GATHER STATE ===
      const usdcBalance = getVaultUsdcBalance();
      const spotSolSize = getVaultSolSpotPosition();
      const perpSolSize = getVaultSolPerpPosition();
      const fundingRate = getCurrentFundingRate();
      const solPrice = getSolPrice();
      const health = getAccountHealth();
      const totalEquity = getVaultTotalEquity();
      const fundingPnl = getUnrealizedFundingPnl();

      // Convert funding rate to annualized percentage for display
      const fundingApr = fundingRate * 24 * 365 * 100;
      const hasOpenPositions = Math.abs(perpSolSize) > 0.001;

      // === LOG STATUS ===
      console.log(`\n[${timestamp}] Loop #${loopCount}`);
      console.log(`  Vault equity: $${totalEquity.toFixed(2)}`);
      console.log(`  USDC balance: $${usdcBalance.toFixed(2)}`);
      console.log(`  SOL spot: ${spotSolSize.toFixed(4)} SOL`);
      console.log(`  SOL perp: ${perpSolSize.toFixed(4)} SOL`);
      console.log(`  Funding rate: ${(fundingRate * 100).toFixed(6)}%/hr (${fundingApr.toFixed(2)}% APR)`);
      console.log(`  Funding PnL: $${fundingPnl.toFixed(2)}`);
      console.log(`  SOL price: $${solPrice.toFixed(2)}`);
      console.log(`  Account health: ${health}%`);

      // === HEALTH CHECK ===
      // If health is critically low, emergency close
      if (health < CONFIG.HEALTH_MIN_THRESHOLD && hasOpenPositions) {
        console.log('⚠️  HEALTH CRITICAL — closing all positions');
        await closeAllPositions();
        continue; // skip to next loop
      }

      // === SETTLE FUNDING ===
      // Always try to settle accumulated funding payments
      await settleFunding();

      // === STRATEGY DECISIONS ===

      if (hasOpenPositions) {
        // We have open positions — check if we should stay in or close

        if (fundingRate < CONFIG.NEGATIVE_FUNDING_CLOSE_THRESHOLD) {
          // Funding has gone significantly negative — close positions
          console.log('📉 Funding rate negative — closing positions');
          await closeAllPositions();
        } else {
          // Funding is still positive (or slightly negative) — stay in, just rebalance
          await rebalanceIfNeeded();
        }
      } else {
        // No open positions — check if we should open

        if (fundingRate > CONFIG.MIN_FUNDING_RATE_THRESHOLD && usdcBalance > 100) {
          // Funding is positive and we have capital — open positions
          console.log('📈 Funding rate favorable — opening delta-neutral position');
          await openDeltaNeutralPosition();
        } else {
          console.log('⏳ Waiting — funding rate too low or insufficient capital');
        }
      }

    } catch (error: any) {
      console.error(`Error in loop #${loopCount}:`, error.message);
      // Don't crash the loop on errors — log and continue
    }

    // Wait before next iteration
    await new Promise(resolve => setTimeout(resolve, CONFIG.LOOP_INTERVAL_MS));
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

### 3.5 Package.json Scripts

Add these scripts to `keeper/package.json`:

```json
{
  "scripts": {
    "build": "tsc",
    "start": "ts-node src/index.ts",
    "dev": "nodemon --exec ts-node src/index.ts",
    "check-funding": "ts-node scripts/check-funding.ts"
  }
}
```

## PART 4: FRONTEND

The frontend is a Next.js application that allows users to:
1. Connect their Solana wallet (Phantom, Solflare, etc.)
2. Deposit USDC into the vault
3. View vault performance (APY, total equity, their share)
4. Request withdrawals
5. Complete withdrawals after the redemption period

### 4.1 Approach

Drift provides a complete **Vault Manager UI Template** in the `drift-vaults` repo under `ts/sdk`. This is a full Next.js application with:
- Wallet connection (using `@solana/wallet-adapter`)
- Deposit/withdraw flows
- Vault history and analytics
- Built-in API routes for vault data

**You should fork this template and customize it** rather than building from scratch. The template already handles all the complex interactions with the vault program.

```bash
# The template is referenced in the drift-vaults repo documentation
# Clone and customize:
cd delta-neutral-vault
cp -r ../drift-vaults/ts/sdk/examples/vault-manager-ui frontend/
cd frontend
yarn install
```

### 4.2 Key Frontend Interactions with the Vault

The frontend uses the `@drift-labs/vaults-sdk` to interact with the vault program. Here are the key operations:

**Deposit USDC into the vault:**
The user approves a USDC transfer to the vault. The vault program mints vault shares proportional to the deposit.

**Request Withdrawal:**
The user calls `requestWithdraw` which starts the redemption timer (24 hours in our config). During this period, the keeper bot can unwind proportional positions.

**Complete Withdrawal:**
After the redemption period, the user calls `withdraw` to receive their USDC.

All of these are handled by the vault program's on-chain instructions — the frontend just needs to construct and send the transactions.

## PART 5: DEPLOYMENT CHECKLIST

### 5.1 Devnet Testing (Do This First)

1. Generate keypairs (Section 1.2)
2. Airdrop devnet SOL to both keypairs
3. Get devnet USDC from Drift's faucet at https://beta.drift.trade (connect wallet, use faucet)
4. Initialize vault on devnet (Section 2.1, use `--url https://api.devnet.solana.com`)
5. Set delegate (Section 2.2)
6. Deposit a small amount of devnet USDC into the vault manually via Drift's UI or CLI
7. Run the keeper bot: `cd keeper && yarn dev`
8. Verify it opens positions, monitors funding, and rebalances
9. Test withdrawal flow end-to-end

### 5.2 Mainnet Deployment

1. Get a paid RPC endpoint (Helius, Triton, or QuickNode — free RPCs will rate-limit you)
2. Fund manager and delegate keypairs with real SOL (~0.5 SOL each)
3. Initialize vault on mainnet (change `--url` to your mainnet RPC)
4. Set delegate
5. Deposit a small amount ($100-500) of your own USDC to test
6. Run keeper bot with `DRIFT_ENV=mainnet-beta`
7. Monitor for 48-72 hours before accepting external deposits
8. Deploy frontend to Vercel/similar

### 5.3 Production Keeper Setup

Run the keeper bot on a VPS (e.g., Hetzner, DigitalOcean) with:

```bash
# Use pm2 for process management
npm install -g pm2

# Start the keeper
cd keeper
yarn build
pm2 start dist/index.js --name "funding-vault-keeper" --max-memory-restart 500M

# Monitor
pm2 logs funding-vault-keeper
pm2 monit

# Auto-restart on crash
pm2 startup
pm2 save
```

## PART 6: IMPORTANT NOTES

### Drift Market Indexes (Constants)

These are fixed values on Drift Protocol. They do not change.

| Asset | Spot Market Index | Perp Market Index |
|-------|------------------|-------------------|
| USDC  | 0                | N/A               |
| SOL   | 1                | 0                 |
| BTC   | N/A (wrapped)    | 1                 |
| ETH   | N/A (wrapped)    | 2                 |

### Drift SDK Precision Constants

All numbers in the Drift SDK use BN (BigNumber) with specific precision:

| Constant | Value | Usage |
|----------|-------|-------|
| PRICE_PRECISION | 1e6 (1,000,000) | All prices (oracle, mark, limit) |
| BASE_PRECISION | 1e9 (1,000,000,000) | Perp position sizes |
| QUOTE_PRECISION | 1e6 (1,000,000) | USDC amounts, PnL |

To convert from human-readable to SDK precision:
- `$150.25` → `new BN(150_250_000)` (multiply by 1e6)
- `1.5 SOL (perp)` → `new BN(1_500_000_000)` (multiply by 1e9)
- `$100 USDC` → `new BN(100_000_000)` (multiply by 1e6)

Use the helper methods:
- `driftClient.convertToPerpPrecision(1.5)` → BN for 1.5 SOL perp
- `driftClient.convertToPricePrecision(150.25)` → BN for $150.25
- `driftClient.convertToSpotPrecision(marketIndex, 100)` → BN for 100 units of spot token

### Funding Rate Data API

To backtest or monitor funding rates without the SDK, use Drift's REST API:

```
GET https://data.api.drift.trade/fundingRates?marketName=SOL-PERP
```

Returns JSON with `fundingRate` (in PRICE_PRECISION) and `oraclePriceTwap`. To convert:
```
ratePctPerHour = (fundingRate / 1e9) / (oraclePriceTwap / 1e6) * 100
rateApr = ratePctPerHour * 24 * 365
```

### Key Risks the Keeper Must Handle

1. **Funding flips negative**: The bot MUST close positions when funding stays negative. The threshold in config controls this.
2. **Liquidation**: If SOL price moves fast, the short perp can approach liquidation. Monitor account health and close if below threshold.
3. **Basis risk**: Spot buy and perp short may fill at different prices, creating imperfect hedge. Use market orders with tight slippage.
4. **Transaction failures**: Solana transactions can fail. Always wrap in try/catch and retry once.
5. **RPC issues**: Use a paid RPC provider. Free RPCs will rate-limit and cause missed funding settlements.

### Repository References

- **Drift Vaults Program + CLI + SDK**: https://github.com/drift-labs/drift-vaults
- **Drift Protocol v2 (core program + SDK)**: https://github.com/drift-labs/protocol-v2
- **Drift SDK npm**: https://www.npmjs.com/package/@drift-labs/sdk
- **Drift Funding Arb Bot (reference)**: https://github.com/drift-labs/drift-funding-arb
- **Drift API Documentation**: https://drift-labs.github.io/v2-teacher/
- **Drift Protocol Documentation**: https://docs.drift.trade/
- **Drift Vaults Wiki**: https://github.com/drift-labs/drift-vaults/wiki
