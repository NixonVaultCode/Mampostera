/**
 * frontend/src/services/payments/wompi.adapter.ts
 *
 * R5: On-ramp nativo Colombia — PSE, Nequi, Daviplata, Transferencia Bancaria.
 *
 * Wompi es el procesador de Bancolombia — el más confiable de Colombia.
 * TAM: 45M colombianos con PSE, 17M con Nequi, 8M con Daviplata.
 *
 * Flujo completo:
 *   1. Frontend llama createWompiSession() → obtiene redirect URL
 *   2. Usuario paga en PSE/Nequi (en su banco/app)
 *   3. Wompi envía webhook de confirmación a /api/webhooks/wompi
 *   4. Backend convierte COP → USDC via Circle API
 *   5. mintFractionalTokens() se ejecuta automáticamente
 *
 * Documentación Wompi: https://docs.wompi.co/docs/colombia/
 * Sandbox: https://sandbox.wompi.co
 */

import { getSecret, SecretKey } from "../secrets.service";

// ── Tipos ────────────────────────────────────────────────────────────────────

export type WompiPaymentMethod =
  | "PSE"                    // Débito bancario directo — más común en Colombia
  | "NEQUI"                  // Wallet digital — 17M usuarios
  | "BANCOLOMBIA_TRANSFER"   // Transferencia Bancolombia
  | "BANCOLOMBIA_COLLECT"    // QR Bancolombia
  | "CARD";                  // Tarjeta débito/crédito colombiana

export type WompiTransactionStatus =
  | "PENDING"
  | "APPROVED"
  | "DECLINED"
  | "VOIDED"
  | "ERROR";

export interface WompiSessionParams {
  amountCOP:      number;        // Monto en pesos colombianos (sin decimales, ej: 50000)
  walletAddress:  string;        // Solana wallet del inversor
  paymentMethod:  WompiPaymentMethod;
  reference:      string;        // ID único de la transacción (máx 40 chars)
  propertyId?:    string;        // Para vincular con la propiedad on-chain
  customerEmail?: string;        // Para el recibo del inversor
  customerPhone?: string;        // E.164 para Nequi: +573001234567
}

export interface WompiSessionResult {
  ok:             boolean;
  transactionId?: string;    // ID en Wompi para tracking
  redirectUrl?:   string;    // URL donde el usuario completa el pago
  paymentLink?:   string;    // Link directo para Nequi (deep link)
  reference:      string;
  amountCOP:      number;
  provider:       "wompi";
  error?:         string;
}

export interface WompiWebhookEvent {
  event:       "transaction.updated";
  data: {
    transaction: {
      id:          string;
      status:      WompiTransactionStatus;
      amount_in_cents: number;
      reference:   string;
      payment_method: { type: WompiPaymentMethod };
      metadata: {
        wallet_address: string;
        property_id?:   string;
      };
    };
  };
  sent_at: string;
  timestamp: number;
  signature: {
    checksum: string;
    properties: string[];
  };
}

// ── Wompi API base ────────────────────────────────────────────────────────────

const WOMPI_BASE = process.env.NODE_ENV === "production"
  ? "https://production.wompi.co/v1"
  : "https://sandbox.wompi.co/v1";

// ── Crear sesión de pago ──────────────────────────────────────────────────────

