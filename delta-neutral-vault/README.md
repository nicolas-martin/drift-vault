# Delta-Neutral Funding Rate Vault

A delta-neutral funding rate arbitrage vault built on Solana using Drift Protocol. The vault accepts USDC deposits, executes a hedged strategy (long spot SOL + short SOL-PERP), and earns funding rate payments when the market is bullish.

## Architecture

```
delta-neutral-vault/
├── keeper/           # 24/7 keeper bot (TypeScript)
│   └── src/
│       ├── index.ts          # Main loop
│       ├── config.ts         # Configuration
│       ├── driftClient.ts    # Drift SDK wrapper
│       ├── strategy.ts       # Delta-neutral strategy
│       ├── fundingMonitor.ts # Funding rate analysis
│       ├── rebalancer.ts     # Position rebalancing
│       ├── health.ts         # Health monitoring
│       ├── withdrawHandler.ts # Withdrawal handling
│       └── logger.ts         # Winston logger
├── frontend/         # Next.js deposit/withdraw UI
│   └── src/
│       ├── app/              # Next.js app router
│       ├── components/       # UI components
│       ├── hooks/            # useVault hook
│       └── contexts/         # Wallet provider
└── scripts/          # Utility scripts
    ├── init-vault.sh         # Vault initialization
    ├── check-funding.ts      # Funding rate checker
    ├── backtest.ts           # Strategy backtester
    └── monitor-health.ts     # Health monitor
```

## Strategy

The vault implements a delta-neutral funding rate arbitrage strategy:

1. **Open Position**: When funding rate > threshold
   - Buy spot SOL (long exposure)
   - Short SOL-PERP (short exposure)
   - Net delta ≈ 0 (price neutral)

2. **Earn Funding**: Short perp earns funding when longs pay shorts (bullish market)

3. **Close Position**: When funding rate < negative threshold
   - Close short perp
   - Sell spot SOL back to USDC

4. **Rebalance**: If spot/perp positions drift apart > threshold, rebalance

## Prerequisites

- Node.js 18+
- Solana CLI
- Anchor CLI 0.29.0
- Drift Vaults CLI (from drift-labs/drift-vaults)

## Quick Start

### 1. Generate Keypairs

```bash
# Manager keypair (owns vault)
solana-keygen new --outfile ~/.config/solana/vault-manager.json

# Delegate keypair (for keeper bot trading)
solana-keygen new --outfile ~/.config/solana/vault-delegate.json

# Fund on devnet
solana airdrop 5 --keypair ~/.config/solana/vault-delegate.json --url devnet
```

### 2. Initialize Vault

Use the drift-vaults CLI:

```bash
cd drift-vaults/ts/sdk

yarn cli init-vault \
  --name "delta-neutral-v1" \
  --market-index 0 \
  --redeem-period 86400 \
  --max-tokens 1000000 \
  --management-fee 1 \
  --profit-share 15 \
  --min-deposit-amount 10 \
  --url https://api.devnet.solana.com \
  --keypair ~/.config/solana/vault-manager.json

# Set delegate
yarn cli manager-update-delegate \
  --vault-address <VAULT_ADDRESS> \
  --delegate <DELEGATE_PUBKEY> \
  --url https://api.devnet.solana.com \
  --keypair ~/.config/solana/vault-manager.json
```

### 3. Configure Keeper

```bash
cd keeper
cp .env.example .env
# Edit .env with your vault address and keypair path
```

### 4. Run Keeper

```bash
cd keeper
yarn install
yarn dev   # Development with hot reload
yarn start # Production
```

### 5. Run Frontend

```bash
cd frontend
yarn install
cp .env.example .env.local
# Edit .env.local with vault address
yarn dev
```

## Configuration

### Keeper Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `RPC_URL` | Solana RPC endpoint | devnet |
| `DELEGATE_KEYPAIR_PATH` | Path to delegate keypair | ./keypairs/delegate.json |
| `VAULT_ADDRESS` | Vault public key | required |
| `DRIFT_ENV` | `devnet` or `mainnet-beta` | devnet |
| `MIN_FUNDING_RATE_THRESHOLD` | Min APR to open position (%) | 10 |
| `NEGATIVE_FUNDING_CLOSE_THRESHOLD` | APR to close position (%) | -5 |
| `MAX_POSITION_SIZE_USD` | Max position size ($) | 100000 |
| `REBALANCE_THRESHOLD_PCT` | Rebalance trigger (%) | 5 |
| `HEALTH_MIN_THRESHOLD` | Min health before closing (%) | 20 |
| `LOOP_INTERVAL_MS` | Main loop interval (ms) | 60000 |

## Scripts

```bash
# Check current funding rates
npx ts-node scripts/check-funding.ts

# Backtest strategy
npx ts-node scripts/backtest.ts --days 30

# Monitor vault health
npx ts-node scripts/monitor-health.ts
```

## Production Deployment

### Keeper

```bash
npm install -g pm2
cd keeper
yarn build
pm2 start dist/index.js --name "funding-vault-keeper"
pm2 save
pm2 startup
```

### Frontend

Deploy to Vercel:
```bash
cd frontend
vercel
```

## Risks

1. **Funding rate flips negative**: Closed automatically when threshold breached
2. **Liquidation risk**: Monitor health, emergency close if critical
3. **Basis risk**: Spot/perp may fill at different prices
4. **RPC issues**: Use paid RPC (Helius, Triton, QuickNode)

## Drift Market Indexes

| Asset | Spot Index | Perp Index |
|-------|-----------|------------|
| USDC  | 0         | N/A        |
| SOL   | 1         | 0          |
| BTC   | N/A       | 1          |
| ETH   | N/A       | 2          |

## References

- [Drift Protocol Docs](https://docs.drift.trade/)
- [Drift Vaults](https://github.com/drift-labs/drift-vaults)
- [Drift SDK](https://www.npmjs.com/package/@drift-labs/sdk)
- [Drift Funding Arb](https://github.com/drift-labs/drift-funding-arb)

## License

MIT
