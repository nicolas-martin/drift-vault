import { PublicKey } from '@solana/web3.js';

export type DriftEnv = 'devnet' | 'mainnet-beta';

// Drift Vaults program ID (same for devnet and mainnet)
const DRIFT_VAULTS_PROGRAM_ID = new PublicKey('vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR');

export interface Config {
	rpcUrl: string;
	vaultAddress: PublicKey | null;
	vaultsProgramId: PublicKey;
	driftEnv: DriftEnv;
}

function getEnvVar(key: string, defaultValue?: string): string {
	const value = process.env[key] ?? defaultValue;
	if (value === undefined) {
		throw new Error(`Missing environment variable: ${key}`);
	}
	return value;
}

function parsePublicKey(value: string | undefined): PublicKey | null {
	if (!value || value.trim() === '') {
		return null;
	}
	try {
		return new PublicKey(value);
	} catch {
		console.error(`Invalid public key: ${value}`);
		return null;
	}
}

function parseDriftEnv(value: string): DriftEnv {
	if (value === 'mainnet-beta' || value === 'devnet') {
		return value;
	}
	console.warn(`Invalid DRIFT_ENV "${value}", defaulting to mainnet-beta`);
	return 'mainnet-beta';
}

export function getConfig(): Config {
	// IMPORTANT: Next.js only inlines process.env.NEXT_PUBLIC_* when accessed
	// directly — NOT through a helper like process.env[key]. So we must
	// reference them explicitly here.
	const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
	const driftEnvRaw = process.env.NEXT_PUBLIC_DRIFT_ENV;

	if (!rpcUrl) {
		throw new Error('Missing environment variable: NEXT_PUBLIC_RPC_URL');
	}
	if (!driftEnvRaw) {
		throw new Error('Missing environment variable: NEXT_PUBLIC_DRIFT_ENV');
	}

	const vaultAddress = parsePublicKey(process.env.NEXT_PUBLIC_VAULT_ADDRESS);
	const driftEnv = parseDriftEnv(driftEnvRaw);

	// Debug: log resolved config (visible in browser console)
	if (typeof window !== 'undefined') {
		console.log('[config] Resolved config:', {
			rpcUrl: rpcUrl.substring(0, 60),
			vaultAddress: vaultAddress?.toBase58() ?? 'null',
			driftEnv,
		});
	}

	return {
		rpcUrl,
		vaultAddress,
		vaultsProgramId: DRIFT_VAULTS_PROGRAM_ID,
		driftEnv,
	};
}

export const config = getConfig();