export async function createWompiSession(
  params: WompiSessionParams
): Promise<WompiSessionResult> {
  const [pubKey, privKey] = await Promise.all([
    getSecret(SecretKey.WOMPI_PUBLIC_KEY),
    getSecret(SecretKey.WOMPI_PRIVATE_KEY),
  ]);

  // Wompi requiere el monto en centavos
  const amountCents = params.amountCOP * 100;

  // Construir el payload según el método de pago
  const transactionPayload: Record<string, unknown> = {
    acceptance_token:         await _getAcceptanceToken(pubKey),
    amount_in_cents:          amountCents,
    currency:                 "COP",
    customer_email:           params.customerEmail ?? "inversor@mampostera.co",
    payment_method:           _buildPaymentMethod(params),
    reference:                params.reference,
    metadata: {
      wallet_address: params.walletAddress,
      property_id:    params.propertyId ?? "",
      platform:       "mampostera",
    },
  };

  try {
    const response = await fetch(`${WOMPI_BASE}/transactions`, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${privKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(transactionPayload),
    });

    if (!response.ok) {
      const errBody = await response.json() as { error?: { messages?: Record<string, string[]> } };
      const errMsg  = Object.values(errBody.error?.messages ?? {}).flat().join(", ");
      throw new Error(`Wompi ${response.status}: ${errMsg}`);
    }

    const data = await response.json() as {
      data: {
        id:     string;
        status: WompiTransactionStatus;
        payment_link_id: string | null;
      };
    };

    return {
      ok:            true,
      transactionId: data.data.id,
      redirectUrl:   `https://checkout.wompi.co/l/?public-key=${pubKey}&redirect-url=${
        encodeURIComponent(`${process.env.NEXT_PUBLIC_APP_URL}/onramp/success`)
      }&amount-in-cents=${amountCents}&currency=COP&reference=${params.reference}`,
      reference:     params.reference,
      amountCOP:     params.amountCOP,
      provider:      "wompi",
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[wompi] Error creando sesión:", error);
    return { ok: false, error, reference: params.reference, amountCOP: params.amountCOP, provider: "wompi" };
  }
}

// ── Verificar firma del webhook ───────────────────────────────────────────────

export async function verifyWompiWebhook(
  payload:   WompiWebhookEvent,
  checksum:  string
): Promise<boolean> {
  const eventsKey = await getSecret(SecretKey.WOMPI_EVENTS_KEY);

  // Wompi firma: SHA-256(properties_concat + timestamp + events_key)
  const { properties } = payload.signature;
  const concatenated = properties
    .map(prop => _getNestedValue(payload as unknown as Record<string, unknown>, prop))
    .join("")
    .concat(String(payload.timestamp))
    .concat(eventsKey);

  const encoder  = new TextEncoder();
  const key      = await globalThis.crypto.subtle.importKey(
    "raw", encoder.encode(eventsKey),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBuf   = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(concatenated));
  const computed = Array.from(new Uint8Array(sigBuf))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  return computed === checksum;
}

// ── Procesar webhook de pago aprobado ────────────────────────────────────────

export function extractApprovedTransaction(event: WompiWebhookEvent): {
  approved:      boolean;
  walletAddress: string;
  amountCOP:     number;
  reference:     string;
  propertyId?:   string;
} | null {
  const { transaction } = event.data;

  if (transaction.status !== "APPROVED") return null;

  return {
    approved:      true,
    walletAddress: transaction.metadata.wallet_address,
    amountCOP:     Math.round(transaction.amount_in_cents / 100),
    reference:     transaction.reference,
    propertyId:    transaction.metadata.property_id || undefined,
  };
}

// ── Helpers privados ──────────────────────────────────────────────────────────

async function _getAcceptanceToken(publicKey: string): Promise<string> {
  const res = await fetch(`${WOMPI_BASE}/merchants/${publicKey}`);
  if (!res.ok) throw new Error("[wompi] No se pudo obtener acceptance token");
  const data = await res.json() as { data: { presigned_acceptance: { acceptance_token: string } } };
  return data.data.presigned_acceptance.acceptance_token;
}

function _buildPaymentMethod(params: WompiSessionParams): Record<string, unknown> {
  switch (params.paymentMethod) {
    case "PSE":
      return { type: "PSE", user_type: 0, user_legal_id_type: "CC", user_legal_id: "0", financial_institution_code: "0" };
    case "NEQUI":
      return { type: "NEQUI", phone_number: params.customerPhone?.replace("+57", "") ?? "" };
    case "BANCOLOMBIA_TRANSFER":
      return { type: "BANCOLOMBIA_TRANSFER", user_type: "NATURAL_PERSON", payment_description: "Inversión Mampostera" };
    case "BANCOLOMBIA_COLLECT":
      return { type: "BANCOLOMBIA_COLLECT" };
    default:
      return { type: "CARD" };
  }
}

function _getNestedValue(obj: Record<string, unknown>, path: string): string {
  return path.split(".").reduce((acc: unknown, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj) as string ?? "";
}

// ── Agregar al SecretKey enum (secrets.service.ts) ────────────────────────────
// WOMPI_PUBLIC_KEY:  "WOMPI_PUBLIC_KEY",
// WOMPI_PRIVATE_KEY: "WOMPI_PRIVATE_KEY",
// WOMPI_EVENTS_KEY:  "WOMPI_EVENTS_KEY",
