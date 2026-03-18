/**
 * Mint Drift devnet USDC to a wallet using the on-chain TokenFaucet program.
 *
 * Usage:
 *   npx ts-node scripts/mint-drift-usdc.ts [recipient] [amount]
 *
 * Defaults:
 *   recipient = 6hbS1d1JRRta3GtJC7XNo16gg3PTb41QJVzy6kWsZnav
 *   amount    = 10_000 USDC
 */

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

// --- constants ---------------------------------------------------------------
const RPC_URL = 'https://api.devnet.solana.com';
const FAUCET_PROGRAM_ID = new PublicKey('V4v1mQiAdLz4qwckEb45WqHYceYizoib39cDBHSWfaB');
const DRIFT_DEVNET_USDC = new PublicKey('8zGuJQqwhZafTah7Uc7Z4tXRnguqkn5KLFAP8oV6PHe2');

// Minimal IDL for the token_faucet program – only the mintToUser instruction
const TOKEN_FAUCET_IDL: any = {
  version: '0.1.0',
  name: 'token_faucet',
  instructions: [
    {
      name: 'mintToUser',
      accounts: [
        { name: 'faucetConfig', isMut: false, isWritable: false },
        { name: 'mintAccount', isMut: true, isWritable: true },
        { name: 'userTokenAccount', isMut: true, isWritable: true },
        { name: 'mintAuthority', isMut: false, isWritable: false },
        { name: 'tokenProgram', isMut: false, isWritable: false },
      ],
      args: [{ name: 'amount', type: 'u64' }],
    },
  ],
  accounts: [
    {
      name: 'FaucetConfig',
      type: {
        kind: 'struct',
        fields: [
          { name: 'admin', type: 'publicKey' },
          { name: 'mint', type: 'publicKey' },
          { name: 'mintAuthority', type: 'publicKey' },
          { name: 'mintAuthorityNonce', type: 'u8' },
        ],
      },
    },
  ],
};

async function main() {
  const args = process.argv.slice(2);
  const recipientStr = args[0] || '6hbS1d1JRRta3GtJC7XNo16gg3PTb41QJVzy6kWsZnav';
  const amountUsdc = Number(args[1] || '10000');
  const recipient = new PublicKey(recipientStr);
  const amountRaw = new BN(amountUsdc * 1_000_000); // 6 decimals

  console.log(`Minting ${amountUsdc} Drift devnet USDC to ${recipient.toBase58()}...`);

  // Load fee payer (delegate keypair – any funded devnet keypair works)
  const keypairPath = path.resolve(__dirname, '..', 'keeper', 'keypairs', 'delegate.json');
  const secret = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));

  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(TOKEN_FAUCET_IDL, FAUCET_PROGRAM_ID, provider);

  // Derive faucet PDAs
  const [faucetConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('faucet_config'), DRIFT_DEVNET_USDC.toBuffer()],
    FAUCET_PROGRAM_ID,
  );
  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint_authority'), DRIFT_DEVNET_USDC.toBuffer()],
    FAUCET_PROGRAM_ID,
  );

  // Get / create recipient ATA
  const recipientAta = await getAssociatedTokenAddress(DRIFT_DEVNET_USDC, recipient);

  const tx = new Transaction();

  // Create ATA idempotently (no-op if it already exists)
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      recipientAta,
      recipient,
      DRIFT_DEVNET_USDC,
    ),
  );

  // Mint USDC via faucet
  const mintIx = await program.methods
    .mintToUser(amountRaw)
    .accounts({
      faucetConfig,
      mintAccount: DRIFT_DEVNET_USDC,
      userTokenAccount: recipientAta,
      mintAuthority,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  tx.add(mintIx);

  const sig = await provider.sendAndConfirm(tx);
  console.log(`Success! tx: ${sig}`);

  // Verify balance
  const balance = await connection.getTokenAccountBalance(recipientAta);
  console.log(`Drift USDC balance: ${balance.value.uiAmountString}`);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
