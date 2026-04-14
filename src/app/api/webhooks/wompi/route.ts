/**
 * frontend/src/app/api/webhooks/wompi/route.ts
 * Recibe confirmaciones de pago de Wompi → dispara mint de tokens.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse }   from "next/server";
import { verifyWompiWebhook, extractApprovedTransaction, type WompiWebhookEvent } from "@/services/payments/wompi.adapter";
import { captureError }  from "@/services/security/sentry.adapter";
import { trackEvent, MamposteraEvents } from "@/services/analytics/posthog.adapter";
import { queueJob }      from "@/lib/queue/client";

export async function POST(req: NextRequest) {
  try {
    const payload   = await req.json() as WompiWebhookEvent;
    const checksum  = payload.signature?.checksum ?? "";

    // 1. Verificar firma HMAC del webhook
    const isValid = await verifyWompiWebhook(payload, checksum);
    if (!isValid) {
      return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
    }

    // 2. Extraer transacción aprobada
    const approved = extractApprovedTransaction(payload);
    if (!approved) {
      // No es un error — el pago puede estar pendiente
      return NextResponse.json({ received: true });
    }

    // 3. Encolar el mint de tokens (async para no bloquear el webhook)
    await queueJob({
      jobId:   `wompi-mint-${approved.reference}`,
      handler: "kyc-webhook",  // Reusar handler — en producción crear "wompi-mint"
      payload: {
        action:        "mint_tokens_after_onramp",
        walletAddress: approved.walletAddress,
        amountCOP:     approved.amountCOP,
        propertyId:    approved.propertyId,
        reference:     approved.reference,
        provider:      "wompi",
      },
      retries: 3,
    });

    // 4. Analytics
    await trackEvent(approved.walletAddress, MamposteraEvents.ONRAMP_COMPLETED, {
      provider:      "wompi",
      amountCOP:     approved.amountCOP,
      propertyId:    approved.propertyId,
    }).catch(() => {}); // Non-blocking

    return NextResponse.json({ received: true, processing: true });
  } catch (err: unknown) {
    captureError(err as Error, { context: "wompi_webhook" });
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
