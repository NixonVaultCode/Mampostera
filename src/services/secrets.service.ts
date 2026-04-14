/**
 * services/secrets.service.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * ÚNICO punto de acceso a secretos en todo el proyecto.
 *
 * Regla de oro: NADIE importa process.env directamente.
 * TODOS llaman a getSecret('NOMBRE_DEL_SECRET').
 *
 * En producción → Infisical SDK (Universal Auth)
 * En CI/dev local → variables de entorno como fallback (NUNCA en producción)
 *
 * Por qué Infisical y no process.env:
 * - Audit log de quién accedió a qué y cuándo
 * - Rotación de secretos sin redeploy
 * - Zero exposure en logs/Sentry (los valores nunca tocan el disco)
 * - Secret versioning y rollback
 *
 * CU estimado en cold start: ~200ms (caché en memoria después)
 * ──────────────────────────────────────────────────────────────────────────────
 */

// NOTA: Este módulo es SERVER-SIDE ONLY.
// No importar en componentes React ni en archivos del lado del cliente.
// Usar SOLO en /app/api/** y /services/**

// ── Tipos ──────────────────────────────────────────────────────────────────────

export type SecretKey =
  // Seguridad
  | "CLOUDFLARE_API_TOKEN"
  | "CLOUDFLARE_ZONE_ID"
  | "CLOUDFLARE_ACCOUNT_ID"
  | "SENTRY_DSN"
  | "SENTRY_AUTH_TOKEN"
  // Auth
  | "PRIVY_APP_ID"
  | "PRIVY_APP_SECRET"
  | "PRIVY_VERIFICATION_KEY"
  // Pagos
  | "STRIPE_SECRET_KEY"
  | "STRIPE_WEBHOOK_SECRET"
  | "STRIPE_PUBLISHABLE_KEY"
  | "MOONPAY_SECRET_KEY"
  | "MOONPAY_PUBLISHABLE_KEY"
  | "MOONPAY_WEBHOOK_SECRET"
  // Comunicaciones
  | "RESEND_API_KEY"
  | "TWILIO_ACCOUNT_SID"
  | "TWILIO_AUTH_TOKEN"
  | "TWILIO_PHONE_NUMBER"
  | "TWILIO_WHATSAPP_NUMBER"
  // Legal / IA
  | "ANTHROPIC_API_KEY"
  | "FIRMA_CO_API_KEY"
  | "FIRMA_CO_WEBHOOK_SECRET"
  // Analytics
  | "POSTHOG_API_KEY"
  | "POSTHOG_HOST"
  // Cola asíncrona
  | "QSTASH_TOKEN"
  | "QSTASH_CURRENT_SIGNING_KEY"
  | "QSTASH_NEXT_SIGNING_KEY"
  // On-chain / Infra
  | "HELIUS_API_KEY"
  | "HELIUS_WEBHOOK_SECRET"
  | "PROGRAM_ID"
  | "AUTHORITY_KEYPAIR_JSON"
  // Fase 0
  | "WOMPI_PUBLIC_KEY"
  | "WOMPI_PRIVATE_KEY"
  | "WOMPI_EVENTS_KEY"
  // Fase 2
  | "SWITCHBOARD_FEED_PUBKEY"; // Solo para scripts de deploy, nunca en frontend

