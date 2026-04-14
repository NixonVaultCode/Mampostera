"use client";
/**
 * v2/hooks/use-proof-of-reserve.ts
 *
 * R8: Hook para leer y registrar el Proof of Reserve de una propiedad.
 *
 * useProofOfReserve(propertyPubkey) — lee el PDA on-chain en tiempo real
 * useRegisterPoR() — mutación para la authority (registrar certificado)
 * useVerifyPoR() — verifica el hash del PDF contra el PDA
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey }              from "@solana/web3.js";
import { useToastPush }           from "../store/app.store";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface PorData {
  propertyPubkey:   string;
  certificateHash:  string;       // hex de 64 chars
  arweaveCid:       string;
  escrituraRef:     string;
  matriculaRef:     string;
  notariaRef:       string;
  sasNit:           string;
  certificateDate:  Date;
  registeredAt:     Date;
  renewalCount:     number;
  isValid:          boolean;
  isExpired:        boolean;      // > 6 meses
  ageMonths:        number;
}

export interface PorVerificationResult {
  verified:         boolean;
  hashMatch:        boolean;
  storedHash:       string;
  computedHash:     string;
  message:          string;
}

// ── Hook: leer PoR de una propiedad ──────────────────────────────────────────

export function useProofOfReserve(propertyPubkey: string | null) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ["por", propertyPubkey],
    queryFn:  async (): Promise<PorData | null> => {
      if (!propertyPubkey) return null;

      // Derivar el PDA del PoR — seeds: [b"proof_of_reserve", property_pubkey]
      const PROGRAM_ID = new PublicKey(
        process.env.NEXT_PUBLIC_PROGRAM_ID ?? "MAMPoSTERAv2222222222222222222222222222222"
      );
      const [porPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("proof_of_reserve"), new PublicKey(propertyPubkey).toBuffer()],
        PROGRAM_ID
      );

      const accountInfo = await connection.getAccountInfo(porPda);
      if (!accountInfo) return null;

      // Deserializar el PDA usando el layout de Anchor (8 bytes discriminator + datos)
      const data = accountInfo.data;
      if (data.length < 8 + 32 + 32) return null;

      // Saltar discriminator (8 bytes) + property pubkey (32 bytes)
      let offset = 8 + 32;

      // certificate_hash: [u8; 32]
      const hashBytes = data.slice(offset, offset + 32);
      const hashHex   = Buffer.from(hashBytes).toString("hex");
      offset += 32;

      // arweave_cid: String (4 bytes length + chars)
      const cidLen    = data.readUInt32LE(offset); offset += 4;
      const arweaveCid = data.slice(offset, offset + cidLen).toString("utf8"); offset += cidLen;

      // escritura_ref
      const escritLen = data.readUInt32LE(offset); offset += 4;
      const escrituraRef = data.slice(offset, offset + escritLen).toString("utf8"); offset += escritLen;

      // matricula_ref
      const matLen    = data.readUInt32LE(offset); offset += 4;
      const matriculaRef = data.slice(offset, offset + matLen).toString("utf8"); offset += matLen;

      // notaria_ref
      const notLen    = data.readUInt32LE(offset); offset += 4;
      const notariaRef = data.slice(offset, offset + notLen).toString("utf8"); offset += notLen;

      // sas_nit
      const nitLen    = data.readUInt32LE(offset); offset += 4;
      const sasNit    = data.slice(offset, offset + nitLen).toString("utf8"); offset += nitLen;

      // certificate_date (i64 LE)
      const certDateSecs  = Number(data.readBigInt64LE(offset)); offset += 8;
      // registered_at (i64 LE)
      const registeredSecs = Number(data.readBigInt64LE(offset)); offset += 8;
      // renewal_count (u32 LE)
      const renewalCount  = data.readUInt32LE(offset); offset += 4;
      // is_valid (bool)
      const isValid       = data[offset] === 1;

      const registeredAt  = new Date(registeredSecs * 1000);
      const ageMs         = Date.now() - registeredAt.getTime();
      const ageMonths     = ageMs / (1000 * 60 * 60 * 24 * 30);
      const SIX_MONTHS    = 6 * 30 * 24 * 3600 * 1000;

      return {
        propertyPubkey,
        certificateHash: hashHex,
        arweaveCid,
        escrituraRef,
        matriculaRef,
        notariaRef,
        sasNit,
        certificateDate:  new Date(certDateSecs * 1000),
        registeredAt,
        renewalCount,
        isValid,
        isExpired:  ageMs > SIX_MONTHS,
        ageMonths:  Math.floor(ageMonths),
      };
    },
    enabled:         !!propertyPubkey,
    staleTime:       0,          // Invalidado por Helius webhook
    refetchInterval: 30_000,
    retry:           1,
  });
}

// ── Hook: verificar PDF contra hash on-chain ─────────────────────────────────

export function useVerifyPoR() {
  return useMutation({
    mutationFn: async ({
      file,
      storedHash,
    }: {
      file:       File;
      storedHash: string;
    }): Promise<PorVerificationResult> => {
      const arrayBuf     = await file.arrayBuffer();
      const hashBuf      = await globalThis.crypto.subtle.digest("SHA-256", arrayBuf);
      const computedHash = Buffer.from(hashBuf).toString("hex");
      const hashMatch    = computedHash === storedHash.toLowerCase();

      return {
        verified:     hashMatch,
        hashMatch,
        storedHash:   storedHash.toLowerCase(),
        computedHash,
        message: hashMatch
          ? "Certificado auténtico — el hash coincide con el registro on-chain"
          : "Certificado NO verificado — el hash no coincide. El documento puede haber sido alterado.",
      };
    },
  });
}

// ── Hook: registrar PoR (authority only) ─────────────────────────────────────

export function useRegisterPoR() {
  const push = useToastPush();

  return useMutation({
    mutationFn: async (params: {
      propertyId:      string;
      certificateFile: File;
      arweaveCid:      string;
      escrituraRef:    string;
      matriculaRef:    string;
      notariaRef:      string;
      sasNit:          string;
    }) => {
      // 1. Calcular hash SHA-256 del PDF
      const buf  = await params.certificateFile.arrayBuffer();
      const hash = await globalThis.crypto.subtle.digest("SHA-256", buf);
      const hashHex = Buffer.from(hash).toString("hex");

      // 2. Llamar al API route que ejecuta la instrucción on-chain
      const res = await fetch("/api/por/register", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...params, certificateHash: hashHex }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? `Error ${res.status}`);
      }
      return { ...await res.json() as Record<string, unknown>, certificateHash: hashHex };
    },
    onSuccess: () => push("Proof of Reserve registrado on-chain", "success"),
    onError:   (e) => push(e instanceof Error ? e.message : "Error", "error"),
  });
}
