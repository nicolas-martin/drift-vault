#!/bin/bash
# =============================================================================
# Delta-Neutral Vault Initialization Script
# =============================================================================
#
# This script guides you through setting up a Delta-Neutral Funding Rate Vault
# on Drift Protocol using the drift-vaults CLI.
#
# Prerequisites:
#   - drift-vaults CLI installed (cargo install drift-vaults-cli)
#   - Solana CLI configured with your authority keypair
#   - RPC URL configured (solana config set --url <RPC_URL>)
#
# Usage:
#   1. Review and customize the parameters below
#   2. Run: chmod +x init-vault.sh && ./init-vault.sh
#
# =============================================================================

set -e

# =============================================================================
# Configuration - CUSTOMIZE THESE VALUES
# =============================================================================

# Vault name (max 32 chars, alphanumeric and hyphens)
VAULT_NAME="delta-neutral-sol"

# Spot market index for deposits (0 = USDC)
SPOT_MARKET_INDEX=0

# Redeem period in seconds (86400 = 1 day)
# Time users must wait between requesting and completing a withdrawal
REDEEM_PERIOD=86400

# Maximum tokens the vault can hold (in native decimals)
# For USDC (6 decimals): 1000000 = 1 USDC, so 10000000000 = 10,000 USDC
MAX_TOKENS=10000000000

# Management fee in basis points (100 = 1%)
MANAGEMENT_FEE_BPS=100

# Profit share in basis points (1000 = 10%)
PROFIT_SHARE_BPS=1000

# Path to delegate keypair (the bot that will manage positions)
DELEGATE_KEYPAIR="./keypairs/delegate.json"

# =============================================================================
# Environment Check
# =============================================================================

echo "=============================================="
echo "  Delta-Neutral Vault Initialization"
echo "=============================================="
echo ""

# Check for solana CLI
if ! command -v solana &> /dev/null; then
    echo "ERROR: solana CLI not found"
    echo "Install from: https://docs.solana.com/cli/install-solana-cli-tools"
    exit 1
fi

# Check for drift-vaults CLI
if ! command -v drift-vaults &> /dev/null; then
    echo "WARNING: drift-vaults CLI not found"
    echo "Install with: cargo install drift-vaults-cli"
    echo ""
    echo "Continuing with example commands..."
    DRIFT_VAULTS_CMD="drift-vaults"
else
    DRIFT_VAULTS_CMD="drift-vaults"
fi

# Display current Solana config
echo "Current Solana Configuration:"
solana config get
echo ""

# =============================================================================
# Step 1: Initialize Vault
# =============================================================================

echo "=============================================="
echo "  Step 1: Initialize Vault"
echo "=============================================="
echo ""
echo "The following command will create your vault:"
echo ""

INIT_CMD="$DRIFT_VAULTS_CMD init-vault \\
    --name \"$VAULT_NAME\" \\
    --spot-market-index $SPOT_MARKET_INDEX \\
    --redeem-period $REDEEM_PERIOD \\
    --max-tokens $MAX_TOKENS \\
    --management-fee $MANAGEMENT_FEE_BPS \\
    --profit-share $PROFIT_SHARE_BPS"

echo "$INIT_CMD"
echo ""
echo "Parameters explained:"
echo "  --name: Unique identifier for your vault"
echo "  --spot-market-index: 0=USDC, 1=SOL, etc."
echo "  --redeem-period: Withdrawal waiting period (seconds)"
echo "  --max-tokens: Deposit cap in native decimals"
echo "  --management-fee: Annual fee in bps (100 = 1%)"
echo "  --profit-share: Performance fee in bps (1000 = 10%)"
echo ""

read -p "Run this command? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    eval "$INIT_CMD"
    echo ""
    echo "Vault initialized successfully!"
    echo "IMPORTANT: Save the vault address printed above!"
else
    echo "Skipped vault initialization."
fi
echo ""

# =============================================================================
# Step 2: Set Delegate
# =============================================================================

echo "=============================================="
echo "  Step 2: Set Vault Delegate"
echo "=============================================="
echo ""
echo "The delegate keypair will be authorized to manage positions."
echo "This should be a separate keypair from your main authority."
echo ""

# Check if delegate keypair exists
if [ ! -f "$DELEGATE_KEYPAIR" ]; then
    echo "Delegate keypair not found at: $DELEGATE_KEYPAIR"
    echo ""
    echo "Generate a new delegate keypair with:"
    echo "  mkdir -p keypairs"
    echo "  solana-keygen new --outfile $DELEGATE_KEYPAIR"
    echo ""
else
    DELEGATE_PUBKEY=$(solana-keygen pubkey "$DELEGATE_KEYPAIR" 2>/dev/null || echo "UNABLE_TO_READ")
    echo "Delegate keypair found: $DELEGATE_PUBKEY"
fi

echo ""
echo "After vault creation, set the delegate with:"
echo ""
echo "$DRIFT_VAULTS_CMD update-delegate \\"
echo "    --vault <VAULT_ADDRESS> \\"
echo "    --delegate <DELEGATE_PUBKEY>"
echo ""

read -p "Enter vault address to set delegate (or press Enter to skip): " VAULT_ADDRESS

if [ -n "$VAULT_ADDRESS" ] && [ -f "$DELEGATE_KEYPAIR" ]; then
    DELEGATE_PUBKEY=$(solana-keygen pubkey "$DELEGATE_KEYPAIR")
    echo ""
    echo "Setting delegate..."
    $DRIFT_VAULTS_CMD update-delegate \
        --vault "$VAULT_ADDRESS" \
        --delegate "$DELEGATE_PUBKEY"
    echo "Delegate set successfully!"
else
    echo "Skipped delegate setup."
fi
echo ""

# =============================================================================
# Step 3: Verify Vault
# =============================================================================

echo "=============================================="
echo "  Step 3: Verify Vault Configuration"
echo "=============================================="
echo ""
echo "View your vault details with:"
echo ""
echo "$DRIFT_VAULTS_CMD view-vault --vault <VAULT_ADDRESS>"
echo ""

if [ -n "$VAULT_ADDRESS" ]; then
    read -p "View vault now? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        $DRIFT_VAULTS_CMD view-vault --vault "$VAULT_ADDRESS"
    fi
fi
echo ""

# =============================================================================
# Next Steps
# =============================================================================

echo "=============================================="
echo "  Next Steps"
echo "=============================================="
echo ""
echo "1. Update your keeper/.env file:"
echo "   VAULT_ADDRESS=<your_vault_address>"
echo ""
echo "2. Fund the delegate wallet with SOL for transaction fees:"
echo "   solana transfer <DELEGATE_PUBKEY> 0.5 --allow-unfunded-recipient"
echo ""
echo "3. Deposit initial USDC to the vault (as authority):"
echo "   $DRIFT_VAULTS_CMD deposit --vault <VAULT_ADDRESS> --amount <USDC_AMOUNT>"
echo ""
echo "4. Run the keeper bot:"
echo "   cd keeper && npm run dev"
echo ""
echo "5. Monitor vault health:"
echo "   npx ts-node scripts/monitor-health.ts"
echo ""
echo "=============================================="
echo "  Useful Commands"
echo "=============================================="
echo ""
echo "Check funding rates:"
echo "   npx ts-node scripts/check-funding.ts"
echo ""
echo "Backtest strategy:"
echo "   npx ts-node scripts/backtest.ts"
echo ""
echo "View vault on UI:"
echo "   https://app.drift.trade/vaults/<VAULT_ADDRESS>"
echo ""
echo "Done!"