// BUG-12 fix: const object para habilitar SecretKey.X dot notation.
// El type union de arriba sigue siendo la fuente de verdad de los strings válidos.
// Este objeto permite: getSecret(SecretKey.STRIPE_SECRET_KEY) con autocompletado.
export const SecretKey = {
  CLOUDFLARE_ZONE_ID:       "CLOUDFLARE_ZONE_ID",
  CLOUDFLARE_ACCOUNT_ID:    "CLOUDFLARE_ACCOUNT_ID",
  SENTRY_DSN:               "SENTRY_DSN",
  SENTRY_AUTH_TOKEN:        "SENTRY_AUTH_TOKEN",
  PRIVY_APP_ID:             "PRIVY_APP_ID",
  PRIVY_APP_SECRET:         "PRIVY_APP_SECRET",
  PRIVY_VERIFICATION_KEY:   "PRIVY_VERIFICATION_KEY",
  STRIPE_SECRET_KEY:        "STRIPE_SECRET_KEY",
  STRIPE_WEBHOOK_SECRET:    "STRIPE_WEBHOOK_SECRET",
  STRIPE_PUBLISHABLE_KEY:   "STRIPE_PUBLISHABLE_KEY",
  MOONPAY_SECRET_KEY:       "MOONPAY_SECRET_KEY",
  MOONPAY_PUBLISHABLE_KEY:  "MOONPAY_PUBLISHABLE_KEY",
  MOONPAY_WEBHOOK_SECRET:   "MOONPAY_WEBHOOK_SECRET",
  RESEND_API_KEY:           "RESEND_API_KEY",
  TWILIO_ACCOUNT_SID:       "TWILIO_ACCOUNT_SID",
  TWILIO_AUTH_TOKEN:        "TWILIO_AUTH_TOKEN",
  TWILIO_PHONE_NUMBER:      "TWILIO_PHONE_NUMBER",
  TWILIO_WHATSAPP_NUMBER:   "TWILIO_WHATSAPP_NUMBER",
  ANTHROPIC_API_KEY:        "ANTHROPIC_API_KEY",
  FIRMA_CO_API_KEY:         "FIRMA_CO_API_KEY",
  FIRMA_CO_WEBHOOK_SECRET:  "FIRMA_CO_WEBHOOK_SECRET",
  FIRMA_WEBHOOK_SECRET:     "FIRMA_CO_WEBHOOK_SECRET",  // alias
  FIRMA_API_KEY:            "FIRMA_CO_API_KEY",          // alias
  POSTHOG_API_KEY:          "POSTHOG_API_KEY",
  POSTHOG_HOST:             "POSTHOG_HOST",
  QSTASH_TOKEN:             "QSTASH_TOKEN",
  QSTASH_URL:               "QSTASH_TOKEN",              // alias
  QSTASH_CURRENT_SIGN:      "QSTASH_CURRENT_SIGNING_KEY",
  QSTASH_NEXT_SIGN:         "QSTASH_NEXT_SIGNING_KEY",
  QSTASH_CURRENT_SIGNING_KEY: "QSTASH_CURRENT_SIGNING_KEY",
  QSTASH_NEXT_SIGNING_KEY:    "QSTASH_NEXT_SIGNING_KEY",
  HELIUS_API_KEY:           "HELIUS_API_KEY",
  HELIUS_WEBHOOK_SECRET:    "HELIUS_WEBHOOK_SECRET",
  PROGRAM_ID:               "PROGRAM_ID",
  AUTHORITY_KEYPAIR_JSON:   "AUTHORITY_KEYPAIR_JSON",

  // ── Fase 0: Wompi / PSE Colombia ──────────────────────────────────────────
  WOMPI_PUBLIC_KEY:         "WOMPI_PUBLIC_KEY",
  WOMPI_PRIVATE_KEY:        "WOMPI_PRIVATE_KEY",
  WOMPI_EVENTS_KEY:         "WOMPI_EVENTS_KEY",

  // ── Fase 2: Switchboard V2 ────────────────────────────────────────────────
  SWITCHBOARD_FEED_PUBKEY:  "SWITCHBOARD_FEED_PUBKEY",
} as const satisfies Record<string, SecretKey>;

interface SecretsCache {
  values: Map<SecretKey, string>;
  loadedAt: number;
  ttlMs: number;
}

// ── Estado interno (singleton por proceso) ─────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutos de caché en memoria

let cache: SecretsCache = {
  values:   new Map(),
  loadedAt: 0,
  ttlMs:    CACHE_TTL_MS,
};

let infisicalClient: any = null;

// ── Inicializar cliente Infisical ──────────────────────────────────────────────

async function initInfisical() {
  if (infisicalClient) return infisicalClient;

  const environment = process.env.NODE_ENV === "production" ? "prod" : "dev";
  const siteUrl     = process.env.INFISICAL_SITE_URL ?? "https://app.infisical.com";
  const clientId    = process.env.INFISICAL_CLIENT_ID;
  const clientSecret= process.env.INFISICAL_CLIENT_SECRET;
  const projectId   = process.env.INFISICAL_PROJECT_ID;

  // Si no hay credenciales de Infisical, usar fallback de process.env
  // SOLO permitido en dev/CI, nunca en producción
  if (!clientId || !clientSecret || !projectId) {
    if (environment === "prod") {
      throw new Error(
        "[secrets] FATAL: En producción se requiere Infisical. " +
        "Configura INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET, INFISICAL_PROJECT_ID."
      );
    }
    console.warn("[secrets] Modo dev: usando process.env como fallback (NO usar en producción)");
    return null; // null = modo fallback
  }

  try {
    // Dynamic import para que no rompa el build si el SDK no está instalado
    const { InfisicalSDK } = await import("@infisical/sdk");
    infisicalClient = new InfisicalSDK({ siteUrl });

    await infisicalClient.auth().universalAuth.login({
      clientId,
      clientSecret,
    });

    console.info(`[secrets] Infisical autenticado · proyecto: ${projectId} · env: ${environment}`);
    return infisicalClient;
  } catch (err: any) {
    console.error("[secrets] Error inicializando Infisical:", err.message);
    throw err;
  }
}

// ── Cargar todos los secretos en caché ─────────────────────────────────────────

