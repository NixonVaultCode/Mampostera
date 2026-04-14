"use client";
/**
 * v2/hooks/use-mamp.ts
 *
 * R10: Hook para staking de MAMP y cálculo de veMAMP.
 * Lee el VeStake PDA del usuario + ProtocolFeePool on-chain.
 * Expone: stake, unstake, claimFees, currentVeMamp, pendingUsdc.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet, useConnection }               from "@solana/wallet-adapter-react";
import { PublicKey }                              from "@solana/web3.js";
import { useToastPush }                           from "../store/app.store";

// ── Constantes (deben coincidir con el programa Rust) ─────────────────────────
const MAX_LOCK_SECS = 4 * 365 * 24 * 3600;                // 4 años
const MIN_LOCK_SECS = 7 * 24 * 3600;                      // 1 semana
const MAMP_DECIMALS = 6;

// ── Opciones de lock predefinidas ─────────────────────────────────────────────
export const LOCK_OPTIONS = [
  { label: "1 mes",   secs: 30  * 24 * 3600, multiplier: 0.02  },
  { label: "3 meses", secs: 90  * 24 * 3600, multiplier: 0.06  },
  { label: "6 meses", secs: 180 * 24 * 3600, multiplier: 0.12  },
  { label: "1 año",   secs: 365 * 24 * 3600, multiplier: 0.25  },
  { label: "2 años",  secs: 730 * 24 * 3600, multiplier: 0.50  },
  { label: "4 años",  secs: 4 * 365 * 24 * 3600, multiplier: 1.0 },
] as const;

// ── Tipos ─────────────────────────────────────────────────────────────────────
export interface VeStakeData {
  mampAmount:     number;   // MAMP bloqueado (con decimales)
  veMampInitial:  number;   // veMAMP al momento del stake
  veMampCurrent:  number;   // veMAMP actual (decayendo)
  lockedAt:       Date;
  unlockAt:       Date;
  lockSecs:       number;
  pendingUsdc:    number;
  totalClaimed:   number;
  lastFeeEpoch:   number;
  isExpired:      boolean;
  daysRemaining:  number;
}

export interface FeePoolData {
  totalVeMamp:       number;
  pendingUsdc:       number;
  totalDistributed:  number;
  currentEpoch:      number;
  usdcPerVeMampX9:   number;
  estimatedApy:      number;  // % calculado en el hook
}

// ── Hook: leer VeStake PDA del usuario ───────────────────────────────────────
export function useVeStake() {
  const { publicKey }  = useWallet();
  const { connection } = useConnection();

  return useQuery({
    queryKey: ["ve_stake", publicKey?.toBase58()],
    queryFn:  async (): Promise<VeStakeData | null> => {
      if (!publicKey) return null;

      const PROGRAM_ID = new PublicKey(
        process.env.NEXT_PUBLIC_PROGRAM_ID ?? "MAMPoSTERAv2222222222222222222222222222222"
      );
      const [stakePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ve_stake"), publicKey.toBuffer()],
        PROGRAM_ID
      );

      const info = await connection.getAccountInfo(stakePda);
      if (!info || info.data.length < 8 + 32 + 8 * 6 + 8 * 2 + 1) return null;

      const d      = info.data;
      let offset   = 8 + 32; // discriminator + staker pubkey

      const mampAmount    = Number(d.readBigUInt64LE(offset)) / 10 ** MAMP_DECIMALS; offset += 8;
      const veMampInitial = Number(d.readBigUInt64LE(offset)) / 10 ** MAMP_DECIMALS; offset += 8;
      const lockedAt      = Number(d.readBigInt64LE(offset));  offset += 8;
      const unlockAt      = Number(d.readBigInt64LE(offset));  offset += 8;
      const lockSecs      = Number(d.readBigUInt64LE(offset)); offset += 8;
      const pendingUsdc   = Number(d.readBigUInt64LE(offset)) / 1e6; offset += 8;
      const totalClaimed  = Number(d.readBigUInt64LE(offset)) / 1e6; offset += 8;
      const lastFeeEpoch  = Number(d.readBigUInt64LE(offset));

      const now           = Math.floor(Date.now() / 1000);
      const remaining     = Math.max(0, unlockAt - now);
      // veMAMP actual = initial * remaining / MAX_LOCK_SECS
      const veMampCurrent = (veMampInitial * remaining) / MAX_LOCK_SECS;

      return {
        mampAmount,
        veMampInitial,
        veMampCurrent,
        lockedAt:      new Date(lockedAt  * 1000),
        unlockAt:      new Date(unlockAt  * 1000),
        lockSecs,
        pendingUsdc,
        totalClaimed,
        lastFeeEpoch,
        isExpired:     now >= unlockAt,
        daysRemaining: Math.ceil(remaining / 86400),
      };
    },
    enabled:         !!publicKey,
    staleTime:       0,
    refetchInterval: 60_000,
    retry:           1,
  });
}

// ── Hook: leer ProtocolFeePool ────────────────────────────────────────────────
export function useFeePool() {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ["protocol_fee_pool"],
    queryFn:  async (): Promise<FeePoolData | null> => {
      const PROGRAM_ID = new PublicKey(
        process.env.NEXT_PUBLIC_PROGRAM_ID ?? "MAMPoSTERAv2222222222222222222222222222222"
      );
      const [poolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("protocol_fee_pool")],
        PROGRAM_ID
      );

      const info = await connection.getAccountInfo(poolPda);
      if (!info) return null;

      const d    = info.data;
      let offset = 8; // discriminator

      const totalVeMamp      = Number(d.readBigUInt64LE(offset)) / 10 ** MAMP_DECIMALS; offset += 8;
      const pendingUsdc      = Number(d.readBigUInt64LE(offset)) / 1e6;  offset += 8;
      const totalDistributed = Number(d.readBigUInt64LE(offset)) / 1e6;  offset += 8;
      const currentEpoch     = Number(d.readBigUInt64LE(offset));         offset += 8;
      const usdcPerVeMampX9  = Number(d.readBigUInt64LE(offset));

      // APY estimado: (usdcPerVeMampX9 / 1e9) * 52 semanas * 100 / precio_mamp
      // Simplificado asumiendo precio MAMP = $0.05 para el cálculo
      const weeklyReward = usdcPerVeMampX9 / 1e9;
      const estimatedApy = totalVeMamp > 0
        ? Math.round(weeklyReward * 52 * 100 / 0.05 * 100) / 100
        : 0;

      return {
        totalVeMamp, pendingUsdc, totalDistributed,
        currentEpoch, usdcPerVeMampX9, estimatedApy,
      };
    },
    staleTime:       0,
    refetchInterval: 30_000,
  });
}

// ── Utilidades ────────────────────────────────────────────────────────────────

/** Calcula veMAMP para una posición nueva sin stakeear todavía */
export function calcVeMamp(mampAmount: number, lockSecs: number): number {
  if (lockSecs < MIN_LOCK_SECS || lockSecs > MAX_LOCK_SECS) return 0;
  return Math.floor(mampAmount * lockSecs / MAX_LOCK_SECS);
}

/** Formatea MAMP con 2 decimales */
export function formatMamp(amount: number): string {
  return amount.toLocaleString("es-CO", { maximumFractionDigits: 2 });
}

/** Días hasta unlock */
export function daysUntilUnlock(unlockAt: Date): number {
  return Math.max(0, Math.ceil((unlockAt.getTime() - Date.now()) / 86_400_000));
}
