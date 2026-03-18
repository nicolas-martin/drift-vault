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
	BulkAccountLoader,
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

const RPC_URL = process.env['RPC_URL'] || 'https://api.devnet.solana.com';
const DRIFT_ENV = 'devnet' as const;
const VAULTS_PROGRAM_ID = new PublicKey('vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR');

// Use the default Solana keypair as manager (it has devnet SOL)
const MANAGER_KEYPAIR_PATH = path.resolve(process.env['HOME']!, '.config/solana/id.json');
const DELEGATE_KEYPAIR_PATH = path.resolve(__dirname, '../keypairs/delegate.json');

async function main() {
	console.log('=== Initializing Delta-Neutral Vault on Devnet ===\n');

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

	if (managerBalance < 0.1 * 1e9) {
		throw new Error('Insufficient SOL in manager account. Need at least 0.1 SOL.');
	}

	const wallet = new Wallet(managerKp);
	const sdkConfig = initialize({ env: DRIFT_ENV });
	const bulkAccountLoader = new BulkAccountLoader(connection, 'confirmed', 1000);
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
		accountSubscription: { type: 'polling', accountLoader: bulkAccountLoader },
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

	// Vault parameters
	const vaultName = 'delta-neutral-sol-v1';
	const nameBytes = encodeName(vaultName);
	const vaultAddress = getVaultAddressSync(VAULTS_PROGRAM_ID, nameBytes);

	console.log(`Vault name: ${vaultName}`);
	console.log(`Vault address: ${vaultAddress.toBase58()}`);

	// Check if vault already exists
	try {
		const existing = await vaultClient.getVault(vaultAddress);
		console.log('\nVault already exists!');
		console.log(`Vault: ${vaultAddress.toBase58()}`);
		await printEnvInstructions(vaultAddress.toBase58(), delegateKp.publicKey.toBase58());
		await driftClient.unsubscribe();
		return;
	} catch {
		console.log('Vault does not exist yet, creating...\n');
	}

	console.log('Initializing vault...');
	const txSig = await vaultClient.initializeVault({
		name: nameBytes,
		spotMarketIndex: 0,           // USDC
		redeemPeriod: new BN(86400),  // 24 hour redemption window
		maxTokens: new BN(10_000_000_000_000), // 10M USDC max
		minDepositAmount: new BN(10_000_000), // $10 min deposit
		managementFee: new BN(100),   // 1% annual management fee
		profitShare: 1000,             // 10% profit share
		hurdleRate: 0,
		permissioned: false,
	});
	console.log(`Vault initialized! Tx: ${txSig}`);
	await connection.confirmTransaction(txSig, 'confirmed');

	// Set delegate
	console.log(`\nSetting delegate to: ${delegateKp.publicKey.toBase58()}`);
	const delegateTx = await vaultClient.updateDelegate(vaultAddress, delegateKp.publicKey);
	console.log(`Delegate set! Tx: ${delegateTx}`);
	await connection.confirmTransaction(delegateTx, 'confirmed');

	console.log('\n=== Vault initialized successfully! ===');
	console.log(`Vault address: ${vaultAddress.toBase58()}`);

	await printEnvInstructions(vaultAddress.toBase58(), delegateKp.publicKey.toBase58());
	await driftClient.unsubscribe();
}

async function printEnvInstructions(vaultAddress: string, delegatePubkey: string) {
	console.log('\n=== Next Steps ===');
	console.log('Add this to keeper/.env:');
	console.log(`  VAULT_ADDRESS=${vaultAddress}`);
	console.log('\nAdd this to frontend/.env.local:');
	console.log(`  NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddress}`);
	console.log(`\nDelegate pubkey (for reference): ${delegatePubkey}`);
}

main().catch((err) => {
	console.error('Failed:', err.message || err);
	process.exit(1);
});
