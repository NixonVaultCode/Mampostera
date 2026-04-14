/**
 * services/security/cloudflare.adapter.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Adaptador de Cloudflare para operaciones server-side.
 *
 * Casos de uso:
 *   - Purgar caché después de actualizar metadatos de propiedad
 *   - Verificar que una petición viene de Cloudflare (en routes de webhooks)
 *   - Añadir IPs a la lista negra via API de CF
 *   - Consultar analytics de tráfico
 *
 * Las reglas WAF y rate limits se configuran en el dashboard de Cloudflare,
 * no en código. Este adapter solo interactúa con la API de CF cuando necesitamos
 * operaciones programáticas (purge, blocklist, etc.).
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { getSecrets } from "@/services/secrets.service";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface CloudflareResult<T = void> {
  ok:    boolean;
  data?: T;
  error?: string;
}

// ── Helper interno ─────────────────────────────────────────────────────────────

async function cfFetch<T>(
  path: string,
  init?: RequestInit
): Promise<CloudflareResult<T>> {
  try {
    const { CLOUDFLARE_API_TOKEN } = await getSecrets(["CLOUDFLARE_API_TOKEN"]);

    const res = await fetch(`${CF_API_BASE}${path}`, {
      ...init,
      headers: {
        "Authorization": `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type":  "application/json",
        ...init?.headers,
      },
    });

    interface CfPurgeResponse { success: boolean; errors: string[]; messages: string[] }
    const json = await res.json() as CfPurgeResponse;

    if (!res.ok || !json.success) {
      return {
        ok:    false,
        error: json.errors?.[0]?.message ?? `CF API error ${res.status}`,
      };
    }

    return { ok: true, data: json.result as T };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ── API pública ────────────────────────────────────────────────────────────────

/**
 * Purga el caché de Cloudflare para URLs específicas.
 * Usar después de actualizar metadatos de propiedades o documentos legales.
 */
export async function purgeCache(urls: string[]): Promise<CloudflareResult> {
  const { CLOUDFLARE_ZONE_ID } = await getSecrets(["CLOUDFLARE_ZONE_ID"]);

  return cfFetch(`/zones/${CLOUDFLARE_ZONE_ID}/purge_cache`, {
    method: "POST",
    body:   JSON.stringify({ files: urls }),
  });
}

/**
 * Purga todo el caché de la zona (usar con cuidado en producción).
 */
export async function purgeAllCache(): Promise<CloudflareResult> {
  const { CLOUDFLARE_ZONE_ID } = await getSecrets(["CLOUDFLARE_ZONE_ID"]);

  return cfFetch(`/zones/${CLOUDFLARE_ZONE_ID}/purge_cache`, {
    method: "POST",
    body:   JSON.stringify({ purge_everything: true }),
  });
}

/**
 * Verifica que una petición de webhook viene de Cloudflare.
 * Usar en routes que reciben webhooks de servicios externos.
 *
 * En producción, configurar Cloudflare Authenticated Origin Pulls
 * como capa adicional de verificación.
 */
export function verifyCloudflareRequest(req: Request): boolean {
  const cfRay     = req.headers.get("cf-ray");
  const cfCountry = req.headers.get("cf-ipcountry");

  // En dev, permitir sin CF headers
  if (process.env.NODE_ENV !== "production") return true;

  return Boolean(cfRay && cfCountry);
}

/**
 * Bloquea una IP via Cloudflare Firewall Rules.
 * Usar cuando detectamos comportamiento malicioso on-chain o intentos de fraud.
 *
 * @param ip IP a bloquear (IPv4 o IPv6)
 * @param reason Razón del bloqueo (para el audit log)
 */
export async function blockIp(
  ip: string,
  reason: string
): Promise<CloudflareResult> {
  const { CLOUDFLARE_ACCOUNT_ID } = await getSecrets(["CLOUDFLARE_ACCOUNT_ID"]);

  return cfFetch(`/accounts/${CLOUDFLARE_ACCOUNT_ID}/firewall/access-rules/rules`, {
    method: "POST",
    body:   JSON.stringify({
      mode:          "block",
      configuration: { target: "ip", value: ip },
      notes:         `Mampostera auto-block: ${reason}`,
    }),
  });
}

/**
 * Consulta el analytics de tráfico de Cloudflare para un rango de tiempo.
 * Útil para detectar patrones de ataque o tráfico inusual.
 */
export async function getTrafficAnalytics(
  since: Date,
  until: Date
): Promise<CloudflareResult<{ requests: number; threats: number }>> {
  const { CLOUDFLARE_ZONE_ID } = await getSecrets(["CLOUDFLARE_ZONE_ID"]);

  const params = new URLSearchParams({
    since: since.toISOString(),
    until: until.toISOString(),
  });

  return cfFetch(`/zones/${CLOUDFLARE_ZONE_ID}/analytics/dashboard?${params}`);
}
