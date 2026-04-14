/**
 * app/api/webhooks/helius/route.ts
 *
 * R6: Recibe eventos on-chain de Helius en < 500ms.
 * Verifica la firma → parsea el evento → persiste en DB → invalida cache Redis.
 *
 * runtime = nodejs: necesita acceso a DB (Neon) y Redis (Upstash).
 * El procesamiento es síncrono pero rápido — la persistencia es < 20ms.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse }  from "next/server";
import {
  verifyHeliusWebhook,
  parseHeliusEvent,
  persistEvent,
  type HeliusTransaction,
} from "@/services/indexer/helius.service";
import { captureError }              from "@/services/security/sentry.adapter";

export async function POST(req: NextRequest) {
  // 1. Verificar auth header que Helius adjunta en cada webhook
  const authHeader = req.headers.get("authorization") ?? "";
  const isValid    = await verifyHeliusWebhook(authHeader);

  if (!isValid) {
    // Log intento de acceso no autorizado pero no exponer detalles
    console.warn("[helius] Webhook con auth inválida desde", req.headers.get("cf-connecting-ip"));
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parsear el body — Helius envía un array de transacciones
  let transactions: HeliusTransaction[];
  try {
    const body = await req.json() as HeliusTransaction | HeliusTransaction[];
    transactions = Array.isArray(body) ? body : [body];
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 3. Procesar cada transacción en paralelo
  const results = await Promise.allSettled(
    transactions.map(async (tx) => {
      const event = parseHeliusEvent(tx);
      if (!event) return { skipped: true, sig: tx.signature };

      await persistEvent(event);
      return { indexed: true, type: event.type, sig: tx.signature.slice(0, 8) };
    })
  );

  const indexed = results.filter(
    r => r.status === "fulfilled" && (r.value as { indexed?: boolean }).indexed
  ).length;
  const errors  = results.filter(r => r.status === "rejected");

  // Log errores sin fallar el webhook (Helius reintentaría si retornamos 5xx)
  for (const err of errors) {
    if (err.status === "rejected") {
      captureError(err.reason as Error, { context: "helius_webhook_process" });
    }
  }

  return NextResponse.json({
    received:  transactions.length,
    indexed,
    skipped:   transactions.length - indexed - errors.length,
    errors:    errors.length,
  });
}
