import { PublicKey } from '@solana/web3.js';

export type DriftEnv = 'devnet' | 'mainnet-beta';

export interface Config {
  rpcUrl: string;
  vaultAddress: PublicKey | null;
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
  console.warn(`Invalid DRIFT_ENV "${value}", defaulting to devnet`);
  return 'devnet';
}

export function getConfig(): Config {
  return {
    rpcUrl: getEnvVar('NEXT_PUBLIC_RPC_URL', 'https://api.devnet.solana.com'),
    vaultAddress: parsePublicKey(process.env.NEXT_PUBLIC_VAULT_ADDRESS),
    driftEnv: parseDriftEnv(getEnvVar('NEXT_PUBLIC_DRIFT_ENV', 'devnet')),
  };
}

export const config = getConfig();
