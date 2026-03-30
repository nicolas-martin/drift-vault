/**
 * One-time vault initialization script.
 * Run once to create the vault on-chain, then delete this file.
 *
 * Usage: npx ts-node src/init-vault-once.ts
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
	DriftClient,
	Wallet,
	initialize,
	getMarketsAndOraclesForSubscription,
	BN,
} from '@drift-labs/sdk';
import { VaultClient, getVaultAddressSync, encodeName, type DriftVaults } from '@drift-labs/vaults-sdk';
import { Program, AnchorProvider, type Idl } from '@coral-xyz/anchor';
// Load the IDL directly from the installed package (avoids on-chain IDL fetch)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const DRIFT_VAULTS_IDL = require('@drift-labs/vaults-sdk/src/idl/drift_vaults.json') as Idl;
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL: string = process.env['RPC_URL'] ?? '';
if (!RPC_URL) {
	throw new Error('RPC_URL must be set in .env');
}
const DRIFT_ENV = (process.env['DRIFT_ENV'] || 'mainnet-beta') as 'devnet' | 'mainnet-beta';
const VAULTS_PROGRAM_ID = new PublicKey('vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR');

// Manager keypair — the vault authority
const MANAGER_KEYPAIR_PATH = path.resolve(__dirname, '../keypairs/manager.json');
const DELEGATE_KEYPAIR_PATH = path.resolve(__dirname, '../keypairs/delegate.json');

async function main() {
	console.log(`=== Initializing Delta-Neutral Vault on ${DRIFT_ENV} ===\n`);

	// Load keypairs
	const managerKp = Keypair.fromSecretKey(
		Uint8Array.from(JSON.parse(fs.readFileSync(MANAGER_KEYPAIR_PATH, 'utf-8')))
	);
	const delegateKp = Keypair.fromSecretKey(
		Uint8Array.from(JSON.parse(fs.readFileSync(DELEGATE_KEYPAIR_PATH, 'utf-8')))
	);

	console.log(`Manager:  ${managerKp.publicKey.toBase58()}`);
	console.log(`Delegate: ${delegateKp.publicKey.toBase58()}`);

	const connection = new Connection(RPC_URL, 'confirmed');
	const managerBalance = await connection.getBalance(managerKp.publicKey);
	console.log(`Manager balance: ${(managerBalance / 1e9).toFixed(4)} SOL\n`);

	if (managerBalance < 0.005 * 1e9) {
		throw new Error('Insufficient SOL in manager account. Need at least 0.005 SOL.');
	}

	const wallet = new Wallet(managerKp);
	const sdkConfig = initialize({ env: DRIFT_ENV });
	const { perpMarketIndexes, spotMarketIndexes, oracleInfos } =
		getMarketsAndOraclesForSubscription(DRIFT_ENV);

	const driftClient = new DriftClient({
		connection,
		wallet,
		programID: new PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
		env: DRIFT_ENV,
		perpMarketIndexes,
		spotMarketIndexes,
		oracleInfos,
		accountSubscription: { type: 'websocket' },
	});

	console.log('Subscribing to Drift...');
	await driftClient.subscribe();
	console.log('Connected!\n');

	const vaultsProgram = new Program<DriftVaults>(
		DRIFT_VAULTS_IDL as DriftVaults,
		VAULTS_PROGRAM_ID,
		driftClient.provider as AnchorProvider
	);
	const vaultClient = new VaultClient({ driftClient, program: vaultsProgram });

	// Vault parameters — CONSERVATIVE for initial mainnet testing
	const vaultName = 'delta-neutral-sol-v1';
	const nameBytes = encodeName(vaultName);
	const vaultAddress = getVaultAddressSync(VAULTS_PROGRAM_ID, nameBytes);

	console.log(`Vault name: ${vaultName}`);
	console.log(`Vault address (deterministic): ${vaultAddress.toBase58()}`);
	console.log(`Environment: ${DRIFT_ENV}`);

	// Check if vault already exists
	try {
		await vaultClient.getVault(vaultAddress);
		console.log('\nVault already exists!');
		console.log(`Vault: ${vaultAddress.toBase58()}`);
		console.log('\nkeeper/.env:');
		console.log(`  VAULT_ADDRESS=${vaultAddress.toBase58()}`);
		console.log('\nfrontend/.env.local:');
		console.log(`  NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddress.toBase58()}`);
		await driftClient.unsubscribe();
		return;
	} catch {
		console.log('Vault does not exist yet, creating...\n');
	}

	// MAINNET PARAMETERS — intentionally conservative:
	// - Max $100 USDC deposit cap (for testing)
	// - $1 minimum deposit
	// - 1 hour redemption period (short for testing, increase later)
	// - 0% fees (testing, no point charging ourselves)
	const maxTokens = new BN(100_000_000);        // 100 USDC (6 decimals)
	const minDeposit = new BN(1_000_000);          // 1 USDC
	const redeemPeriod = new BN(3600);             // 1 hour

	console.log('Vault parameters:');
	console.log(`  Spot market: 0 (USDC)`);
	console.log(`  Max tokens: $100 USDC`);
	console.log(`  Min deposit: $1 USDC`);
	console.log(`  Redeem period: 1 hour`);
	console.log(`  Management fee: 0%`);
	console.log(`  Profit share: 0%`);
	console.log(`  Permissioned: false`);
	console.log('');

	console.log('Initializing vault...');
	const txSig = await vaultClient.initializeVault({
		name: nameBytes,
		spotMarketIndex: 0,            // USDC
		redeemPeriod,
		maxTokens,
		minDepositAmount: minDeposit,
		managementFee: new BN(0),      // 0% — testing
		profitShare: 0,                 // 0% — testing
		hurdleRate: 0,
		permissioned: false,
	});
	console.log(`Vault initialized! Tx: ${txSig}`);
	console.log(`  Explorer: https://solana.fm/tx/${txSig}`);
	const latestBlockhash1 = await connection.getLatestBlockhash('confirmed');
	await connection.confirmTransaction({ signature: txSig, ...latestBlockhash1 }, 'confirmed');
	console.log('  Confirmed!\n');

	// Append to setup log file
	const logPath = path.resolve(__dirname, '../../logs/mainnet-setup.log');
	const logLine = (msg: string) => {
		const ts = new Date().toISOString();
		const line = `${ts} ${msg}\n`;
		try { fs.appendFileSync(logPath, line); } catch {}
		console.log(msg);
	};

	logLine(`VAULT CREATED: ${vaultAddress.toBase58()}`);
	logLine(`INIT TX: https://solana.fm/tx/${txSig}`);

	// Set delegate
	logLine(`Setting delegate to: ${delegateKp.publicKey.toBase58()}`);
	const delegateTx = await vaultClient.updateDelegate(vaultAddress, delegateKp.publicKey);
	logLine(`DELEGATE TX: https://solana.fm/tx/${delegateTx}`);
	const latestBlockhash2 = await connection.getLatestBlockhash('confirmed');
	await connection.confirmTransaction({ signature: delegateTx, ...latestBlockhash2 }, 'confirmed');
	logLine('Delegate confirmed!');

	logLine('');
	logLine('=== VAULT SETUP COMPLETE ===');
	logLine(`  Vault:    ${vaultAddress.toBase58()}`);
	logLine(`  Manager:  ${managerKp.publicKey.toBase58()}`);
	logLine(`  Delegate: ${delegateKp.publicKey.toBase58()}`);
	logLine(`  Network:  ${DRIFT_ENV}`);
	logLine(`  Max deposit: $100 USDC`);
	logLine(`  Min deposit: $1 USDC`);

	console.log('\n=== UPDATE YOUR .env FILES ===');
	console.log('');
	console.log('keeper/.env:');
	console.log(`  VAULT_ADDRESS=${vaultAddress.toBase58()}`);
	console.log('');
	console.log('frontend/.env.local:');
	console.log(`  NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddress.toBase58()}`);
	console.log('');
	console.log(`Delegate pubkey: ${delegateKp.publicKey.toBase58()}`);

	await driftClient.unsubscribe();
}

main().catch((err) => {
	console.error('Failed:', err.message || err);
	process.exit(1);
});
