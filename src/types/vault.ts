/**
 * types/vault.ts
 * Tipos compartidos para los módulos periféricos:
 *   - mampostera_vault (programa Anchor)
 *   - GovernanceVoting (componente React)
 */

import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

// ─────────────────────────────────────────────────────────────────────────────
// VAULT: On-chain account shapes (espejo de lib.rs)
// ─────────────────────────────────────────────────────────────────────────────

/** Espejo de VaultConfig en mampostera_vault/src/lib.rs */
export interface VaultConfigAccount {
  admin:            PublicKey;
  mampMint:         PublicKey;
  legalEntityHash:  string;    // SHA-256 hex del acta SAS (64 chars)
  annualYieldBps:   number;    // u16
  totalLocked:      BN;        // u64
  isActive:         boolean;
  bump:             number;
  createdAt:        BN;        // i64 unix timestamp
}

/** Espejo de DepositReceipt en mampostera_vault/src/lib.rs */
export interface DepositReceiptAccount {
  holder:          PublicKey;
  vaultConfig:     PublicKey;
  mampMint:        PublicKey;
  amountLocked:    BN;         // u64
  lockedAt:        BN;         // i64
  unlockAt:        BN;         // i64
  annualYieldBps:  number;     // u16
  isClaimed:       boolean;
  bump:            number;
}

// ─────────────────────────────────────────────────────────────────────────────
// VAULT: Parámetros de instrucciones
// ─────────────────────────────────────────────────────────────────────────────

export interface LockTokensParams {
  amount:           BN;        // u64 — tokens MAMP a bloquear
  lockDurationSecs: BN;        // i64 — duración en segundos
}

export interface VaultConfigParams {
  legalEntityHash: string;     // SHA-256 del acta SAS
  annualYieldBps:  number;     // 100 = 1%, 500 = 5%
}

// ─────────────────────────────────────────────────────────────────────────────
// VAULT: PDA derivation helpers
// ─────────────────────────────────────────────────────────────────────────────

export const VAULT_PDA_SEEDS = {
  vaultConfig:    "vault_config",
  depositReceipt: "receipt",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// VAULT: Eventos on-chain (espejo de lib.rs)
// ─────────────────────────────────────────────────────────────────────────────

export interface VaultConfiguredEvent {
  admin:            PublicKey;
  mampMint:         PublicKey;
  legalEntityHash:  string;
  annualYieldBps:   number;
}

export interface TokensLockedEvent {
  holder:   PublicKey;
  receipt:  PublicKey;
  amount:   BN;
  unlockAt: BN;
}

export interface TokensUnlockedEvent {
  holder:      PublicKey;
  receipt:     PublicKey;
  principal:   BN;
  interest:    BN;
  totalPayout: BN;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOVERNANCE: Tipos del módulo de votación
// ─────────────────────────────────────────────────────────────────────────────

export type VoteChoice = "YES" | "NO" | "ABSTAIN";

/** Propuesta de gobernanza (almacenada off-chain / IPFS / backend) */
export interface Proposal {
  id:           string;   // UUID o hash SHA-256
  title:        string;
  description:  string;
  propertyMint: string;   // PublicKey — solo holders de este mint pueden votar
  endsAt:       Date;
  quorumTokens: number;   // Tokens mínimos para que el resultado sea válido
  createdBy:    string;   // PublicKey del admin/authority
  options?:     string[]; // Opciones adicionales (por defecto: YES/NO/ABSTAIN)
}

/** Voto emitido y firmado criptográficamente */
export interface CastVote {
  proposalId:    string;
  voter:         string;        // PublicKey
  choice:        VoteChoice;
  tokenBalance:  number;        // Balance MAMP/property token al momento del voto
  signature:     string;        // Base58 de la firma Ed25519
  timestamp:     number;        // Date.now()
  message:       string;        // Texto completo que se firmó
}

/** Resumen de resultados de una propuesta */
export interface ProposalResult {
  proposalId:    string;
  yes:           { votes: number; tokens: number };
  no:            { votes: number; tokens: number };
  abstain:       { votes: number; tokens: number };
  totalVotes:    number;
  totalTokens:   number;
  quorumReached: boolean;
  winner?:       VoteChoice;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOVERNANCE: Prerequisitos compartidos
// ─────────────────────────────────────────────────────────────────────────────

/** Estado de prerequisitos para ambos módulos periféricos */
export interface PeripheralPrereqs {
  kycVerified:      boolean;  // Civic gateway token activo
  sasRegistered:    boolean;  // Hash SAS presente en VaultConfig o PropertyState
  walletConnected:  boolean;
  tokenBalance:     number;   // Balance del mint relevante
}

// ─────────────────────────────────────────────────────────────────────────────
// VAULT: UI helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface DepositReceiptUI {
  pda:            string;
  amountLocked:   number;
  lockedAt:       Date;
  unlockAt:       Date;
  yieldBps:       number;
  isClaimed:      boolean;
  estimatedYield: number;
  progressPct:    number;    // 0–100
  isReady:        boolean;   // unlock_at <= now
}

export type VaultTab = "lock" | "receipts";
