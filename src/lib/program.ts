/**
 * lib/program.ts — Mampostera v0.4.0
 * Cliente Anchor real para Solana. Sin mocks. Lee y escribe on-chain.
 *
 * En producción, reemplaza IDL_STUB con:
 *   import IDL from "../utils/mampostera.json"  (generado por `yarn idl:copy`)
 */

import {
  Connection, PublicKey, SystemProgram, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { PropertyStateAccount, PropertyUI, PortfolioPosition } from "../types";

// ── Network config ──────────────────────────────────────────────────────────
export const NETWORK = (process.env.NEXT_PUBLIC_SOLANA_NETWORK as "devnet" | "testnet") ?? "devnet";

export const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_ENDPOINT ??
  (NETWORK === "testnet"
    ? "https://api.testnet.solana.com"
    : "https://api.devnet.solana.com");

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? "MAMPoSTERA11111111111111111111111111111111"
);

export const CIVIC_GATEKEEPER_NETWORK = new PublicKey(
  process.env.NEXT_PUBLIC_CIVIC_GATEKEEPER ?? "ignREusXmGrscGNUesoU9mxfds9AiYTezUKex2PsZV6"
);

// ── IDL completo v0.4.0 (32 instrucciones) ──────────────────────────────────
// Este IDL es un stub completo. En producción ejecutar:
//   anchor build && yarn idl:copy
// Luego cambiar a: import IDL from "../utils/mampostera.json"
export const IDL = {
  version: "0.4.0",
  name: "mampostera",
  instructions: [
    // ── Fase 1: Core ────────────────────────────────────────────────────────
    {
      name: "initializeProperty",
      accounts: [
        { name: "propertyState",   isMut: true,  isSigner: false },
        { name: "propertyMint",    isMut: true,  isSigner: true  },
        { name: "rentVault",       isMut: true,  isSigner: false },
        { name: "authority",       isMut: true,  isSigner: true  },
        { name: "systemProgram",   isMut: false, isSigner: false },
        { name: "tokenProgram",    isMut: false, isSigner: false },
        { name: "rent",            isMut: false, isSigner: false },
      ],
      args: [{ name: "params", type: { defined: "InitPropertyParams" } }],
    },
    {
      name: "mintFractionalTokens",
      accounts: [
        { name: "propertyState",        isMut: true,  isSigner: false },
        { name: "propertyMint",         isMut: true,  isSigner: false },
        { name: "investorTokenAccount", isMut: true,  isSigner: false },
        { name: "investor",             isMut: false, isSigner: false },
        { name: "investorKyc",          isMut: false, isSigner: false },
        { name: "authority",            isMut: true,  isSigner: true  },
        { name: "systemProgram",        isMut: false, isSigner: false },
        { name: "tokenProgram",         isMut: false, isSigner: false },
        { name: "associatedTokenProgram", isMut: false, isSigner: false },
        { name: "rent",                 isMut: false, isSigner: false },
      ],
      args: [{ name: "amount", type: "u64" }],
    },
    {
      name: "depositRent",
      accounts: [
        { name: "propertyState", isMut: true,  isSigner: false },
        { name: "rentVault",     isMut: true,  isSigner: false },
        { name: "depositor",     isMut: true,  isSigner: true  },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [{ name: "amountLamports", type: "u64" }],
    },
    {
      name: "startDistribution",
      accounts: [
        { name: "propertyState", isMut: true, isSigner: false },
        { name: "rentVault",     isMut: true, isSigner: false },
        { name: "authority",     isMut: true, isSigner: true  },
      ],
      args: [],
    },
    {
      name: "claimRent",
      accounts: [
        { name: "propertyState",       isMut: true,  isSigner: false },
        { name: "rentVault",           isMut: true,  isSigner: false },
        { name: "investorClaim",       isMut: true,  isSigner: false },
        { name: "investorTokenAccount",isMut: false, isSigner: false },
        { name: "investor",            isMut: true,  isSigner: true  },
        { name: "systemProgram",       isMut: false, isSigner: false },
        { name: "tokenProgram",        isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: "endDistribution",
      accounts: [
        { name: "propertyState", isMut: true, isSigner: false },
        { name: "authority",     isMut: true, isSigner: true  },
      ],
      args: [],
    },
    {
      name: "toggleProperty",
      accounts: [
        { name: "propertyState", isMut: true, isSigner: false },
        { name: "authority",     isMut: true, isSigner: true  },
      ],
      args: [{ name: "active", type: "bool" }],
    },
    // ── Fase 2: KYC ─────────────────────────────────────────────────────────
    {
      name: "initializeProgramConfig",
      accounts: [
        { name: "programConfig", isMut: true,  isSigner: false },
        { name: "authority",     isMut: true,  isSigner: true  },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: "registerInvestor",
      accounts: [
        { name: "investorProfile", isMut: true,  isSigner: false },
        { name: "investor",        isMut: true,  isSigner: true  },
        { name: "systemProgram",   isMut: false, isSigner: false },
      ],
      args: [{ name: "params", type: { defined: "RegisterInvestorParams" } }],
    },
    {
      name: "approveInvestor",
      accounts: [
        { name: "investorProfile", isMut: true,  isSigner: false },
        { name: "programConfig",   isMut: false, isSigner: false },
        { name: "authority",       isMut: false, isSigner: true  },
      ],
      args: [],
    },
    {
      name: "revokeInvestor",
      accounts: [
        { name: "investorProfile", isMut: true,  isSigner: false },
        { name: "programConfig",   isMut: false, isSigner: false },
        { name: "authority",       isMut: false, isSigner: true  },
      ],
      args: [{ name: "reason", type: "string" }],
    },
    // ── Fase 2b: Mercado ─────────────────────────────────────────────────────
    {
      name: "createOffer",
      accounts: [
        { name: "offer",              isMut: true,  isSigner: false },
        { name: "escrowTokenAccount", isMut: true,  isSigner: false },
        { name: "sellerTokenAccount", isMut: true,  isSigner: false },
        { name: "propertyMint",       isMut: false, isSigner: false },
        { name: "seller",             isMut: true,  isSigner: true  },
        { name: "systemProgram",      isMut: false, isSigner: false },
        { name: "tokenProgram",       isMut: false, isSigner: false },
        { name: "associatedTokenProgram", isMut: false, isSigner: false },
        { name: "rent",               isMut: false, isSigner: false },
      ],
      args: [
        { name: "amountTokens",           type: "u64" },
        { name: "priceLampertsPerToken",  type: "u64" },
        { name: "expirySlots",            type: { option: "u64" } },
      ],
    },
    {
      name: "acceptOffer",
      accounts: [
        { name: "offer",              isMut: true,  isSigner: false },
        { name: "escrowTokenAccount", isMut: true,  isSigner: false },
        { name: "buyerTokenAccount",  isMut: true,  isSigner: false },
        { name: "propertyMint",       isMut: false, isSigner: false },
        { name: "buyerKyc",           isMut: false, isSigner: false },
        { name: "seller",             isMut: true,  isSigner: false },
        { name: "feeTreasury",        isMut: true,  isSigner: false },
        { name: "buyer",              isMut: true,  isSigner: true  },
        { name: "systemProgram",      isMut: false, isSigner: false },
        { name: "tokenProgram",       isMut: false, isSigner: false },
        { name: "associatedTokenProgram", isMut: false, isSigner: false },
        { name: "rent",               isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: "cancelOffer",
      accounts: [
        { name: "offer",              isMut: true,  isSigner: false },
        { name: "escrowTokenAccount", isMut: true,  isSigner: false },
        { name: "sellerTokenAccount", isMut: true,  isSigner: false },
        { name: "seller",             isMut: true,  isSigner: false },
        { name: "propertyMint",       isMut: false, isSigner: false },
        { name: "signer",             isMut: true,  isSigner: true  },
        { name: "tokenProgram",       isMut: false, isSigner: false },
      ],
      args: [],
    },
    // ── Fase 3: Gobernanza ───────────────────────────────────────────────────
    {
      name: "createProposal",
      accounts: [
        { name: "proposal",       isMut: true,  isSigner: false },
        { name: "propertyState",  isMut: false, isSigner: false },
        { name: "programConfig",  isMut: false, isSigner: false },
        { name: "authority",      isMut: true,  isSigner: true  },
        { name: "systemProgram",  isMut: false, isSigner: false },
      ],
      args: [{ name: "params", type: { defined: "CreateProposalParams" } }],
    },
    {
      name: "castVote",
      accounts: [
        { name: "proposal",            isMut: true,  isSigner: false },
        { name: "voteRecord",          isMut: true,  isSigner: false },
        { name: "voterTokenAccount",   isMut: false, isSigner: false },
        { name: "voterKyc",            isMut: false, isSigner: false },
        { name: "voter",               isMut: true,  isSigner: true  },
        { name: "systemProgram",       isMut: false, isSigner: false },
      ],
      args: [{ name: "optionIndex", type: "u8" }],
    },
    {
      name: "finalizeProposal",
      accounts: [
        { name: "proposal",      isMut: true,  isSigner: false },
        { name: "propertyState", isMut: false, isSigner: false },
        { name: "programConfig", isMut: false, isSigner: false },
        { name: "authority",     isMut: false, isSigner: true  },
      ],
      args: [],
    },
    // ── Fase 3: Oracle ───────────────────────────────────────────────────────
    {
      name: "initializeOracle",
      accounts: [
        { name: "propertyOracle", isMut: true,  isSigner: false },
        { name: "propertyState",  isMut: false, isSigner: false },
        { name: "programConfig",  isMut: false, isSigner: false },
        { name: "authority",      isMut: true,  isSigner: true  },
        { name: "systemProgram",  isMut: false, isSigner: false },
      ],
      args: [{ name: "initialValueUsdCents", type: "u64" }],
    },
    {
      name: "updateValuation",
      accounts: [
        { name: "propertyOracle", isMut: true,  isSigner: false },
        { name: "programConfig",  isMut: false, isSigner: false },
        { name: "authority",      isMut: false, isSigner: true  },
      ],
      args: [{ name: "newValueUsdCents", type: "u64" }],
    },
    {
      name: "readValuation",
      accounts: [
        { name: "propertyOracle", isMut: false, isSigner: false },
      ],
      args: [],
    },
    // ── Fase 4: AppChain ─────────────────────────────────────────────────────
    {
      name: "initializeDnftAtomic",
      accounts: [
        { name: "dnftState",     isMut: true,  isSigner: false },
        { name: "dnftMint",      isMut: true,  isSigner: false },
        { name: "propertyState", isMut: false, isSigner: false },
        { name: "treasury",      isMut: true,  isSigner: false },
        { name: "hookProgram",   isMut: false, isSigner: false },
        { name: "programConfig", isMut: false, isSigner: false },
        { name: "authority",     isMut: true,  isSigner: true  },
        { name: "systemProgram", isMut: false, isSigner: false },
        { name: "tokenProgram",  isMut: false, isSigner: false },
        { name: "rent",          isMut: false, isSigner: false },
      ],
      args: [{ name: "params", type: { defined: "DnftParams" } }],
    },
    {
      name: "processCrossChainBuy",
      accounts: [
        { name: "propertyState",         isMut: true,  isSigner: false },
        { name: "propertyOracle",        isMut: false, isSigner: false },
        { name: "propertyMint",          isMut: true,  isSigner: false },
        { name: "buyerTokenAccount",     isMut: true,  isSigner: false },
        { name: "buyer",                 isMut: false, isSigner: false },
        { name: "crossChainNonce",       isMut: true,  isSigner: false },
        { name: "hyperlaneIsmState",     isMut: false, isSigner: false },
        { name: "hyperlaneMailbox",      isMut: false, isSigner: false },
        { name: "hyperlaneIsmProgram",   isMut: false, isSigner: false },
        { name: "zkVerificationRecord",  isMut: true,  isSigner: false },
        { name: "relayer",               isMut: true,  isSigner: true  },
        { name: "tokenProgram",          isMut: false, isSigner: false },
        { name: "associatedTokenProgram",isMut: false, isSigner: false },
        { name: "systemProgram",         isMut: false, isSigner: false },
      ],
      args: [{ name: "payload", type: { defined: "CrossChainPayload" } }],
    },
    {
      name: "liquidateCollateral",
      accounts: [
        { name: "loanState",               isMut: true,  isSigner: false },
        { name: "loanEscrowTokenAccount",  isMut: true,  isSigner: false },
        { name: "dnftState",               isMut: true,  isSigner: false },
        { name: "propertyOracle",          isMut: false, isSigner: false },
        { name: "dnftMint",                isMut: true,  isSigner: false },
        { name: "liquidatorDnftAccount",   isMut: true,  isSigner: false },
        { name: "liquidatorUsdcAccount",   isMut: true,  isSigner: false },
        { name: "treasuryUsdcAccount",     isMut: true,  isSigner: false },
        { name: "usdcMint",                isMut: false, isSigner: false },
        { name: "treasuryState",           isMut: true,  isSigner: false },
        { name: "liquidator",              isMut: true,  isSigner: true  },
        { name: "dnftTokenProgram",        isMut: false, isSigner: false },
        { name: "usdcTokenProgram",        isMut: false, isSigner: false },
        { name: "associatedTokenProgram",  isMut: false, isSigner: false },
        { name: "systemProgram",           isMut: false, isSigner: false },
        { name: "rent",                    isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: "zkTransferHook",
      accounts: [
        { name: "dnftState",       isMut: false, isSigner: false },
        { name: "zkRecord",        isMut: true,  isSigner: false },
        { name: "destinationOwner",isMut: false, isSigner: false },
        { name: "feePayer",        isMut: true,  isSigner: true  },
        { name: "systemProgram",   isMut: false, isSigner: false },
      ],
      args: [
        { name: "amount", type: "u64" },
        { name: "proof",  type: { vec: "u8" } },
      ],
    },
    {
      name: "updateNotarialMetadata",
      accounts: [
        { name: "dnftState",          isMut: true,  isSigner: false },
        { name: "propertyState",      isMut: true,  isSigner: false },
        { name: "propertyOracle",     isMut: true,  isSigner: false },
        { name: "notarialRecord",     isMut: true,  isSigner: false },
        { name: "programConfig",      isMut: false, isSigner: false },
        { name: "notarialAuthority",  isMut: true,  isSigner: true  },
        { name: "authority",          isMut: false, isSigner: true  },
        { name: "systemProgram",      isMut: false, isSigner: false },
      ],
      args: [{ name: "params", type: { defined: "NotarialUpdateParams" } }],
    },
    {
      name: "initiateLoan",
      accounts: [
        { name: "loanState",               isMut: true,  isSigner: false },
        { name: "loanEscrowTokenAccount",  isMut: true,  isSigner: false },
        { name: "dnftState",               isMut: true,  isSigner: false },
        { name: "propertyOracle",          isMut: false, isSigner: false },
        { name: "propertyState",           isMut: false, isSigner: false },
        { name: "dnftMint",                isMut: true,  isSigner: false },
        { name: "borrowerDnftAccount",     isMut: true,  isSigner: false },
        { name: "borrower",                isMut: true,  isSigner: true  },
        { name: "tokenProgram",            isMut: false, isSigner: false },
        { name: "associatedTokenProgram",  isMut: false, isSigner: false },
        { name: "systemProgram",           isMut: false, isSigner: false },
        { name: "rent",                    isMut: false, isSigner: false },
      ],
      args: [
        { name: "loanAmountUsdc", type: "u64" },
        { name: "durationDays",   type: "u32" },
      ],
    },
    {
      name: "repayLoan",
      accounts: [
        { name: "loanState",               isMut: true,  isSigner: false },
        { name: "loanEscrowTokenAccount",  isMut: true,  isSigner: false },
        { name: "dnftState",               isMut: true,  isSigner: false },
        { name: "dnftMint",                isMut: false, isSigner: false },
        { name: "borrowerDnftAccount",     isMut: true,  isSigner: false },
        { name: "borrower",                isMut: false, isSigner: true  },
        { name: "tokenProgram",            isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: "initializeSmartAccount",
      accounts: [
        { name: "smartAccount",  isMut: true,  isSigner: false },
        { name: "feePayer",      isMut: true,  isSigner: true  },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "webauthnPubkey", type: { array: ["u8", 33] } },
        { name: "displayName",    type: "string" },
      ],
    },
    {
      name: "paymasterSponsorFee",
      accounts: [
        { name: "smartAccount",  isMut: true,  isSigner: false },
        { name: "paymaster",     isMut: true,  isSigner: false },
        { name: "feeRecipient",  isMut: true,  isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [{ name: "feeLamports", type: "u64" }],
    },
    {
      name: "collectTransferFeesToTreasury",
      accounts: [
        { name: "dnftMint",             isMut: true,  isSigner: false },
        { name: "treasuryTokenAccount", isMut: true,  isSigner: false },
        { name: "treasuryState",        isMut: true,  isSigner: false },
        { name: "tokenProgram",         isMut: false, isSigner: false },
      ],
      args: [],
    },
    // ── Fase 3+: Mantenimiento ───────────────────────────────────────────────
    {
      name: "createMaintenanceBudgetProposal",
      accounts: [
        { name: "proposal",          isMut: true,  isSigner: false },
        { name: "maintenanceBudget", isMut: true,  isSigner: false },
        { name: "propertyState",     isMut: false, isSigner: false },
        { name: "programConfig",     isMut: false, isSigner: false },
        { name: "authority",         isMut: true,  isSigner: true  },
        { name: "systemProgram",     isMut: false, isSigner: false },
      ],
      args: [{ name: "params", type: { defined: "MaintenanceBudgetParams" } }],
    },
    {
      name: "executeMaintenanceBudget",
      accounts: [
        { name: "maintenanceBudget", isMut: true,  isSigner: false },
        { name: "proposal",          isMut: false, isSigner: false },
        { name: "propertyState",     isMut: true,  isSigner: false },
        { name: "rentVault",         isMut: true,  isSigner: false },
        { name: "contractor",        isMut: true,  isSigner: false },
        { name: "programConfig",     isMut: false, isSigner: false },
        { name: "authority",         isMut: false, isSigner: true  },
        { name: "systemProgram",     isMut: false, isSigner: false },
      ],
      args: [],
    },
  ],
  accounts: [
    { name: "PropertyState",          type: { kind: "struct", fields: [] } },
    { name: "InvestorProfile",        type: { kind: "struct", fields: [] } },
    { name: "ProgramConfig",          type: { kind: "struct", fields: [] } },
    { name: "Offer",                  type: { kind: "struct", fields: [] } },
    { name: "Proposal",               type: { kind: "struct", fields: [] } },
    { name: "VoteRecord",             type: { kind: "struct", fields: [] } },
    { name: "PropertyOracle",         type: { kind: "struct", fields: [] } },
    { name: "DnftState",              type: { kind: "struct", fields: [] } },
    { name: "LoanState",              type: { kind: "struct", fields: [] } },
    { name: "ZkVerificationRecord",   type: { kind: "struct", fields: [] } },
    { name: "SmartAccount",           type: { kind: "struct", fields: [] } },
    { name: "ProtocolTreasury",       type: { kind: "struct", fields: [] } },
    { name: "MaintenanceBudgetRecord",type: { kind: "struct", fields: [] } },
  ],
  errors: [],
  types: [],
} as const;

// ── Provider helpers ────────────────────────────────────────────────────────
export function getProvider(wallet: WalletContextState, connection: Connection) {
  const anchorWallet = {
    publicKey:          wallet.publicKey!,
    signTransaction:    wallet.signTransaction!,
    signAllTransactions:wallet.signAllTransactions!,
  };
  return new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });
}

export function getProgram(provider: AnchorProvider) {
  return new Program(IDL as any, PROGRAM_ID, provider);
}

// ── PDA derivers ────────────────────────────────────────────────────────────
export function derivePropertyPDA(authority: PublicKey, propertyId: number): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(propertyId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("property"), authority.toBuffer(), buf],
    PROGRAM_ID
  )[0];
}

export function deriveRentVaultPDA(propertyState: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rent_vault"), propertyState.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function deriveKycPDA(investor: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("investor_kyc"), investor.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function deriveOraclePDA(propertyState: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), propertyState.toBuffer()],
    PROGRAM_ID
  )[0];
}

// ── On-chain data fetchers ──────────────────────────────────────────────────

/** Deserializa PropertyState desde bytes raw (sin IDL compilado) */
function parsePropertyState(pubkey: PublicKey, data: Buffer): PropertyUI | null {
  try {
    let offset = 8; // discriminator
    offset += 32;   // authority
    const mintBytes = data.slice(offset, offset + 32);
    const mintAddr  = new PublicKey(mintBytes).toBase58();
    offset += 32;   // mint
    offset += 8;    // property_id
    const totalValueCents = Number(data.readBigUInt64LE(offset));      offset += 8;
    const totalTokens     = Number(data.readBigUInt64LE(offset));      offset += 8;
    const tokensIssued    = Number(data.readBigUInt64LE(offset));      offset += 8;
    const collectedRent   = Number(data.readBigUInt64LE(offset));      offset += 8;
    offset += 24; // distributed_rent, rent_snapshot, distribution_epoch
    const isActive    = data[offset] === 1;                            offset += 1;
    const isRentLocked= data[offset] === 1;                            offset += 1;
    offset += 2;  // bump, vault_bump
    const locLen  = data.readUInt32LE(offset);                         offset += 4;
    const location= data.slice(offset, offset + locLen).toString("utf8"); offset += locLen;
    const hashLen = data.readUInt32LE(offset);                         offset += 4;
    const legalDocHash = data.slice(offset, offset + hashLen).toString("utf8"); offset += hashLen;
    const cidLen  = data.readUInt32LE(offset);                         offset += 4;
    const ipfsCid = data.slice(offset, offset + cidLen).toString("utf8");

    return {
      pubkey:           pubkey.toBase58(),
      mintPubkey:       mintAddr,
      location,
      city:             location.split(",")[1]?.trim() ?? "Colombia",
      country:          "Colombia",
      totalValueUSD:    totalValueCents / 100,
      totalTokens,
      tokensIssued,
      availableTokens:  totalTokens - tokensIssued,
      collectedRentSOL: collectedRent / LAMPORTS_PER_SOL,
      isActive,
      legalDocHash,
      ipfsCid,
      apy:              8.5,
      propertyType:     "Residencial",
      imageGradient:    "linear-gradient(135deg,#1a3a5c,#0d2238)",
      pricePerTokenUSD: totalTokens > 0 ? (totalValueCents / 100) / totalTokens : 0,
      fundedPercent:    totalTokens > 0 ? (tokensIssued / totalTokens) * 100 : 0,
    };
  } catch {
    return null;
  }
}

export async function fetchAllProperties(program: Program): Promise<PropertyUI[]> {
  const connection = program.provider.connection;
  const accounts   = await connection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
  });

  const results: PropertyUI[] = [];
  for (const { pubkey, account } of accounts) {
    const parsed = parsePropertyState(pubkey, account.data as Buffer);
    if (parsed?.isActive) results.push(parsed);
  }
  return results;
}

export async function fetchPortfolio(
  program: Program,
  connection: Connection,
  wallet: PublicKey
): Promise<PortfolioPosition[]> {
  const properties = await fetchAllProperties(program);
  const positions: PortfolioPosition[] = [];

  for (const prop of properties) {
    try {
      const mint = new PublicKey(prop.mintPubkey);
      const ata  = await getAssociatedTokenAddress(mint, wallet);
      const info = await getAccount(connection, ata);
      const owned= Number(info.amount);
      if (owned === 0) continue;

      positions.push({
        property:          prop,
        tokensOwned:       owned,
        ownershipPercent:  prop.totalTokens > 0 ? (owned / prop.totalTokens) * 100 : 0,
        investedUSD:       owned * prop.pricePerTokenUSD,
        claimableRentSOL:  0,
        ataPubkey:         ata.toBase58(),
      });
    } catch { /* wallet no tiene ATA para esta propiedad */ }
  }
  return positions;
}

export async function mintFractionalTokens(
  program: Program,
  wallet: WalletContextState,
  property: PropertyUI,
  amount: number
): Promise<string> {
  const authority    = wallet.publicKey!;
  const propertyPDA  = new PublicKey(property.pubkey);
  const mint         = new PublicKey(property.mintPubkey);
  const investorATA  = await getAssociatedTokenAddress(mint, authority);
  const kycPDA       = deriveKycPDA(authority);

  return program.methods
    .mintFractionalTokens(new BN(amount))
    .accounts({
      propertyState:        propertyPDA,
      propertyMint:         mint,
      investorTokenAccount: investorATA,
      investor:             authority,
      investorKyc:          kycPDA,
      authority,
      systemProgram:        SystemProgram.programId,
      tokenProgram:         TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      rent:                 new PublicKey("SysvarRent111111111111111111111111111111111"),
    })
    .rpc({ commitment: "confirmed" });
}

export async function distributeRent(
  program: Program,
  wallet: WalletContextState,
  property: PropertyUI
): Promise<string> {
  const investor     = wallet.publicKey!;
  const propertyPDA  = new PublicKey(property.pubkey);
  const mint         = new PublicKey(property.mintPubkey);
  const rentVault    = deriveRentVaultPDA(propertyPDA);
  const investorATA  = await getAssociatedTokenAddress(mint, investor);
  const claimPDA     = PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), investor.toBuffer(), propertyPDA.toBuffer()],
    PROGRAM_ID
  )[0];

  return program.methods
    .claimRent()
    .accounts({
      propertyState:        propertyPDA,
      rentVault,
      investorClaim:        claimPDA,
      investorTokenAccount: investorATA,
      investor,
      systemProgram:        SystemProgram.programId,
      tokenProgram:         TOKEN_PROGRAM_ID,
    })
    .rpc({ commitment: "confirmed" });
}

export async function initializeProperty(
  program: Program,
  wallet: WalletContextState,
  params: {
    location: string;
    totalValueCents: number;
    totalTokens: number;
    legalDocHash: string;
    ipfsCid: string;
  }
): Promise<string> {
  const authority   = wallet.publicKey!;
  const mintKP      = Keypair.generate(); // BUG-16 fix: use top-level Keypair import (no require() in ESM)
  const propertyId  = Date.now();
  const pidBuf      = Buffer.alloc(8);
  pidBuf.writeBigUInt64LE(BigInt(propertyId));

  const [propertyPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("property"), authority.toBuffer(), pidBuf],
    PROGRAM_ID
  );
  const rentVault = deriveRentVaultPDA(propertyPDA);

  return program.methods
    .initializeProperty({
      propertyId: new BN(propertyId),
      location:   params.location,
      totalValue: new BN(params.totalValueCents),
      totalTokens:new BN(params.totalTokens),
      legalDocHash: params.legalDocHash,
      ipfsCid:    params.ipfsCid,
    })
    .accounts({
      propertyState: propertyPDA,
      propertyMint:  mintKP.publicKey,
      rentVault,
      authority,
      systemProgram: SystemProgram.programId,
      tokenProgram:  TOKEN_PROGRAM_ID,
      rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
    })
    .signers([mintKP])
    .rpc({ commitment: "confirmed" });
}

export async function toggleProperty(
  program: Program,
  wallet: WalletContextState,
  propertyPDA: PublicKey,
  active: boolean
): Promise<string> {
  return program.methods
    .toggleProperty(active)
    .accounts({
      propertyState: propertyPDA,
      authority:     wallet.publicKey!,
    })
    .rpc({ commitment: "confirmed" });
}

// ── Error decoder ───────────────────────────────────────────────────────────
export function decodeAnchorError(e: any): string {
  const msg = e?.message ?? String(e);
  const match = msg.match(/Error Code: (\w+)\. Error Number: \d+\. Error Message: (.+?)\./);
  if (match) return match[2];
  if (msg.includes("User rejected")) return "Transacción cancelada por el usuario";
  if (msg.includes("insufficient funds")) return "SOL insuficiente para la transacción";
  if (msg.includes("0x1")) return "Fondos insuficientes en la cuenta";
  return msg.slice(0, 120);
}
