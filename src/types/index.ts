import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

// ── On-chain account shape (matches lib.rs PropertyState) ─────
export interface PropertyStateAccount {
  authority: PublicKey;
  mint: PublicKey;
  location: string;
  totalValue: BN;       // USD cents
  totalTokens: BN;
  tokensIssued: BN;
  collectedRent: BN;    // lamports
  legalDocHash: string; // 64-char SHA-256 hex
  ipfsCid: string;
  isActive: boolean;
  bump: number;
}

// ── Enriched UI model ─────────────────────────────────────────
export interface PropertyUI {
  pubkey: string;
  mintPubkey: string;
  location: string;
  city: string;
  country: string;
  totalValueUSD: number;    // human dollars
  totalTokens: number;
  tokensIssued: number;
  availableTokens: number;
  collectedRentSOL: number;
  isActive: boolean;
  legalDocHash: string;
  ipfsCid: string;
  apy: number;
  propertyType: string;
  imageGradient: string;
  pricePerTokenUSD: number;
  fundedPercent: number;
}

// ── Investor portfolio position ───────────────────────────────
export interface PortfolioPosition {
  property: PropertyUI;
  tokensOwned: number;
  ownershipPercent: number;
  investedUSD: number;
  claimableRentSOL: number;
  ataPubkey: string;
}

// ── KYC status ────────────────────────────────────────────────
export type KYCStatus = "unchecked" | "pending" | "verified" | "failed" | "expired";

export interface KYCState {
  status: KYCStatus;
  gatewayToken?: string;
  expiresAt?: Date;
  network: "civic" | "none";
}

// ── Admin forms ───────────────────────────────────────────────
export interface NewPropertyForm {
  location: string;
  city: string;
  country: string;
  totalValueUSD: number;
  totalTokens: number;
  legalDocHash: string;
  ipfsCid: string;
  apy: number;
  propertyType: string;
}

// ── Analytics ────────────────────────────────────────────────
export interface AnalyticsSummary {
  totalValueLocked: number;    // USD
  totalInvestors: number;
  totalProperties: number;
  totalRentDistributed: number; // SOL
  avgAPY: number;
  volumeLast30d: number;        // USD
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

// ── AppChain Fase 4 — KYC status para useMampostera (RPC directo) ─────────────
// Usado por hooks de Fase 4 que leen el KYC PDA sin pasar por program.ts
export interface KycStatusUI {
  status: "unregistered" | "pending" | "approved" | "revoked";
  label:  string;
  color:  string;
}

// ── Toast type (re-export para que AdminPanel pueda importar desde types) ─────
export type ToastType = "success" | "error" | "loading" | "info";
