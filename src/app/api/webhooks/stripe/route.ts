/**
 * app/api/webhooks/stripe/route.ts
 * Eventos de Stripe: pago completado → mint tokens on-chain.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyStripeWebhook } from "@/services/payments/stripe.adapter";
import { captureError } from "@/services/security/sentry.adapter";
import { trackEvent, MamposteraEvents } from "@/services/analytics/posthog.adapter";

export async function POST(req: NextRequest) {
  const body      = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";

  try {
    const event = await verifyStripeWebhook(body, signature);

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as { metadata?: Record<string, string>; amount?: number };
      const { walletAddress, propertyId } = pi.metadata ?? {};

      if (walletAddress) {
        await trackEvent(walletAddress, MamposteraEvents.ONRAMP_COMPLETED, {
          provider:   "stripe",
          amountUsdc: (pi.amount ?? 0) / 100,
          propertyId,
        });
        // TODO: llamar a mintFractionalTokens() para el investor
        console.info(`[stripe] Pago completado para wallet ${walletAddress}`);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err: unknown) {
    captureError(err as Error, { context: "stripe_webhook" });
    return NextResponse.json({ error: "Webhook error" }, { status: 400 });
  }
}
