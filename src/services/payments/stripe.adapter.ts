/**
 * services/payments/stripe.adapter.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Adaptador de Stripe para on-ramp fiat → USDC.
 *
 * SERVER-SIDE ONLY. Importar solo en /app/api/**.
 * En el browser usar: import { loadStripe } from '@stripe/stripe-js'
 * ──────────────────────────────────────────────────────────────────────────────
 */

// NODE RUNTIME REQUIRED — declarar en la route que lo use:
// export const runtime = 'nodejs';

import { getSecrets } from "@/services/secrets.service";

export interface StripeOnRampResult {
  ok:             boolean;
  clientSecret?:  string;    // Para el componente Stripe Elements en el browser
  sessionId?:     string;
  redirectUrl?:   string;
  error?:         string;
  provider:       "stripe";
}

/**
 * Crea una sesión de On-Ramp de Stripe (fiat → USDC/SOL).
 * El usuario paga con tarjeta y recibe USDC directamente en su wallet Solana.
 *
 * @param walletAddress Dirección Solana del destinatario
 * @param amountUsd     Cantidad en USD (centavos, ej: 5000 = $50)
 */
export async function createOnRampSession(
  walletAddress: string,
  amountUsd:     number
): Promise<StripeOnRampResult> {
  try {
    const { STRIPE_SECRET_KEY } = await getSecrets(["STRIPE_SECRET_KEY"]);

    // Dynamic import para evitar que stripe se incluya en el bundle del cliente
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

    // BUG-11 fix: (stripe as any).crypto.onrampSessions no existe en el SDK oficial.
    // La API de Stripe Crypto On-Ramp se accede via el endpoint REST directamente,
    // ya que el SDK de Node no incluye este módulo beta en el tipado.
    // Ref: https://stripe.com/docs/crypto/using-the-api
    const response = await fetch("https://api.stripe.com/v1/crypto/onramp_sessions", {
      method:  "POST",
      headers: {
        "Authorization":  `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type":   "application/x-www-form-urlencoded",
        "Stripe-Version": "2024-06-20",
      },
      body: new URLSearchParams({
        "transaction_details[wallet_addresses][solana]":   walletAddress,
        "transaction_details[destination_currencies][0]":  "usdc",
        "transaction_details[destination_networks][0]":    "solana",
        "transaction_details[source_currency]":            "usd",
        "transaction_details[source_amount]":              String(amountUsd / 100),
      }).toString(),
    });

    if (!response.ok) {
      const errBody = await response.json() as { error?: { message?: string } };
      throw new Error(errBody.error?.message ?? `Stripe HTTP ${response.status}`);
    }

    const session = await response.json() as { client_secret: string; id: string };

    return {
      ok:           true,
      clientSecret: session.client_secret,
      sessionId:    session.id,
      provider:     "stripe",
    };
  } catch (err: any) {
    console.error("[stripe] Error creando sesión on-ramp:", err.message);
    return {
      ok:       false,
      error:    err.message,
      provider: "stripe",
    };
  }
}

/**
 * Verifica la firma de un webhook de Stripe.
 * Usar en /app/api/webhooks/stripe/route.ts
 */
export async function verifyStripeWebhook(
  body:      string,
  signature: string
): Promise<{ ok: boolean; event?: any; error?: string }> {
  try {
    const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = await getSecrets([
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

    const event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
    return { ok: true, event };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
