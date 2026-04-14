/**
 * app/api/webhooks/hyperlane/route.ts
 * Eventos de Hyperlane: mensajes cross-chain recibidos en Solana.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { captureError } from "@/services/security/sentry.adapter";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json() as {
      messageId:   string;
      origin:      number;
      destination: number;
      sender:      string;
      recipient:   string;
      body:        string;
    };

    console.info(`[hyperlane] Mensaje cross-chain: ${payload.messageId} de chain ${payload.origin}`);

    // El Programa Anchor ya procesó process_cross_chain_buy on-chain.
    // Este webhook es para indexar el evento en la base de datos off-chain
    // y notificar al inversor por email.

    // TODO: guardar en DB + enviar email de confirmación
    return NextResponse.json({ received: true });
  } catch (err: unknown) {
    captureError(err as Error, { context: "hyperlane_webhook" });
    return NextResponse.json({ error: "Webhook error" }, { status: 400 });
  }
}
