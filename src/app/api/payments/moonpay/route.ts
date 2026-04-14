/**
 * app/api/payments/moonpay/route.ts
 * On-ramp LATAM (PSE, Efecty, transferencia COP).
 * Fallback automático a Stripe si MoonPay falla.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createMoonPayUrl, type MoonPaySessionResult } from "@/services/payments/moonpay.adapter";
import { createOnRampSession } from "@/services/payments/stripe.adapter";
import { captureError } from "@/services/security/sentry.adapter";
import { trackEvent, MamposteraEvents } from "@/services/analytics/posthog.adapter";

export async function POST(req: NextRequest) {
  const { amountUsdc, walletAddress, currency = "COP", propertyId } = await req.json() as {
    amountUsdc:    number;
    walletAddress: string;
    currency?:     string;
    propertyId?:   string;
  };

  if (!amountUsdc || !walletAddress) {
    return NextResponse.json({ error: "Parámetros requeridos faltantes" }, { status: 400 });
  }

  // Intentar MoonPay primero
  try {
    const result: MoonPaySessionResult = await createMoonPayUrl({
      amountUsdc, walletAddress, currency, propertyId,
    });

    await trackEvent(walletAddress, MamposteraEvents.ONRAMP_STARTED, {
      provider: "moonpay", amountUsdc, currency,
    });

    return NextResponse.json({ ...result, provider: "moonpay" });
  } catch (moonErr) {
    captureError(moonErr as Error, { context: "moonpay_onramp", severity: "warning" });
    console.warn("[moonpay] Falló, activando fallback Stripe");
  }

  // Fallback: Stripe
  try {
    const session = await createOnRampSession({ amountUsdc, walletAddress, propertyId });

    await trackEvent(walletAddress, MamposteraEvents.ONRAMP_STARTED, {
      provider: "stripe_fallback", amountUsdc,
    });

    return NextResponse.json({ ...session, provider: "stripe", fallback: true });
  } catch (stripeErr) {
    captureError(stripeErr as Error, { context: "stripe_fallback_onramp" });
    return NextResponse.json(
      { error: "Servicio de pago temporalmente no disponible. Intenta más tarde." },
      { status: 503 }
    );
  }
}
