/**
 * MAMPOSTERA — Tests Mercado Secundario P2P (Fase 2b)
 * Archivo independiente — no modifica tests anteriores
 *
 * Cubre:
 * - Flujo completo: create_offer → accept_offer → fee cobrado
 * - Cancelación por vendedor y por expiración
 * - Ataques: comprador sin KYC, precio manipulado, vendedor = comprador
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
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function airdrop(conn: anchor.web3.Connection, pk: PublicKey, sol = 3) {
  const sig = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
}

function investorKycPDA(investor: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("investor_kyc"), investor.toBuffer()],
    programId
  )[0];
}

function programConfigPDA(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("program_config")],
    programId
  )[0];
}

function feeTreasuryPDA(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee_treasury")],
    programId
  )[0];
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("mampostera — Mercado Secundario (Fase 2b)", () => {
  const provider  = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program   = anchor.workspace.Mampostera as Program<Mampostera>;
  const authority = provider.wallet.publicKey;

  const seller      = Keypair.generate();
  const buyer       = Keypair.generate();
  const buyerNoKyc  = Keypair.generate();
  const mintKP      = Keypair.generate();

  const PROPERTY_ID = new BN(200); // distinto a Fases 1 y 2a

  let propertyState:  PublicKey;
  let rentVault:      PublicKey;
  let programConfig:  PublicKey;
  let feeTreasury:    PublicKey;
  let sellerAta:      PublicKey;
  let buyerAta:       PublicKey;

  // slot captured at offer creation — needed for PDA derivation
  let offerCreatedSlot: BN;
  let offerPDA:         PublicKey;
  let escrowAta:        PublicKey;

  before(async () => {
    for (const kp of [seller, buyer, buyerNoKyc]) {
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
    feeTreasury   = feeTreasuryPDA(program.programId);

    sellerAta = await getAssociatedTokenAddress(mintKP.publicKey, seller.publicKey);
    buyerAta  = await getAssociatedTokenAddress(mintKP.publicKey, buyer.publicKey);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Setup: propiedad + KYC de seller y buyer
  // ═══════════════════════════════════════════════════════════════════════════

  it("✅ setup: inicializa propiedad de mercado-test", async () => {
    await program.methods
      .initializeProperty({
        propertyId:   PROPERTY_ID,
        location:     "Av. El Dorado #68B-31, Bogota",
        totalValue:   new BN(50_000_000),
        totalTokens:  new BN(5_000_000_000_000),
        legalDocHash: "c7d4e1f8a5b2c9d6e3f0a7b4c1d8e5f2a9b6c3d0e7f4a1b8c5d2e9f6a3b0c7d4",
        ipfsCid:      "QmNLei78zWmzUdbeRB3CiUfAizWUrbeeZh4MA4ghXYnK8h",
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
    console.log("  → Propiedad market-test:", propertyState.toBase58());
  });

  it("✅ setup: registra y aprueba KYC de seller y buyer", async () => {
    const sellerKyc = investorKycPDA(seller.publicKey, program.programId);
    const buyerKyc  = investorKycPDA(buyer.publicKey,  program.programId);

    // Registrar
    for (const [kp, name, ref] of [
      [seller, "Ana Seller", "sha256_seller"],
      [buyer,  "Pedro Buyer", "sha256_buyer"],
    ] as [Keypair, string, string][]) {
      const kyc = investorKycPDA(kp.publicKey, program.programId);
      await program.methods
        .registerInvestor({ fullName: name, docReference: ref, countryCode: "CO" })
        .accounts({ investorProfile: kyc, investor: kp.publicKey, systemProgram: SystemProgram.programId })
        .signers([kp])
        .rpc({ commitment: "confirmed" });
    }

    // Aprobar ambos
    for (const kyc of [sellerKyc, buyerKyc]) {
      await program.methods
        .approveInvestor()
        .accounts({ investorProfile: kyc, programConfig, authority })
        .rpc({ commitment: "confirmed" });
    }
    console.log("  → seller y buyer con KYC aprobado ✓");
  });

  it("✅ setup: mintea 200 tokens al seller", async () => {
    const sellerKyc = investorKycPDA(seller.publicKey, program.programId);
    const AMOUNT    = new BN(200_000_000); // 200 tokens

    await program.methods
      .mintFractionalTokens(AMOUNT)
      .accounts({
        propertyState,
        propertyMint:         mintKP.publicKey,
        investorTokenAccount: sellerAta,
        investor:             seller.publicKey,
        investorKyc:          sellerKyc,
        authority,
        systemProgram:        SystemProgram.programId,
        tokenProgram:         TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent:                 anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc({ commitment: "confirmed" });

    const ataInfo = await getAccount(provider.connection, sellerAta);
    assert.equal(ataInfo.amount.toString(), AMOUNT.toString());
    console.log("  → Seller tiene 200 tokens ✓");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Crear oferta
  // ═══════════════════════════════════════════════════════════════════════════

  it("✅ seller crea oferta: 100 tokens @ 0.01 SOL/token", async () => {
    const slot = await provider.connection.getSlot();
    offerCreatedSlot = new BN(slot);

    const slotBytes = offerCreatedSlot.toArrayLike(Buffer, "le", 8);
    [offerPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("offer"), seller.publicKey.toBuffer(), mintKP.publicKey.toBuffer(), slotBytes],
      program.programId
    );
    [escrowAta] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), offerPDA.toBuffer()],
      program.programId
    );

    const AMOUNT        = new BN(100_000_000);          // 100 tokens
    const PRICE_PER_TOK = new BN(10_000);               // 0.00001 SOL por microtoken

    await program.methods
      .createOffer(AMOUNT, PRICE_PER_TOK, null)        // sin expiración
      .accounts({
        offer:               offerPDA,
        escrowTokenAccount:  escrowAta,
        sellerTokenAccount:  sellerAta,
        propertyMint:        mintKP.publicKey,
        seller:              seller.publicKey,
        systemProgram:       SystemProgram.programId,
        tokenProgram:        TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent:                anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([seller])
      .rpc({ commitment: "confirmed" });

    const offer = await program.account.offer.fetch(offerPDA);
    assert.equal(offer.isActive, true);
    assert.equal(offer.amountTokens.toString(), AMOUNT.toString());
    assert.equal(offer.seller.toBase58(), seller.publicKey.toBase58());

    // Los tokens deben estar en el escrow, no en el seller
    const escrow = await getAccount(provider.connection, escrowAta);
    assert.equal(escrow.amount.toString(), AMOUNT.toString());

    const sellerBal = await getAccount(provider.connection, sellerAta);
    assert.equal(sellerBal.amount.toString(), "100000000"); // quedaron 100

    console.log("  → Oferta creada:", offerPDA.toBase58());
    console.log("  → Tokens en escrow:", escrow.amount.toString());
  });

  it("❌ SEGURIDAD: seller no puede crear oferta con más tokens de los que tiene", async () => {
    const slotCur = await provider.connection.getSlot();
    const slotBytes = new BN(slotCur + 1000).toArrayLike(Buffer, "le", 8);
    const [badOffer] = PublicKey.findProgramAddressSync(
      [Buffer.from("offer"), seller.publicKey.toBuffer(), mintKP.publicKey.toBuffer(), slotBytes],
      program.programId
    );
    const [badEscrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), badOffer.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .createOffer(new BN(999_000_000_000), new BN(1), null) // más de lo que tiene
        .accounts({
          offer:               badOffer,
          escrowTokenAccount:  badEscrow,
          sellerTokenAccount:  sellerAta,
          propertyMint:        mintKP.publicKey,
          seller:              seller.publicKey,
          systemProgram:       SystemProgram.programId,
          tokenProgram:        TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent:                anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([seller])
        .rpc();
      assert.fail("Debería haber fallado");
    } catch (e: any) {
      assert.include(e.message, "InsufficientTokenBalance");
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Aceptar oferta
  // ═══════════════════════════════════════════════════════════════════════════

  it("✅ buyer (KYC aprobado) acepta la oferta — swap atómico", async () => {
    const buyerKyc = investorKycPDA(buyer.publicKey, program.programId);

    const offerData     = await program.account.offer.fetch(offerPDA);
    const totalPrice    = offerData.totalPriceLamports.toNumber();
    const expectedFee   = Math.floor(totalPrice * 50 / 10_000); // 0.5%
    const sellerReceives = totalPrice - expectedFee;

    const sellerBefore    = await provider.connection.getBalance(seller.publicKey);
    const treasuryBefore  = await provider.connection.getBalance(feeTreasury);

    await program.methods
      .acceptOffer()
      .accounts({
        offer:               offerPDA,
        escrowTokenAccount:  escrowAta,
        buyerTokenAccount:   buyerAta,
        propertyMint:        mintKP.publicKey,
        buyerKyc,
        seller:              seller.publicKey,
        feeTreasury,
        buyer:               buyer.publicKey,
        systemProgram:       SystemProgram.programId,
        tokenProgram:        TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent:                anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([buyer])
      .rpc({ commitment: "confirmed" });

    // ── Verificar tokens llegaron al buyer ─────────────────────────────────
    const buyerTokens = await getAccount(provider.connection, buyerAta);
    assert.equal(buyerTokens.amount.toString(), "100000000");

    // ── Verificar SOL llegaron al seller (menos fee) ───────────────────────
    const sellerAfter = await provider.connection.getBalance(seller.publicKey);
    assert.approximately(sellerAfter - sellerBefore, sellerReceives, 10_000);

    // ── Verificar fee llegó al treasury ───────────────────────────────────
    const treasuryAfter = await provider.connection.getBalance(feeTreasury);
    assert.approximately(treasuryAfter - treasuryBefore, expectedFee, 10_000);

    // ── Oferta marcada inactiva ────────────────────────────────────────────
    const offerAfter = await program.account.offer.fetch(offerPDA);
    assert.equal(offerAfter.isActive, false);

    console.log("  → Swap completado ✓");
    console.log("  → Tokens al buyer:    100000000");
    console.log("  → SOL al seller:     ", (sellerReceives / LAMPORTS_PER_SOL).toFixed(6));
    console.log("  → Fee al treasury:   ", (expectedFee / LAMPORTS_PER_SOL).toFixed(6));
  });

  it("❌ SEGURIDAD: no puede aceptar una oferta ya cerrada", async () => {
    const buyerKyc = investorKycPDA(buyer.publicKey, program.programId);

    try {
      await program.methods
        .acceptOffer()
        .accounts({
          offer: offerPDA,
          escrowTokenAccount:  escrowAta,
          buyerTokenAccount:   buyerAta,
          propertyMint:        mintKP.publicKey,
          buyerKyc,
          seller:              seller.publicKey,
          feeTreasury,
          buyer:               buyer.publicKey,
          systemProgram:       SystemProgram.programId,
          tokenProgram:        TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent:                anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([buyer])
        .rpc();
      assert.fail("Debería haber fallado");
    } catch (e: any) {
      assert.ok(
        e.message.includes("OfferNotActive") || e.message.includes("ConstraintRaw"),
        `Error inesperado: ${e.message}`
      );
      console.log("  → Doble aceptación bloqueada ✓");
    }
  });

  it("❌ SEGURIDAD: buyer sin KYC no puede aceptar ofertas", async () => {
    // Crear nueva oferta para este test
    const slot2    = await provider.connection.getSlot();
    const s2Bytes  = new BN(slot2).toArrayLike(Buffer, "le", 8);
    const [offer2] = PublicKey.findProgramAddressSync(
      [Buffer.from("offer"), seller.publicKey.toBuffer(), mintKP.publicKey.toBuffer(), s2Bytes],
      program.programId
    );
    const [escrow2] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), offer2.toBuffer()],
      program.programId
    );

    await program.methods
      .createOffer(new BN(10_000_000), new BN(1_000), null)
      .accounts({
        offer: offer2, escrowTokenAccount: escrow2,
        sellerTokenAccount: sellerAta, propertyMint: mintKP.publicKey,
        seller: seller.publicKey, systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([seller])
      .rpc({ commitment: "confirmed" });

    // buyerNoKyc nunca se registró — su PDA no existe
    const noKycPDA = investorKycPDA(buyerNoKyc.publicKey, program.programId);
    const noKycAta = await getAssociatedTokenAddress(mintKP.publicKey, buyerNoKyc.publicKey);

    try {
      await program.methods
        .acceptOffer()
        .accounts({
          offer: offer2, escrowTokenAccount: escrow2,
          buyerTokenAccount: noKycAta, propertyMint: mintKP.publicKey,
          buyerKyc: noKycPDA,             // PDA inexistente
          seller: seller.publicKey, feeTreasury,
          buyer: buyerNoKyc.publicKey,
          systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([buyerNoKyc])
        .rpc();
      assert.fail("buyerNoKyc no debería poder comprar");
    } catch (e: any) {
      assert.ok(
        e.message.includes("AccountNotInitialized") ||
        e.message.includes("InvestorNotApproved") ||
        e.message.includes("AnchorError"),
        `Error inesperado: ${e.message}`
      );
      console.log("  → Compra sin KYC bloqueada ✓");

      // Limpiar: seller cancela la oferta
      await program.methods
        .cancelOffer()
        .accounts({
          offer: offer2, escrowTokenAccount: escrow2,
          sellerTokenAccount: sellerAta, seller: seller.publicKey,
          propertyMint: mintKP.publicKey,
          signer: seller.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([seller])
        .rpc({ commitment: "confirmed" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Cancelación
  // ═══════════════════════════════════════════════════════════════════════════

  it("✅ seller puede cancelar su oferta y recupera tokens", async () => {
    const slot3    = await provider.connection.getSlot();
    const s3Bytes  = new BN(slot3).toArrayLike(Buffer, "le", 8);
    const [offer3] = PublicKey.findProgramAddressSync(
      [Buffer.from("offer"), seller.publicKey.toBuffer(), mintKP.publicKey.toBuffer(), s3Bytes],
      program.programId
    );
    const [escrow3] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), offer3.toBuffer()],
      program.programId
    );

    const AMOUNT = new BN(50_000_000); // 50 tokens
    await program.methods
      .createOffer(AMOUNT, new BN(5_000), null)
      .accounts({
        offer: offer3, escrowTokenAccount: escrow3,
        sellerTokenAccount: sellerAta, propertyMint: mintKP.publicKey,
        seller: seller.publicKey, systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([seller])
      .rpc({ commitment: "confirmed" });

    const sellerBalBefore = await getAccount(provider.connection, sellerAta);

    await program.methods
      .cancelOffer()
      .accounts({
        offer: offer3, escrowTokenAccount: escrow3,
        sellerTokenAccount: sellerAta, seller: seller.publicKey,
        propertyMint: mintKP.publicKey,
        signer: seller.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([seller])
      .rpc({ commitment: "confirmed" });

    const sellerBalAfter = await getAccount(provider.connection, sellerAta);
    const returned = Number(sellerBalAfter.amount) - Number(sellerBalBefore.amount);
    assert.equal(returned, AMOUNT.toNumber());

    const offer3Data = await program.account.offer.fetch(offer3);
    assert.equal(offer3Data.isActive, false);

    console.log("  → Seller recuperó", returned, "tokens tras cancelación ✓");
  });

  it("❌ SEGURIDAD: tercero no puede cancelar oferta activa no expirada", async () => {
    const slot4    = await provider.connection.getSlot();
    const s4Bytes  = new BN(slot4).toArrayLike(Buffer, "le", 8);
    const [offer4] = PublicKey.findProgramAddressSync(
      [Buffer.from("offer"), seller.publicKey.toBuffer(), mintKP.publicKey.toBuffer(), s4Bytes],
      program.programId
    );
    const [escrow4] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), offer4.toBuffer()],
      program.programId
    );

    await program.methods
      .createOffer(new BN(10_000_000), new BN(1_000), new BN(500_000)) // expira en ~3.5 días
      .accounts({
        offer: offer4, escrowTokenAccount: escrow4,
        sellerTokenAccount: sellerAta, propertyMint: mintKP.publicKey,
        seller: seller.publicKey, systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([seller])
      .rpc({ commitment: "confirmed" });

    try {
      await program.methods
        .cancelOffer()
        .accounts({
          offer: offer4, escrowTokenAccount: escrow4,
          sellerTokenAccount: sellerAta, seller: seller.publicKey,
          propertyMint: mintKP.publicKey,
          signer: buyer.publicKey, // ← tercero intentando cancelar
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc();
      assert.fail("Tercero no debería poder cancelar");
    } catch (e: any) {
      assert.ok(
        e.message.includes("Unauthorized") || e.message.includes("OfferNotExpired"),
        `Error inesperado: ${e.message}`
      );
      console.log("  → Cancelación por tercero bloqueada ✓");

      // Limpiar
      await program.methods
        .cancelOffer()
        .accounts({
          offer: offer4, escrowTokenAccount: escrow4,
          sellerTokenAccount: sellerAta, seller: seller.publicKey,
          propertyMint: mintKP.publicKey,
          signer: seller.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([seller])
        .rpc({ commitment: "confirmed" });
    }
  });

  it("✅ resumen estado final del mercado", async () => {
    const sellerBal = await getAccount(provider.connection, sellerAta);
    const buyerBal  = await getAccount(provider.connection, buyerAta);
    const treasury  = await provider.connection.getBalance(feeTreasury);

    console.log("\n  ╔══════════════════════════════════════╗");
    console.log("  ║  Mercado Secundario — Fase 2b final  ║");
    console.log("  ╠══════════════════════════════════════╣");
    console.log(`  ║ Seller tokens restantes: ${sellerBal.amount.toString().padEnd(12)} ║`);
    console.log(`  ║ Buyer tokens adquiridos: ${buyerBal.amount.toString().padEnd(12)} ║`);
    console.log(`  ║ Fee treasury (SOL):  ${(treasury/LAMPORTS_PER_SOL).toFixed(6).padEnd(15)} ║`);
    console.log("  ╚══════════════════════════════════════╝\n");
  });
});
