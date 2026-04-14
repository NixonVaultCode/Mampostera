/**
 * scripts/init-property.ts
 * CLI script to initialize a property on Solana Testnet.
 *
 * Usage:
 *   ANCHOR_PROVIDER_URL=https://api.testnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/init-property.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as crypto from "crypto";
import * as fs from "fs";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Mampostera;

  // ── Property config ────────────────────────────────────────────
  const LOCATION   = "Cra 7 #45-12, Bogota, Colombia";
  const TOTAL_VALUE_USD = 120_000;       // $120,000 USD
  const TOTAL_TOKENS    = 1_000_000;     // 1M fractional tokens
  const APY             = 8.5;           // 8.5% annual yield

  // Generate or load legal doc hash
  // In production: SHA-256 of your actual PDF
  let legalDocHash: string;
  const pdfPath = process.env.LEGAL_PDF_PATH;
  if (pdfPath && fs.existsSync(pdfPath)) {
    const pdfBuffer = fs.readFileSync(pdfPath);
    legalDocHash = crypto.createHash("sha256").update(pdfBuffer).digest("hex");
    console.log(`📄 PDF hash computed: ${legalDocHash}`);
  } else {
    // Placeholder for testing
    legalDocHash = "a3f8e12d4b9c6071e5a2d8f3b4c9e0a7d2f5b8c1e4a7d0f3b6c9e2a5d8f1b4c7";
    console.warn("⚠️  Using placeholder hash. Set LEGAL_PDF_PATH for production.");
  }

  const ipfsCid = process.env.IPFS_CID || "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

  // ── Derive PDAs ────────────────────────────────────────────────
  const mintKP = Keypair.generate();

  const [propertyPDA, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("property"),
      provider.wallet.publicKey.toBuffer(),
      Buffer.from(LOCATION),
    ],
    program.programId
  );

  const [rentVaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("rent_vault"), propertyPDA.toBuffer()],
    program.programId
  );

  console.log("\n🏗️  Mampostera — Initialize Property");
  console.log("════════════════════════════════════════");
  console.log(`Network:      Testnet`);
  console.log(`Authority:    ${provider.wallet.publicKey.toBase58()}`);
  console.log(`Program ID:   ${program.programId.toBase58()}`);
  console.log(`Property PDA: ${propertyPDA.toBase58()}`);
  console.log(`Mint keypair: ${mintKP.publicKey.toBase58()}`);
  console.log(`Rent vault:   ${rentVaultPDA.toBase58()}`);
  console.log(`Location:     ${LOCATION}`);
  console.log(`Value:        $${TOTAL_VALUE_USD.toLocaleString()} USD`);
  console.log(`Tokens:       ${TOTAL_TOKENS.toLocaleString()}`);
  console.log(`APY:          ${APY}%`);
  console.log(`Legal hash:   ${legalDocHash.slice(0, 16)}…`);
  console.log(`IPFS CID:     ${ipfsCid}`);
  console.log("════════════════════════════════════════\n");

  // ── Execute transaction ────────────────────────────────────────
  console.log("📡 Sending transaction to testnet...");

  const tx = await program.methods
    .initializeProperty({
      location:     LOCATION,
      totalValue:   new anchor.BN(TOTAL_VALUE_USD * 100), // cents
      totalTokens:  new anchor.BN(TOTAL_TOKENS),
      legalDocHash: legalDocHash,
      ipfsCid:      ipfsCid,
    })
    .accounts({
      propertyState: propertyPDA,
      propertyMint:  mintKP.publicKey,
      authority:     provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram:  TOKEN_PROGRAM_ID,
      rent:          anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([mintKP])
    .rpc({ commitment: "confirmed" });

  console.log(`\n✅ Property initialized on-chain!`);
  console.log(`   Tx signature: ${tx}`);
  console.log(`   Explorer: https://explorer.solana.com/tx/${tx}?cluster=testnet`);
  console.log(`\n   Property PDA: ${propertyPDA.toBase58()}`);
  console.log(`   Mint address: ${mintKP.publicKey.toBase58()}`);
  console.log(`\n📝 Add to .env.local:`);
  console.log(`   NEXT_PUBLIC_PROGRAM_ID=${program.programId.toBase58()}`);
  console.log(`   NEXT_PUBLIC_AUTHORITY_PUBKEY=${provider.wallet.publicKey.toBase58()}`);

  // Save mint keypair for future use
  const mintKeyPath = `./mint-${LOCATION.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.json`;
  fs.writeFileSync(mintKeyPath, JSON.stringify(Array.from(mintKP.secretKey)));
  console.log(`\n💾 Mint keypair saved to: ${mintKeyPath}`);
  console.log(`   ⚠️  Keep this file secure — needed for future token operations`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message || err);
  process.exit(1);
});
