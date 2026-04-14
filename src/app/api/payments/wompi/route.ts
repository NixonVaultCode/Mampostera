/**
 * app/api/payments/wompi/route.ts
 *
 * R5: Endpoint on-ramp para Colombia — PSE, Nequi, Daviplata.
 * Si Wompi falla → fallback automático a Stripe (mismo patrón que moonpay).
 * runtime = nodejs: usa SDK de Stripe (Node) y Wompi adapter.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse }  from "next/server";
import {
  createWompiSession,
  type WompiPaymentMethod,
} from "@/services/payments/wompi.adapter";
import { createOnRampSession }        from "@/services/payments/stripe.adapter";
import { captureError }               from "@/services/security/sentry.adapter";
import { trackEvent, MamposteraEvents } from "@/services/analytics/posthog.adapter";
import { requireSecrets, SecretKey }  from "@/services/secrets.service";

// COP → USD aproximación para calcular el monto USDC
// En producción usar la tasa de cambio real desde Fixer.io o Bancolombia
const COP_TO_USD_RATE = 0.00024; // 1 COP ≈ $0.00024 USD (actualizar según mercado)

export async function POST(req: NextRequest) {
  const {
    amountCOP,
    walletAddress,
    paymentMethod = "PSE",
    propertyId,
    customerEmail,
    customerPhone,
  } = await req.json() as {
    amountCOP:      number;
    walletAddress:  string;
    paymentMethod?: WompiPaymentMethod;
    propertyId?:    string;
    customerEmail?: string;
    customerPhone?: string;
  };

  // Validaciones básicas
  if (!amountCOP || amountCOP < 10_000) {
    return NextResponse.json(
      { error: "Monto mínimo: $10.000 COP" },
      { status: 400 }
    );
  }
  if (!walletAddress) {
    return NextResponse.json(
      { error: "walletAddress requerido" },
      { status: 400 }
    );
  }

  const reference  = `mamp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const amountUsdc = Math.round(amountCOP * COP_TO_USD_RATE * 100) / 100; // 2 decimales

  // ── Intento 1: Wompi (PSE / Nequi / Daviplata) ───────────────────────────
  try {
    await requireSecrets([SecretKey.WOMPI_PUBLIC_KEY, SecretKey.WOMPI_PRIVATE_KEY]);

    const result = await createWompiSession({
      amountCOP,
      walletAddress,
      paymentMethod,
      reference,
      propertyId,
      customerEmail,
      customerPhone,
    });

    if (result.ok) {
      await trackEvent(walletAddress, MamposteraEvents.ONRAMP_STARTED, {
        provider:      "wompi",
        amountCOP,
        amountUsdc,
        paymentMethod,
        propertyId,
      });

      return NextResponse.json({
        ...result,
        amountUsdc,
        provider: "wompi",
      });
    }

    // Wompi respondió pero con error — caer a Stripe
    console.warn(`[wompi] Error en sesión: ${result.error} — activando fallback Stripe`);
  } catch (wompiErr) {
    captureError(wompiErr as Error, { context: "wompi_session", severity: "warning" });
    console.warn("[wompi] Exception — activando fallback Stripe");
  }

  // ── Fallback: Stripe (tarjeta internacional) ──────────────────────────────
  try {
    const session = await createOnRampSession({
      amountUsdc:    Math.round(amountUsdc * 100), // cents
      walletAddress,
      propertyId,
    });

    await trackEvent(walletAddress, MamposteraEvents.ONRAMP_STARTED, {
      provider:   "stripe_fallback",
      amountCOP,
      amountUsdc,
      propertyId,
    });

    return NextResponse.json({
      ...session,
      amountUsdc,
      provider:  "stripe",
      fallback:  true,
      fallbackReason: "Wompi no disponible — usando tarjeta internacional",
    });
  } catch (stripeErr) {
    captureError(stripeErr as Error, { context: "wompi_stripe_fallback" });
    return NextResponse.json(
      { error: "Servicio de pago temporalmente no disponible. Intenta en unos minutos." },
      { status: 503 }
    );
  }
}
