/**
 * MAMPOSTERA — Tests KYC (Fase 2a)
 * Archivo independiente — no modifica tests/mampostera.ts de Fase 1
 *
 * Cubre:
 * - Flujo completo: register → approve → mint con KYC
 * - Revocación y cumplimiento OFAC
 * - Ataques: mint sin KYC, autoridad falsa, doble aprobación
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN }  from "@coral-xyz/anchor";
import { Mampostera }    from "../target/types/mampostera";
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
} from "@solana/spl-token";
import { assert } from "chai";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function airdrop(
  conn: anchor.web3.Connection,
  pk: PublicKey,
  sol = 2
) {
  const sig = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
}

function investorKycPDA(investor: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("investor_kyc"), investor.toBuffer()],
    programId
  )[0];
}

function programConfigPDA(programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("program_config")],
    programId
  )[0];
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("mampostera — KYC (Fase 2a)", () => {
  const provider  = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program   = anchor.workspace.Mampostera as Program<Mampostera>;
  const authority = provider.wallet.publicKey;

  // Actores del test
  const investor1  = Keypair.generate(); // se aprobará
  const investor2  = Keypair.generate(); // se revocará
  const attacker   = Keypair.generate(); // nunca aprobado
  const fakeMint   = Keypair.generate();

  const PROPERTY_ID = new BN(100); // distinto al de Fase 1
  let propertyState: PublicKey;
  let rentVault: PublicKey;
  let programConfig: PublicKey;

  before(async () => {
    for (const kp of [investor1, investor2, attacker]) {
      await airdrop(provider.connection, kp.publicKey);
    }

    const pidBytes = PROPERTY_ID.toArrayLike(Buffer, "le", 8);
    [propertyState] = PublicKey.findProgramAddressSync(
      [Buffer.from("property"), authority.toBuffer(), pidBytes],
      program.programId
    );
    [rentVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("rent_vault"), propertyState.toBuffer()],
      program.programId
    );
    programConfig = programConfigPDA(program.programId);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Inicializar config global
  // ═══════════════════════════════════════════════════════════════════════════

  it("✅ inicializa ProgramConfig con la authority correcta", async () => {
    await program.methods
      .initializeProgramConfig()
      .accounts({
        programConfig,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    const config = await program.account.programConfig.fetch(programConfig);
    assert.equal(config.authority.toBase58(), authority.toBase58());
    console.log("  → ProgramConfig:", programConfig.toBase58());
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Registro de inversores
  // ═══════════════════════════════════════════════════════════════════════════

  it("✅ investor1 se registra correctamente", async () => {
    const kyc1 = investorKycPDA(investor1.publicKey, program.programId);

    await program.methods
      .registerInvestor({
        fullName:     "Maria Garcia",
        docReference: "sha256_of_1234567890",  // hash del CC, no el número real
        countryCode:  "CO",
      })
      .accounts({
        investorProfile: kyc1,
        investor:        investor1.publicKey,
        systemProgram:   SystemProgram.programId,
      })
      .signers([investor1])
      .rpc({ commitment: "confirmed" });

    const profile = await program.account.investorProfile.fetch(kyc1);
    assert.equal(profile.investor.toBase58(), investor1.publicKey.toBase58());
    assert.deepEqual(profile.status, { pending: {} });
    assert.equal(profile.countryCode, "CO");
    console.log("  → KYC investor1 (Pending):", kyc1.toBase58());
  });

  it("✅ investor2 se registra correctamente", async () => {
    const kyc2 = investorKycPDA(investor2.publicKey, program.programId);

    await program.methods
      .registerInvestor({
        fullName:     "Carlos Mendez",
        docReference: "sha256_of_9876543210",
        countryCode:  "CO",
      })
      .accounts({
        investorProfile: kyc2,
        investor:        investor2.publicKey,
        systemProgram:   SystemProgram.programId,
      })
      .signers([investor2])
      .rpc({ commitment: "confirmed" });

    const profile = await program.account.investorProfile.fetch(kyc2);
    assert.deepEqual(profile.status, { pending: {} });
  });

  it("❌ SEGURIDAD: rechaza código de país inválido (minúsculas)", async () => {
    const badKP  = Keypair.generate();
    await airdrop(provider.connection, badKP.publicKey);
    const badKyc = investorKycPDA(badKP.publicKey, program.programId);

    try {
      await program.methods
        .registerInvestor({
          fullName:     "Test User",
          docReference: "ref123",
          countryCode:  "co",  // ← inválido, debe ser uppercase
        })
        .accounts({
          investorProfile: badKyc,
          investor:        badKP.publicKey,
          systemProgram:   SystemProgram.programId,
        })
        .signers([badKP])
        .rpc();
      assert.fail("Debería haber fallado");
    } catch (e: any) {
      assert.include(e.message, "InvalidCountryCode");
    }
  });

  it("❌ SEGURIDAD: rechaza nombre vacío", async () => {
    const badKP  = Keypair.generate();
    await airdrop(provider.connection, badKP.publicKey);
    const badKyc = investorKycPDA(badKP.publicKey, program.programId);

    try {
      await program.methods
        .registerInvestor({
          fullName:     "",
          docReference: "ref456",
          countryCode:  "US",
        })
        .accounts({
          investorProfile: badKyc,
          investor:        badKP.publicKey,
          systemProgram:   SystemProgram.programId,
        })
        .signers([badKP])
        .rpc();
      assert.fail("Debería haber fallado");
    } catch (e: any) {
      assert.include(e.message, "InvalidInvestorName");
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Aprobación por authority
  // ═══════════════════════════════════════════════════════════════════════════

  it("✅ authority aprueba a investor1", async () => {
    const kyc1 = investorKycPDA(investor1.publicKey, program.programId);

    await program.methods
      .approveInvestor()
      .accounts({
        investorProfile: kyc1,
        programConfig,
        authority,
      })
      .rpc({ commitment: "confirmed" });

    const profile = await program.account.investorProfile.fetch(kyc1);
    assert.deepEqual(profile.status, { approved: {} });
    assert.isAbove(profile.approvedAt.toNumber(), 0);
    console.log("  → investor1 APROBADO en timestamp:", profile.approvedAt.toString());
  });

  it("✅ authority aprueba a investor2", async () => {
    const kyc2 = investorKycPDA(investor2.publicKey, program.programId);
    await program.methods
      .approveInvestor()
      .accounts({ investorProfile: kyc2, programConfig, authority })
      .rpc({ commitment: "confirmed" });

    const profile = await program.account.investorProfile.fetch(kyc2);
    assert.deepEqual(profile.status, { approved: {} });
  });

  it("❌ SEGURIDAD: attacker no puede aprobar inversores", async () => {
    // Registrar un nuevo inversor para intentar aprobar
    const target  = Keypair.generate();
    await airdrop(provider.connection, target.publicKey);
    const targetKyc = investorKycPDA(target.publicKey, program.programId);

    await program.methods
      .registerInvestor({ fullName: "Target", docReference: "ref789", countryCode: "MX" })
      .accounts({ investorProfile: targetKyc, investor: target.publicKey, systemProgram: SystemProgram.programId })
      .signers([target])
      .rpc({ commitment: "confirmed" });

    try {
      // Attacker intenta aprobar usando su propia wallet como authority
      await program.methods
        .approveInvestor()
        .accounts({
          investorProfile: targetKyc,
          programConfig,
          authority: attacker.publicKey, // ← authority falsa
        })
        .signers([attacker])
        .rpc();
      assert.fail("El attacker no debería poder aprobar");
    } catch (e: any) {
      assert.ok(
        e.message.includes("Unauthorized") || e.message.includes("ConstraintHasOne"),
        `Error inesperado: ${e.message}`
      );
      console.log("  → Aprobación por attacker bloqueada ✓");
    }
  });

  it("❌ SEGURIDAD: no puede aprobar un inversor ya aprobado", async () => {
    const kyc1 = investorKycPDA(investor1.publicKey, program.programId);

    try {
      await program.methods
        .approveInvestor()
        .accounts({ investorProfile: kyc1, programConfig, authority })
        .rpc();
      assert.fail("Debería haber fallado: ya aprobado");
    } catch (e: any) {
      assert.include(e.message, "InvestorAlreadyApproved");
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Mint con KYC
  // ═══════════════════════════════════════════════════════════════════════════

  it("✅ prepara propiedad KYC-test en devnet", async () => {
    const pidBytes = PROPERTY_ID.toArrayLike(Buffer, "le", 8);
    const mintKP   = fakeMint;

    await program.methods
      .initializeProperty({
        propertyId:   PROPERTY_ID,
        location:     "Calle 93 #11-27, Bogota, Colombia",
        totalValue:   new BN(20_000_000),
        totalTokens:  new BN(2_000_000_000_000),
        legalDocHash: "b7c4e1f8a5b2c9d6e3f0a7b4c1d8e5f2a9b6c3d0e7f4a1b8c5d2e9f6a3b0c7d4",
        ipfsCid:      "QmPK1s3pNYLi9ERiq3BDxKa4XosgWwFRoz7QCLhRUTSAE",
      })
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

    console.log("  → Propiedad KYC-test:", propertyState.toBase58());
  });

  it("✅ investor1 (KYC aprobado) puede comprar tokens", async () => {
    const kyc1 = investorKycPDA(investor1.publicKey, program.programId);
    const ata1  = await getAssociatedTokenAddress(fakeMint.publicKey, investor1.publicKey);
    const AMOUNT = new BN(10_000_000); // 10 tokens

    await program.methods
      .mintFractionalTokens(AMOUNT)
      .accounts({
        propertyState,
        propertyMint:         fakeMint.publicKey,
        investorTokenAccount: ata1,
        investor:             investor1.publicKey,
        investorKyc:          kyc1,
        authority,
        systemProgram:        SystemProgram.programId,
        tokenProgram:         TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent:                 anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc({ commitment: "confirmed" });

    console.log("  → investor1 recibió 10 tokens con KYC ✓");
  });

  it("❌ SEGURIDAD: attacker SIN KYC no puede comprar tokens", async () => {
    // El attacker nunca se registró ni fue aprobado
    // Intentar pasar el PDA de kyc de investor1 con la wallet del attacker
    // El constraint de seeds verificará que investor == attacker
    const attackerAta = await getAssociatedTokenAddress(
      fakeMint.publicKey, attacker.publicKey
    );
    // Intentar usar el KYC de investor1 para el attacker
    const kyc1 = investorKycPDA(investor1.publicKey, program.programId);

    try {
      await program.methods
        .mintFractionalTokens(new BN(1_000_000))
        .accounts({
          propertyState,
          propertyMint:         fakeMint.publicKey,
          investorTokenAccount: attackerAta,
          investor:             attacker.publicKey,
          investorKyc:          kyc1, // KYC de otro inversor — seeds no coinciden
          authority,
          systemProgram:        SystemProgram.programId,
          tokenProgram:         TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent:                 anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      assert.fail("El attacker no debería poder mintear");
    } catch (e: any) {
      // El constraint de seeds rechaza el KYC porque investor.key() != attacker.key()
      assert.ok(
        e.message.includes("seeds") ||
        e.message.includes("ConstraintSeeds") ||
        e.message.includes("InvestorNotApproved") ||
        e.message.includes("AnchorError"),
        `Error inesperado: ${e.message}`
      );
      console.log("  → Mint sin KYC bloqueado ✓");
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Revocación OFAC/UIAF
  // ═══════════════════════════════════════════════════════════════════════════

  it("✅ authority revoca a investor2 (cumplimiento OFAC)", async () => {
    const kyc2 = investorKycPDA(investor2.publicKey, program.programId);

    await program.methods
      .revokeInvestor("Aparece en lista OFAC SDN — sanción internacional")
      .accounts({ investorProfile: kyc2, programConfig, authority })
      .rpc({ commitment: "confirmed" });

    const profile = await program.account.investorProfile.fetch(kyc2);
    assert.deepEqual(profile.status, { revoked: {} });
    assert.isAbove(profile.revokedAt.toNumber(), 0);
    console.log("  → investor2 REVOCADO. Timestamp:", profile.revokedAt.toString());
  });

  it("❌ SEGURIDAD: investor2 revocado no puede comprar tokens", async () => {
    const kyc2 = investorKycPDA(investor2.publicKey, program.programId);
    const ata2  = await getAssociatedTokenAddress(fakeMint.publicKey, investor2.publicKey);

    try {
      await program.methods
        .mintFractionalTokens(new BN(1_000_000))
        .accounts({
          propertyState,
          propertyMint:         fakeMint.publicKey,
          investorTokenAccount: ata2,
          investor:             investor2.publicKey,
          investorKyc:          kyc2,
          authority,
          systemProgram:        SystemProgram.programId,
          tokenProgram:         TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent:                 anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      assert.fail("investor2 revocado no debería poder mintear");
    } catch (e: any) {
      assert.include(e.message, "InvestorNotApproved");
      console.log("  → Mint de inversor revocado bloqueado ✓");
    }
  });

  it("✅ investor2 puede ser re-aprobado después de resolución", async () => {
    const kyc2 = investorKycPDA(investor2.publicKey, program.programId);

    await program.methods
      .approveInvestor()
      .accounts({ investorProfile: kyc2, programConfig, authority })
      .rpc({ commitment: "confirmed" });

    const profile = await program.account.investorProfile.fetch(kyc2);
    assert.deepEqual(profile.status, { approved: {} });
    console.log("  → investor2 re-aprobado tras resolución ✓");
  });

  it("✅ resumen estado KYC final", async () => {
    const kyc1 = await program.account.investorProfile.fetch(
      investorKycPDA(investor1.publicKey, program.programId)
    );
    const kyc2 = await program.account.investorProfile.fetch(
      investorKycPDA(investor2.publicKey, program.programId)
    );

    console.log("\n  ╔══════════════════════════════════════╗");
    console.log("  ║     Estado KYC — Fase 2a completa    ║");
    console.log("  ╠══════════════════════════════════════╣");
    console.log(`  ║ investor1: ${JSON.stringify(kyc1.status).padEnd(20)} ║`);
    console.log(`  ║ investor2: ${JSON.stringify(kyc2.status).padEnd(20)} ║`);
    console.log("  ╚══════════════════════════════════════╝\n");
  });
});
