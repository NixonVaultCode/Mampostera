/**
 * services/indexer/helius.service.ts
 *
 * R6: Cliente Helius — indexador de eventos on-chain en tiempo real.
 *
 * Helius es el proveedor RPC premium de Solana con webhooks nativos.
 * Cuando ocurre cualquier instrucción del programa Mampostera, Helius
 * envía el evento a /api/webhooks/helius en < 500ms.
 *
 * Esto reemplaza el polling de 30s del React Query con datos en tiempo real.
 *
 * Documentación: https://docs.helius.dev/webhooks-and-websockets/webhooks
 */

import { getSecret, SecretKey } from "../secrets.service";
import { getDb, getRedis, CacheKeys } from "../../v2/db/client";
import { onchainEvents, properties } from "../../v2/db/schema";
import { eq } from "drizzle-orm";

// ── Tipos de eventos del programa Mampostera ──────────────────────────────────

export type MamposteraEventType =
  | "RentDeposited"
  | "RentClaimed"
  | "TokensMinted"
  | "PropertyInitialized"
  | "PropertyToggled"
  | "OfferCreated"
  | "OfferAccepted"
  | "OfferCancelled"
  | "ValuationUpdated"
  | "KycApproved"
  | "KycRevoked"
  | "LoanInitiated"
  | "LoanRepaid"
  | "LiquidationExecuted"
  | "CrossChainBuyProcessed"
  | "TimelockProposed"
  | "TimelockCancelled";

// Helius Enhanced Transaction — forma del payload que llega al webhook
export interface HeliusTransaction {
  description:    string;
  type:           string;
  source:         string;
  fee:            number;
  feePayer:       string;
  signature:      string;
  slot:           number;
  timestamp:      number;
  tokenTransfers: HeliusTokenTransfer[];
  nativeTransfers: HeliusNativeTransfer[];
  accountData:    HeliusAccountData[];
  transactionError: null | { error: string };
  instructions:   HeliusInstruction[];
  events:         Record<string, unknown>;
}

export interface HeliusTokenTransfer {
  fromUserAccount: string;
  toUserAccount:   string;
  fromTokenAccount: string;
  toTokenAccount:  string;
  tokenAmount:     number;
  mint:            string;
}

export interface HeliusNativeTransfer {
  fromUserAccount: string;
  toUserAccount:   string;
  amount:          number;
}

export interface HeliusAccountData {
  account:        string;
  nativeBalanceDelta: number;
  tokenBalanceChanges: unknown[];
}

export interface HeliusInstruction {
  accounts:   string[];
  data:       string;
  programId:  string;
  innerInstructions: HeliusInstruction[];
}

// ── Eventos parseados de Mampostera ──────────────────────────────────────────

export interface ParsedMamposteraEvent {
  type:       MamposteraEventType;
  signature:  string;
  slot:       number;
  blockTime:  Date;
  propertyPubkey?: string;
  walletAddr?: string;
  amountLamports?: number;
  rawData:    HeliusTransaction;
}

// ── Registro de webhooks en Helius ─────────────────────────────────────────

/**
 * Registra el webhook de Mampostera en Helius API.
 * Llamar una sola vez al hacer deploy del programa en mainnet.
 *
 * Ejemplo de uso:
 *   await registerHellusWebhook("MAMPoSTERAv2222222...")
 */
