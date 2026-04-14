/**
 * scripts/deposit-rent.ts
 * Deposit SOL rent into a property's vault on testnet.
 *
 * Usage:
 *   ANCHOR_PROVIDER_URL=https://api.testnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   PROPERTY_PDA=<base58_address> \
 *   RENT_SOL=0.05 \
 *   npx ts-node scripts/deposit-rent.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Mampostera;

  const propertyPDAStr = process.env.PROPERTY_PDA;
  const rentSOL        = parseFloat(process.env.RENT_SOL || "0.05");

  if (!propertyPDAStr) {
    console.error("❌ Set PROPERTY_PDA env variable");
    process.exit(1);
  }

  const propertyPDA = new PublicKey(propertyPDAStr);
  const [rentVaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("rent_vault"), propertyPDA.toBuffer()],
    program.programId
  );

  const lamports = Math.round(rentSOL * LAMPORTS_PER_SOL);

  console.log(`\n💰 Depositing ${rentSOL} SOL rent`);
  console.log(`   Property: ${propertyPDA.toBase58()}`);
  console.log(`   Vault:    ${rentVaultPDA.toBase58()}`);

  const tx = await program.methods
    .depositRent(new anchor.BN(lamports))
    .accounts({
      propertyState: propertyPDA,
      rentVault:     rentVaultPDA,
      depositor:     provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: "confirmed" });

  console.log(`\n✅ Rent deposited!`);
  console.log(`   Tx: https://explorer.solana.com/tx/${tx}?cluster=testnet`);
}

main().catch(console.error);