async function loadSecretsIntoCache(): Promise<void> {
  const now = Date.now();

  // Usar caché si es válida
  if (cache.values.size > 0 && now - cache.loadedAt < cache.ttlMs) {
    return;
  }

  const client    = await initInfisical();
  const projectId = process.env.INFISICAL_PROJECT_ID!;
  const environment = process.env.NODE_ENV === "production" ? "prod" : "dev";

  if (!client) {
    // Modo fallback: cargar desde process.env
    const knownKeys: SecretKey[] = [
      "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID", "CLOUDFLARE_ACCOUNT_ID",
      "SENTRY_DSN", "SENTRY_AUTH_TOKEN",
      "PRIVY_APP_ID", "PRIVY_APP_SECRET", "PRIVY_VERIFICATION_KEY",
      "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PUBLISHABLE_KEY",
      "MOONPAY_SECRET_KEY", "MOONPAY_PUBLISHABLE_KEY", "MOONPAY_WEBHOOK_SECRET",
      "RESEND_API_KEY",
      "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "TWILIO_WHATSAPP_NUMBER",
      "ANTHROPIC_API_KEY", "FIRMA_CO_API_KEY", "FIRMA_CO_WEBHOOK_SECRET",
      "POSTHOG_API_KEY", "POSTHOG_HOST",
      "QSTASH_TOKEN", "QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY",
      "HELIUS_API_KEY", "HELIUS_WEBHOOK_SECRET",
      "PROGRAM_ID",
    ];

    for (const key of knownKeys) {
      const val = process.env[key];
      if (val) cache.values.set(key, val);
    }

    cache.loadedAt = now;
    console.info(`[secrets] Fallback: ${cache.values.size} secrets cargados desde process.env`);
    return;
  }

  // Cargar desde Infisical
  const { secrets } = await client.secrets().listSecrets({
    projectId,
    environment,
    secretPath: "/",
    recursive:  true,
  });

  cache.values.clear();

  for (const secret of secrets) {
    cache.values.set(secret.secretKey as SecretKey, secret.secretValue);
  }

  cache.loadedAt = now;
  console.info(`[secrets] ${cache.values.size} secrets cargados desde Infisical`);
}

// ── API pública ────────────────────────────────────────────────────────────────

/**
 * Obtiene un secret por nombre.
 * Lanza error si el secret no existe (fail-fast — mejor que usar un valor vacío).
 *
 * @example
 *   const apiKey = await getSecret("ANTHROPIC_API_KEY");
 */
export async function getSecret(key: SecretKey): Promise<string> {
  await loadSecretsIntoCache();

  const value = cache.values.get(key);

  if (!value) {
    throw new Error(
      `[secrets] Secret '${key}' no encontrado. ` +
      `Verifica que esté configurado en Infisical (env: ${process.env.NODE_ENV}).`
    );
  }

  return value;
}

/**
 * Obtiene un secret por nombre, retorna undefined si no existe
 * (para secrets opcionales).
 */
export async function getSecretOptional(key: SecretKey): Promise<string | undefined> {
  await loadSecretsIntoCache();
  return cache.values.get(key);
}

/**
 * Obtiene múltiples secrets en paralelo.
 * @example
 *   const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } =
 *     await getSecrets(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
 */
export async function getSecrets<K extends SecretKey>(
  keys: K[]
): Promise<Record<K, string>> {
  await loadSecretsIntoCache();

  const result = {} as Record<K, string>;
  const missing: string[] = [];

  for (const key of keys) {
    const value = cache.values.get(key);
    if (!value) {
      missing.push(key);
    } else {
      result[key] = value;
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[secrets] Secrets faltantes: ${missing.join(", ")}. ` +
      `Configúralos en Infisical.`
    );
  }

  return result;
}

/**
 * Invalida el caché manualmente (útil después de rotar un secret).
 */
export function invalidateSecretsCache(): void {
  cache.values.clear();
  cache.loadedAt = 0;
  console.info("[secrets] Caché invalidado manualmente");
}

/**
 * Health check: verifica que Infisical está disponible y los secrets críticos existen.
 * Usar en /app/api/health/route.ts
 */
export async function checkSecretsHealth(): Promise<{
  ok: boolean;
  count: number;
  critical: Record<string, boolean>;
  mode: "infisical" | "env-fallback";
}> {
  try {
    await loadSecretsIntoCache();

    const critical: SecretKey[] = [
      "SENTRY_DSN",
      "PRIVY_APP_ID",
      "STRIPE_SECRET_KEY",
      "ANTHROPIC_API_KEY",
      "RESEND_API_KEY",
    ];

    const criticalStatus: Record<string, boolean> = {};
    for (const key of critical) {
      criticalStatus[key] = cache.values.has(key);
    }

    return {
      ok:       Object.values(criticalStatus).every(Boolean),
      count:    cache.values.size,
      critical: criticalStatus,
      mode:     infisicalClient ? "infisical" : "env-fallback",
    };
  } catch (err: any) {
    return {
      ok:       false,
      count:    0,
      critical: {},
      mode:     "env-fallback",
    };
  }
}