export async function registerHeliusWebhook(
  programId: string,
  webhookUrl: string
): Promise<{ webhookId: string }> {
  const apiKey = await getSecret(SecretKey.HELIUS_API_KEY);

  const response = await fetch(
    `https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookURL:       webhookUrl,
        transactionTypes: ["ANY"],  // Cualquier tx del programa
        accountAddresses: [programId],
        webhookType:      "enhanced",  // Formato enriquecido con descripción
        authHeader:       await getSecret(SecretKey.HELIUS_WEBHOOK_SECRET),
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`[helius] Error registrando webhook: ${err}`);
  }

  const data = await response.json() as { webhookID: string };
  return { webhookId: data.webhookID };
}

// ── Verificar firma del webhook ─────────────────────────────────────────────

export async function verifyHeliusWebhook(
  authHeader: string
): Promise<boolean> {
  const secret = await getSecret(SecretKey.HELIUS_WEBHOOK_SECRET);
  // Helius usa un header de autorización simple — comparación timing-safe
  const encoder = new TextEncoder();
  const a = encoder.encode(authHeader);
  const b = encoder.encode(secret);
  if (a.length !== b.length) return false;
  // XOR comparison (timing-safe)
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── Parsear evento de Helius → evento Mampostera ──────────────────────────────

export function parseHeliusEvent(tx: HeliusTransaction): ParsedMamposteraEvent | null {
  // Ignorar transacciones fallidas
  if (tx.transactionError) return null;

  const type   = _detectEventType(tx);
  if (!type) return null;

  const walletAddr    = _extractWallet(tx, type);
  const amountLamports = _extractAmount(tx, type);
  const propertyPubkey = _extractPropertyPubkey(tx);

  return {
    type,
    signature:      tx.signature,
    slot:           tx.slot,
    blockTime:      new Date(tx.timestamp * 1000),
    propertyPubkey,
    walletAddr,
    amountLamports,
    rawData:        tx,
  };
}

// ── Persistir evento en DB + invalidar cache Redis ──────────────────────────

export async function persistEvent(event: ParsedMamposteraEvent): Promise<void> {
  const db    = await getDb();
  const redis = getRedis();

  // 1. Buscar el propertyId en la DB a partir del pubkey on-chain
  let dbPropertyId: string | undefined;
  if (event.propertyPubkey) {
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.onchainPubkey, event.propertyPubkey))
      .limit(1);
    dbPropertyId = prop?.id;
  }

  // 2. Insertar en onchain_events (idempotente por la constraint unique en signature)
  await db
    .insert(onchainEvents)
    .values({
      eventType:      event.type,
      signature:      event.signature,
      slot:           event.slot,
      blockTime:      event.blockTime,
      propertyId:     dbPropertyId,
      walletAddr:     event.walletAddr,
      amountLamports: event.amountLamports,
      rawData:        event.rawData as Record<string, unknown>,
    })
    .onConflictDoNothing();  // signature ya indexada → ignorar duplicado

  // 3. Invalidar cache Redis para que React Query obtenga datos frescos
  const keysToInvalidate: string[] = [CacheKeys.properties];

  if (dbPropertyId) {
    keysToInvalidate.push(CacheKeys.property(dbPropertyId));
  }
  if (event.walletAddr) {
    keysToInvalidate.push(CacheKeys.portfolio(event.walletAddr));
  }

  await Promise.allSettled(
    keysToInvalidate.map(key => redis.del(key))
  );

  // 4. Publicar evento en Redis PubSub para Server-Sent Events (SSE)
  // Los clientes conectados reciben el evento en tiempo real sin polling
  await redis.publish(
    "mampostera:events",
    JSON.stringify({
      type:       event.type,
      signature:  event.signature,
      property:   event.propertyPubkey,
      wallet:     event.walletAddr,
      amount:     event.amountLamports,
      timestamp:  event.blockTime.toISOString(),
    })
  ).catch(() => {}); // Non-blocking — SSE es opcional

  console.info(
    `[helius] Evento indexado: ${event.type} · sig ${event.signature.slice(0, 8)}...`
  );
}

// ── Helpers privados ──────────────────────────────────────────────────────────

const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID ?? "MAMPoSTERAv2222222222222222222222222222222";

function _detectEventType(tx: HeliusTransaction): MamposteraEventType | null {
  const desc = tx.description?.toLowerCase() ?? "";
  const prog = tx.instructions.find(i => i.programId === PROGRAM_ID);
  if (!prog) return null;

  // Heurística basada en transferencias y descripción del evento Helius
  if (desc.includes("rent") && tx.nativeTransfers.length > 0) {
    // Distinguir depósito vs claim por dirección del flujo
    const isDeposit = tx.nativeTransfers.some(t => t.toUserAccount.includes("vault"));
    return isDeposit ? "RentDeposited" : "RentClaimed";
  }
  if (tx.tokenTransfers.length > 0) return "TokensMinted";
  if (desc.includes("offer") && desc.includes("created"))  return "OfferCreated";
  if (desc.includes("offer") && desc.includes("accepted")) return "OfferAccepted";
  if (desc.includes("offer") && desc.includes("cancel"))   return "OfferCancelled";
  if (desc.includes("valuation") || desc.includes("oracle")) return "ValuationUpdated";
  if (desc.includes("kyc") && desc.includes("approved"))   return "KycApproved";
  if (desc.includes("loan") && desc.includes("initiat"))   return "LoanInitiated";
  if (desc.includes("loan") && desc.includes("repay"))     return "LoanRepaid";
  if (desc.includes("timelock") || desc.includes("propose")) return "TimelockProposed";
  if (desc.includes("property") && desc.includes("init"))  return "PropertyInitialized";

  return null;
}

function _extractWallet(tx: HeliusTransaction, type: MamposteraEventType): string | undefined {
  if (type === "RentClaimed" || type === "TokensMinted") {
    return tx.feePayer;
  }
  if (tx.nativeTransfers.length > 0) {
    return tx.nativeTransfers[0].fromUserAccount;
  }
  return tx.feePayer;
}

function _extractAmount(tx: HeliusTransaction, type: MamposteraEventType): number | undefined {
  if (type === "RentDeposited" || type === "RentClaimed") {
    const transfer = tx.nativeTransfers.find(t => t.amount > 0);
    return transfer?.amount;
  }
  if (type === "TokensMinted" && tx.tokenTransfers.length > 0) {
    return tx.tokenTransfers[0].tokenAmount;
  }
  return undefined;
}

function _extractPropertyPubkey(tx: HeliusTransaction): string | undefined {
  // La property PDA es típicamente la primera cuenta de la instrucción del programa
  const mampoInstr = tx.instructions.find(i => i.programId === PROGRAM_ID);
  return mampoInstr?.accounts?.[0];
}
