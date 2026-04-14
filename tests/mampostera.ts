/**
 * MAMPOSTERA v2 — Test Suite Completo
 * Cubre: flujos normales + vectores de ataque de seguridad
 *
 * Para correr: anchor test
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Mampostera } from "../target/types/mampostera";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROPERTY_ID = new BN(1);

const VALID_PARAMS = {
  propertyId:   PROPERTY_ID,
  location:     "Cra 7 #45-12, Bogota, Colombia",
  totalValue:   new BN(12_000_000),            // $120,000 USD en cents
  totalTokens:  new BN(1_000_000_000_000),     // 1,000,000 tokens × 10^6 dec
  legalDocHash: "a3f8e12d4b9c6071e5a2d8f3b4c9e0a7d2f5b8c1e4a7d0f3b6c9e2a5d8f1b4c7",
  ipfsCid:      "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
};

async function derivePDAs(
  authority: PublicKey,
  propertyId: BN,
  programId: PublicKey
) {
  const pidBytes = propertyId.toArrayLike(Buffer, "le", 8);

  const [propertyState, stateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("property"), authority.toBuffer(), pidBytes],
    programId
  );

  const [rentVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("rent_vault"), propertyState.toBuffer()],
    programId
  );

  return { propertyState, stateBump, rentVault };
}

async function deriveClaimPDA(
  investor: PublicKey,
  propertyState: PublicKey,
  programId: PublicKey
) {
  const [claimPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), investor.toBuffer(), propertyState.toBuffer()],
    programId
  );
  return claimPDA;
}

// ─── Suite principal ──────────────────────────────────────────────────────────

describe("mampostera v2 — security & integration tests", () => {
  const provider  = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program   = anchor.workspace.Mampostera as Program<Mampostera>;
  const authority = provider.wallet.publicKey;

  const mintKP    = Keypair.generate();
  const investor1 = Keypair.generate();
  const investor2 = Keypair.generate();
  const attacker  = Keypair.generate();

  let propertyState: PublicKey;
  let rentVault:     PublicKey;

  // ─── Setup ──────────────────────────────────────────────────────────────

  before(async () => {
    const { propertyState: ps, rentVault: rv } = await derivePDAs(
      authority,
      PROPERTY_ID,
      program.programId
    );
    propertyState = ps;
    rentVault     = rv;

    // Fondear cuentas de prueba
    for (const kp of [investor1, investor2, attacker]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        3 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BLOQUE 1: initialize_property
  // ═══════════════════════════════════════════════════════════════════════════

  describe("initialize_property", () => {

    it("✅ inicializa correctamente con parámetros válidos", async () => {
      await program.methods
        .initializeProperty(VALID_PARAMS)
        .accounts({
          propertyState,
          propertyMint:  mintKP.publicKey,
          rentVault,
          authority,
          systemProgram: SystemProgram.programId,
          tokenProgram:  TOKEN_PROGRAM_ID,
          rent:          anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([mintKP])
        .rpc({ commitment: "confirmed" });

      const state = await program.account.propertyState.fetch(propertyState);

      assert.equal(state.location,     VALID_PARAMS.location);
      assert.equal(state.totalValue.toString(),  VALID_PARAMS.totalValue.toString());
      assert.equal(state.totalTokens.toString(), VALID_PARAMS.totalTokens.toString());
      assert.equal(state.tokensIssued.toString(), "0");
      assert.equal(state.collectedRent.toString(), "0");
      assert.equal(state.isActive,      true);
      assert.equal(state.isRentLocked,  false);
      assert.equal(state.legalDocHash,  VALID_PARAMS.legalDocHash);
      assert.equal(state.ipfsCid,       VALID_PARAMS.ipfsCid);
      assert.isAbove(state.vaultBump,   0); // vault_bump almacenado

      console.log("  → PropertyState:", propertyState.toBase58());
      console.log("  → Mint:         ", mintKP.publicKey.toBase58());
      console.log("  → Vault bump:   ", state.vaultBump);
    });

    it("❌ SEGURIDAD: rechaza valor de propiedad cero", async () => {
      const badMint = Keypair.generate();
      const { propertyState: badPS, rentVault: badVault } = await derivePDAs(
        authority, new BN(99), program.programId
      );

      try {
        await program.methods
          .initializeProperty({ ...VALID_PARAMS, propertyId: new BN(99), totalValue: new BN(0) })
          .accounts({
            propertyState: badPS,
            propertyMint:  badMint.publicKey,
            rentVault:     badVault,
            authority,
            systemProgram: SystemProgram.programId,
            tokenProgram:  TOKEN_PROGRAM_ID,
            rent:          anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([badMint])
          .rpc();
        assert.fail("Debería haber fallado");
      } catch (e: any) {
        assert.include(e.message, "InvalidPropertyValue");
      }
    });

    it("❌ SEGURIDAD: rechaza hash SHA-256 con caracteres inválidos", async () => {
      const badMint = Keypair.generate();
      const { propertyState: badPS, rentVault: badVault } = await derivePDAs(
        authority, new BN(98), program.programId
      );

      try {
        await program.methods
          .initializeProperty({
            ...VALID_PARAMS,
            propertyId: new BN(98),
            legalDocHash: "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG", // no hex
          })
          .accounts({
            propertyState: badPS,
            propertyMint:  badMint.publicKey,
            rentVault:     badVault,
            authority,
            systemProgram: SystemProgram.programId,
            tokenProgram:  TOKEN_PROGRAM_ID,
            rent:          anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([badMint])
          .rpc();
        assert.fail("Debería haber fallado");
      } catch (e: any) {
        assert.include(e.message, "InvalidDocHash");
      }
    });

    it("❌ SEGURIDAD: rechaza CID IPFS demasiado corto", async () => {
      const badMint = Keypair.generate();
      const { propertyState: badPS, rentVault: badVault } = await derivePDAs(
        authority, new BN(97), program.programId
      );

      try {
        await program.methods
          .initializeProperty({
            ...VALID_PARAMS,
            propertyId: new BN(97),
            ipfsCid: "QmCorto",
          })
          .accounts({
            propertyState: badPS,
            propertyMint:  badMint.publicKey,
            rentVault:     badVault,
            authority,
            systemProgram: SystemProgram.programId,
            tokenProgram:  TOKEN_PROGRAM_ID,
            rent:          anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([badMint])
          .rpc();
        assert.fail("Debería haber fallado");
      } catch (e: any) {
        assert.include(e.message, "InvalidIpfsCid");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BLOQUE 2: mint_fractional_tokens
  // ═══════════════════════════════════════════════════════════════════════════

  describe("mint_fractional_tokens", () => {

    it("✅ emite tokens al investor1 (10% = 100M tokens)", async () => {
      const AMOUNT = new BN(100_000_000_000_000); // 10% de 1M tokens × 10^6 dec
      const ata1 = await getAssociatedTokenAddress(mintKP.publicKey, investor1.publicKey);

      await program.methods
        .mintFractionalTokens(AMOUNT)
        .accounts({
          propertyState,
          propertyMint:         mintKP.publicKey,
          investorTokenAccount: ata1,
          investor:             investor1.publicKey,
          authority,
          systemProgram:        SystemProgram.programId,
          tokenProgram:         TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent:                 anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc({ commitment: "confirmed" });

      const tokenAccount = await getAccount(provider.connection, ata1);
      assert.equal(tokenAccount.amount.toString(), AMOUNT.toString());

      const state = await program.account.propertyState.fetch(propertyState);
      assert.equal(state.tokensIssued.toString(), AMOUNT.toString());
      console.log("  → Investor1 recibió:", AMOUNT.toString(), "tokens (10%)");
    });

    it("✅ emite tokens al investor2 (5%)", async () => {
      const AMOUNT = new BN(50_000_000_000_000); // 5%
      const ata2 = await getAssociatedTokenAddress(mintKP.publicKey, investor2.publicKey);

      await program.methods
        .mintFractionalTokens(AMOUNT)
        .accounts({
          propertyState,
          propertyMint:         mintKP.publicKey,
          investorTokenAccount: ata2,
          investor:             investor2.publicKey,
          authority,
          systemProgram:        SystemProgram.programId,
          tokenProgram:         TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent:                 anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc({ commitment: "confirmed" });

      const ata2Account = await getAccount(provider.connection, ata2);
      assert.equal(ata2Account.amount.toString(), AMOUNT.toString());
    });

    it("❌ SEGURIDAD: rechaza monto que excede supply total", async () => {
      const ata1 = await getAssociatedTokenAddress(mintKP.publicKey, investor1.publicKey);
      const OVERFLOW_AMOUNT = new BN("999999999999999999"); // más que el total

      try {
        await program.methods
          .mintFractionalTokens(OVERFLOW_AMOUNT)
          .accounts({
            propertyState,
            propertyMint:         mintKP.publicKey,
            investorTokenAccount: ata1,
            investor:             investor1.publicKey,
            authority,
            systemProgram:        SystemProgram.programId,
            tokenProgram:         TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            rent:                 anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .rpc();
        assert.fail("Debería haber fallado");
      } catch (e: any) {
        assert.include(e.message, "ExceedsTokenSupply");
      }
    });

    it("❌ SEGURIDAD: attacker no puede mintear (no es authority)", async () => {
      const attackerAta = await getAssociatedTokenAddress(mintKP.publicKey, attacker.publicKey);

      try {
        await program.methods
          .mintFractionalTokens(new BN(1_000_000))
          .accounts({
            propertyState,
            propertyMint:         mintKP.publicKey,
            investorTokenAccount: attackerAta,
            investor:             attacker.publicKey,
            authority:            attacker.publicKey, // ← atacante intenta ser authority
            systemProgram:        SystemProgram.programId,
            tokenProgram:         TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            rent:                 anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([attacker])
          .rpc();
        assert.fail("Debería haber fallado");
      } catch (e: any) {
        // Anchor rechaza porque has_one = authority no coincide
        assert.ok(
          e.message.includes("Unauthorized") || e.message.includes("ConstraintHasOne"),
          `Error inesperado: ${e.message}`
        );
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BLOQUE 3: deposit_rent
  // ═══════════════════════════════════════════════════════════════════════════

  describe("deposit_rent", () => {

    it("✅ deposita 2 SOL de renta en el vault", async () => {
      const RENT = new BN(2 * LAMPORTS_PER_SOL);
      const vaultBefore = await provider.connection.getBalance(rentVault);

      await program.methods
        .depositRent(RENT)
        .accounts({
          propertyState,
          rentVault,
          depositor:     authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      const vaultAfter = await provider.connection.getBalance(rentVault);
      assert.equal(vaultAfter - vaultBefore, 2 * LAMPORTS_PER_SOL);

      const state = await program.account.propertyState.fetch(propertyState);
      assert.equal(state.collectedRent.toString(), RENT.toString());
      console.log("  → Vault balance:", (vaultAfter / LAMPORTS_PER_SOL).toFixed(4), "SOL");
    });

    it("❌ SEGURIDAD: rechaza depósito menor al mínimo (0.001 SOL)", async () => {
      try {
        await program.methods
          .depositRent(new BN(500_000)) // 0.0005 SOL — bajo el mínimo
          .accounts({
            propertyState,
            rentVault,
            depositor:     authority,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("Debería haber fallado");
      } catch (e: any) {
        assert.include(e.message, "RentDepositTooSmall");
      }
    });

    it("❌ SEGURIDAD: rechaza depósito cuando hay distribución activa", async () => {
      // Primero activar distribución
      await program.methods
        .startDistribution()
        .accounts({ propertyState, authority })
        .rpc({ commitment: "confirmed" });

      // Intentar depositar — debe fallar
      try {
        await program.methods
          .depositRent(new BN(1 * LAMPORTS_PER_SOL))
          .accounts({
            propertyState,
            rentVault,
            depositor:     authority,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("Debería haber fallado");
      } catch (e: any) {
        assert.include(e.message, "RentDistributionInProgress");
      }

      // Limpiar: terminar distribución
      await program.methods
        .endDistribution()
        .accounts({ propertyState, authority })
        .rpc({ commitment: "confirmed" });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BLOQUE 4: distribución completa (start → claim × 2 → end)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("distribution flow completo", () => {

    let epochBefore: anchor.BN;

    it("✅ start_distribution bloquea el vault y hace snapshot", async () => {
      const stateBefore = await program.account.propertyState.fetch(propertyState);
      epochBefore = stateBefore.distributionEpoch;

      await program.methods
        .startDistribution()
        .accounts({ propertyState, authority })
        .rpc({ commitment: "confirmed" });

      const state = await program.account.propertyState.fetch(propertyState);
      assert.equal(state.isRentLocked, true);
      assert.equal(
        state.distributionEpoch.toString(),
        epochBefore.add(new BN(1)).toString()
      );
      assert.equal(
        state.rentSnapshot.toString(),
        state.collectedRent.toString()
      );
      console.log("  → Época:", state.distributionEpoch.toString());
      console.log("  → Snapshot:", (state.rentSnapshot.toNumber() / LAMPORTS_PER_SOL).toFixed(4), "SOL");
    });

    it("✅ investor1 reclama su parte proporcional (10%)", async () => {
      const state = await program.account.propertyState.fetch(propertyState);
      const snapshot = state.rentSnapshot.toNumber();
      const totalTokens = state.totalTokens.toNumber();

      const ata1 = await getAssociatedTokenAddress(mintKP.publicKey, investor1.publicKey);
      const ataAccount = await getAccount(provider.connection, ata1);
      const inv1Tokens = Number(ataAccount.amount);

      const expectedShare = Math.floor((inv1Tokens * snapshot) / totalTokens);

      const claimPDA1 = await deriveClaimPDA(investor1.publicKey, propertyState, program.programId);
      const balanceBefore = await provider.connection.getBalance(investor1.publicKey);

      await program.methods
        .claimRent()
        .accounts({
          propertyState,
          rentVault,
          investorClaim:       claimPDA1,
          investorTokenAccount: ata1,
          investor:            investor1.publicKey,
          systemProgram:       SystemProgram.programId,
          tokenProgram:        TOKEN_PROGRAM_ID,
        })
        .signers([investor1])
        .rpc({ commitment: "confirmed" });

      const balanceAfter = await provider.connection.getBalance(investor1.publicKey);
      const received = balanceAfter - balanceBefore;

      // La diferencia incluye fees de tx, así que validamos con tolerancia
      assert.approximately(received, expectedShare, 10_000, "Share incorrecto");
      console.log("  → Investor1 reclamó:", (received / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("  → Esperado ~:", (expectedShare / LAMPORTS_PER_SOL).toFixed(6), "SOL");
    });

    it("❌ SEGURIDAD: investor1 NO puede reclamar dos veces en la misma época (re-entrancy)", async () => {
      const ata1     = await getAssociatedTokenAddress(mintKP.publicKey, investor1.publicKey);
      const claimPDA = await deriveClaimPDA(investor1.publicKey, propertyState, program.programId);

      try {
        await program.methods
          .claimRent()
          .accounts({
            propertyState,
            rentVault,
            investorClaim:       claimPDA,
            investorTokenAccount: ata1,
            investor:            investor1.publicKey,
            systemProgram:       SystemProgram.programId,
            tokenProgram:        TOKEN_PROGRAM_ID,
          })
          .signers([investor1])
          .rpc();
        assert.fail("Debería haber fallado: doble claim");
      } catch (e: any) {
        assert.include(e.message, "ClaimAlreadyProcessed",
          `Esperaba ClaimAlreadyProcessed, recibió: ${e.message}`
        );
        console.log("  → Ataque de doble claim bloqueado correctamente ✓");
      }
    });

    it("✅ investor2 reclama su parte (5%)", async () => {
      const ata2     = await getAssociatedTokenAddress(mintKP.publicKey, investor2.publicKey);
      const claimPDA = await deriveClaimPDA(investor2.publicKey, propertyState, program.programId);

      const balanceBefore = await provider.connection.getBalance(investor2.publicKey);

      await program.methods
        .claimRent()
        .accounts({
          propertyState,
          rentVault,
          investorClaim:       claimPDA,
          investorTokenAccount: ata2,
          investor:            investor2.publicKey,
          systemProgram:       SystemProgram.programId,
          tokenProgram:        TOKEN_PROGRAM_ID,
        })
        .signers([investor2])
        .rpc({ commitment: "confirmed" });

      const balanceAfter = await provider.connection.getBalance(investor2.publicKey);
      const received = balanceAfter - balanceBefore;
      console.log("  → Investor2 reclamó:", (received / LAMPORTS_PER_SOL).toFixed(6), "SOL");
    });

    it("❌ SEGURIDAD: attacker sin tokens no puede reclamar", async () => {
      // Crear un ATA vacío para el attacker
      const attackerAta = await getAssociatedTokenAddress(mintKP.publicKey, attacker.publicKey);
      const claimPDA    = await deriveClaimPDA(attacker.publicKey, propertyState, program.programId);

      try {
        await program.methods
          .claimRent()
          .accounts({
            propertyState,
            rentVault,
            investorClaim:       claimPDA,
            investorTokenAccount: attackerAta,
            investor:            attacker.publicKey,
            systemProgram:       SystemProgram.programId,
            tokenProgram:        TOKEN_PROGRAM_ID,
          })
          .signers([attacker])
          .rpc();
        assert.fail("El atacante no debería poder reclamar");
      } catch (e: any) {
        // Puede fallar por cuenta inexistente o InvestorHasNoTokens
        assert.ok(
          e.message.includes("InvestorHasNoTokens") ||
          e.message.includes("AccountNotInitialized") ||
          e.message.includes("AccountOwnedByWrongProgram"),
          `Error inesperado: ${e.message}`
        );
        console.log("  → Ataque de claim sin tokens bloqueado correctamente ✓");
      }
    });

    it("✅ end_distribution desbloquea el vault", async () => {
      await program.methods
        .endDistribution()
        .accounts({ propertyState, authority })
        .rpc({ commitment: "confirmed" });

      const state = await program.account.propertyState.fetch(propertyState);
      assert.equal(state.isRentLocked, false);
      assert.equal(state.rentSnapshot.toString(), "0");
      console.log("  → Distribución epoch terminada. Renta restante:",
        (state.collectedRent.toNumber() / LAMPORTS_PER_SOL).toFixed(6), "SOL");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BLOQUE 5: toggle_property
  // ═══════════════════════════════════════════════════════════════════════════

  describe("toggle_property", () => {

    it("✅ authority puede desactivar la propiedad", async () => {
      await program.methods
        .toggleProperty(false)
        .accounts({ propertyState, authority })
        .rpc({ commitment: "confirmed" });

      const state = await program.account.propertyState.fetch(propertyState);
      assert.equal(state.isActive, false);
    });

    it("❌ SEGURIDAD: attacker no puede reactivar la propiedad", async () => {
      try {
        await program.methods
          .toggleProperty(true)
          .accounts({
            propertyState,
            authority: attacker.publicKey,
          })
          .signers([attacker])
          .rpc();
        assert.fail("Debería haber fallado");
      } catch (e: any) {
        assert.ok(
          e.message.includes("Unauthorized") || e.message.includes("ConstraintHasOne"),
          `Error inesperado: ${e.message}`
        );
      }
    });

    it("✅ authority reactiva la propiedad", async () => {
      await program.methods
        .toggleProperty(true)
        .accounts({ propertyState, authority })
        .rpc({ commitment: "confirmed" });

      const state = await program.account.propertyState.fetch(propertyState);
      assert.equal(state.isActive, true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BLOQUE 6: verificaciones finales de estado
  // ═══════════════════════════════════════════════════════════════════════════

  describe("estado final del programa", () => {

    it("✅ distribucion_epoch incrementó correctamente", async () => {
      const state = await program.account.propertyState.fetch(propertyState);
      // epochBefore + 1 epochs de test (start_distribution se llamó 3 veces pero 2 con end)
      assert.isAbove(state.distributionEpoch.toNumber(), 0);
      console.log("  → Época final:", state.distributionEpoch.toString());
    });

    it("✅ distributed_rent > 0 después de 2 claims", async () => {
      const state = await program.account.propertyState.fetch(propertyState);
      assert.isAbove(state.distributedRent.toNumber(), 0);
      console.log("  → Total distribuido:",
        (state.distributedRent.toNumber() / LAMPORTS_PER_SOL).toFixed(6), "SOL");
    });

    it("✅ resumen completo del estado on-chain", async () => {
      const state = await program.account.propertyState.fetch(propertyState);
      console.log("\n  ╔══════════════════════════════════════╗");
      console.log("  ║   MAMPOSTERA — Estado Final (Devnet)  ║");
      console.log("  ╠══════════════════════════════════════╣");
      console.log(`  ║ Propiedad:     ${propertyState.toBase58().substring(0,20)}...`);
      console.log(`  ║ Mint:          ${mintKP.publicKey.toBase58().substring(0,20)}...`);
      console.log(`  ║ Location:      ${state.location}`);
      console.log(`  ║ Total value:   $${(state.totalValue.toNumber() / 100).toLocaleString()} USD`);
      console.log(`  ║ Tokens issued: ${state.tokensIssued.toString()}`);
      console.log(`  ║ Renta recibida: ${(state.collectedRent.toNumber() / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
      console.log(`  ║ Distribuido:   ${(state.distributedRent.toNumber() / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      console.log(`  ║ Época actual:  ${state.distributionEpoch.toString()}`);
      console.log(`  ║ Activa:        ${state.isActive}`);
      console.log("  ╚══════════════════════════════════════╝\n");
    });
  });
});
