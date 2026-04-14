/**
 * lib/queue/client.ts
 * BUG-06 fix: reemplaza dynamic import con template literal (falla en bundlers)
 * por un mapa estático de handlers.
 */
import { getSecret, SecretKey } from "../services/secrets.service";

export interface QueueJobOptions {
  jobId:    string;
  handler:  "legal-ai" | "sign-doc" | "rent-notify" | "kyc-webhook";
  payload:  Record<string, unknown>;
  delay?:   number;
  retries?: number;
}

const BASE_URL =
  process.env.NEXTAUTH_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000";

export async function queueJob(opts: QueueJobOptions): Promise<void> {
  const [qstashUrl, token] = await Promise.all([
    getSecret(SecretKey.QSTASH_URL,   { throwIfMissing: false, defaultValue: "" }),
    getSecret(SecretKey.QSTASH_TOKEN, { throwIfMissing: false, defaultValue: "" }),
  ]);

  // Sin QStash → ejecutar inline en dev con mapa estático (BUG-06 fix)
  if (!qstashUrl || !token) {
    console.warn(`[queue] QStash no configurado — ejecutando ${opts.jobId} inline`);

    // Mapa estático en lugar de dynamic import con template literal
    const handlers: Record<QueueJobOptions["handler"], () => Promise<{ runJob: (p: Record<string, unknown>) => Promise<void> }>> = {
      "legal-ai":    () => import("./jobs/legal-ai.job"),
      "sign-doc":    () => import("./jobs/sign-doc.job"),
      "rent-notify": () => import("./jobs/rent-notify.job"),
      "kyc-webhook": () => import("./jobs/rent-notify.job"), // fallback hasta implementar
    };

    const loader = handlers[opts.handler];
    if (!loader) throw new Error(`[queue] Handler desconocido: ${opts.handler}`);

    const { runJob } = await loader();
    await runJob(opts.payload).catch(console.error);
    return;
  }

  const headers: Record<string, string> = {
    "Authorization":      `Bearer ${token}`,
    "Content-Type":       "application/json",
    "Upstash-Retries":    String(opts.retries ?? 2),
    "Upstash-Message-ID": opts.jobId,
  };
  if (opts.delay) headers["Upstash-Delay"] = `${opts.delay}s`;

  const destinationUrl = `${BASE_URL}/api/workers/${opts.handler}`;

  const res = await fetch(
    `${qstashUrl}/v2/publish/${encodeURIComponent(destinationUrl)}`,
    { method: "POST", headers, body: JSON.stringify(opts.payload) }
  );

  if (!res.ok) {
    throw new Error(`[queue] QStash error ${res.status}: ${await res.text()}`);
  }
}
