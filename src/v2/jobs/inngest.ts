/**
 * v2/jobs/inngest.ts
 * Inngest — reemplaza Upstash QStash con mejor DX, retry visual y cron.
 *
 * Wrapper: queueJob() sigue funcionando con la misma API.
 * Internamente usa Inngest en lugar de QStash.
 *
 * Ventajas sobre QStash:
 *   - Dashboard visual con historial de jobs y replay
 *   - Retry con backoff exponencial configurable por job
 *   - Cron jobs declarativos (distribución semanal de renta)
 *   - Step functions para jobs multi-paso (KYC → sign → mint)
 *   - TypeScript nativo end-to-end
 */

import { Inngest }            from "inngest";
import { executeClaudeJob }   from "../../services/legal/claude.adapter";
import { executeSignJob }     from "../../services/legal/firma.adapter";
import { sendRentNotification } from "../../services/comms/resend.adapter";
import type { ClaudeJobRequest } from "../../services/legal/claude.adapter";
import type { SendForSignatureRequest } from "../../services/legal/firma.adapter";
import type { QueueJobOptions } from "../../lib/queue/client";

export const inngest = new Inngest({ id: "mampostera" });

// ── Job: Claude legal AI ──────────────────────────────────────────────────────

export const legalAiJob = inngest.createFunction(
  {
    id:      "legal-ai",
    name:    "Legal AI — Claude",
    retries: 2,
    throttle: { limit: 10, period: "1m" },  // máx 10 llamadas/min (control de costos)
  },
  { event: "mampostera/legal.ai.requested" },
  async ({ event, step }) => {
    const req = event.data as ClaudeJobRequest & { jobId: string };

    const result = await step.run("call-claude", () => executeClaudeJob(req));

    if (result.status === "completed" && event.data.webhookUrl) {
      await step.run("notify-webhook", () =>
        fetch(event.data.webhookUrl as string, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(result),
        })
      );
    }

    return result;
  }
);

// ── Job: Firma electrónica ────────────────────────────────────────────────────

export const signDocJob = inngest.createFunction(
  {
    id:      "sign-doc",
    name:    "Document signing — Firma.co",
    retries: 3,
  },
  { event: "mampostera/sign.document.requested" },
  async ({ event, step }) => {
    const req = event.data as SendForSignatureRequest & { jobId: string };
    return step.run("send-for-signature", () => executeSignJob(req));
  }
);

// ── Job: Notificación de renta ────────────────────────────────────────────────

export const rentNotifyJob = inngest.createFunction(
  {
    id:      "rent-notify",
    name:    "Rent notification — Resend",
    retries: 2,
  },
  { event: "mampostera/rent.notification.requested" },
  async ({ event, step }) => {
    // REAL-C fix: event.data ahora usa los mismos nombres canónicos que
    // RentNotifyPayload — elimina el mapeo de nombres duplicados.
    const { to, walletDisplay, propertyName, rentAmountSol, claimUrl } = event.data as {
      to:            string;   // email del inversor
      walletDisplay: string;   // dirección abreviada o nombre
      propertyName:  string;   // dirección de la propiedad
      rentAmountSol: number;   // lowercase camelCase canónico
      claimUrl:      string;
    };

    await step.run("send-email", () =>
      sendRentNotification({ to, walletDisplay, propertyName, rentAmountSol, claimUrl })
    );
  }
);

// ── Cron: distribución semanal ────────────────────────────────────────────────

export const weeklyRentCheck = inngest.createFunction(
  { id: "weekly-rent-check", name: "Weekly rent distribution check" },
  { cron: "0 9 * * 1" },  // Todos los lunes a las 9am UTC
  async ({ step }) => {
    // TODO: consultar propiedades con renta acumulada > umbral
    // y notificar a los inversores que tienen renta disponible
    await step.run("check-properties", async () => {
      console.info("[inngest] Iniciando verificación semanal de renta disponible");
    });
  }
);

// ── Wrapper compatible con la API actual de queueJob() ────────────────────────

export async function queueJobV2(opts: QueueJobOptions): Promise<void> {
  const eventMap: Record<QueueJobOptions["handler"], string> = {
    "legal-ai":    "mampostera/legal.ai.requested",
    "sign-doc":    "mampostera/sign.document.requested",
    "rent-notify": "mampostera/rent.notification.requested",
    "kyc-webhook": "mampostera/kyc.webhook.received",
  };

  const event = eventMap[opts.handler];
  if (!event) throw new Error(`[inngest] Handler desconocido: ${opts.handler}`);

  await inngest.send({
    id:   opts.jobId,
    name: event as Parameters<typeof inngest.send>[0]["name"],
    data: opts.payload,
  });
}

export const inngestFunctions = [legalAiJob, signDocJob, rentNotifyJob, weeklyRentCheck];
