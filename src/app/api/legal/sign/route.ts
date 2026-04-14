/**
 * app/api/legal/sign/route.ts
 * POST: Encola envío de documento para firma → 202 Accepted
 * PATCH: Recibe webhook de Firma.co cuando el documento es firmado
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { sendForSignature, processSignatureWebhook } from "@/services/legal/firma.adapter";
import { captureError } from "@/services/security/sentry.adapter";
import { trackEvent, MamposteraEvents } from "@/services/analytics/posthog.adapter";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const job  = await sendForSignature(body);
    return NextResponse.json(job, { status: 202 });
  } catch (err: unknown) {
    captureError(err as Error, { context: "sign_enqueue" });
    return NextResponse.json({ error: "Error iniciando proceso de firma" }, { status: 500 });
  }
}

// Webhook de Firma.co/DocuSign
export async function PATCH(req: NextRequest) {
  try {
    const signature = req.headers.get("x-firma-signature") ?? req.headers.get("x-docusign-signature-1") ?? "";
    const provider  = req.headers.get("x-firma-provider") as "firma_co" | "docusign" ?? "firma_co";
    const payload   = await req.json();

    const event = await processSignatureWebhook(payload, signature, provider);

    if (event.status === "signed") {
      // Aquí actualizar el NotarialRecord PDA on-chain si aplica
      await trackEvent(event.envelopeId, MamposteraEvents.LEGAL_DOC_SIGNED, {
        provider: event.provider,
        documentHash: event.documentHash,
      });
    }

    return NextResponse.json({ received: true });
  } catch (err: unknown) {
    captureError(err as Error, { context: "sign_webhook" });
    return NextResponse.json({ error: "Webhook inválido" }, { status: 400 });
  }
}
