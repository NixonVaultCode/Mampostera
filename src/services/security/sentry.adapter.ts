/**
 * services/security/sentry.adapter.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Adaptador de Sentry para Mampostera.
 *
 * SEGURIDAD CRÍTICA:
 * Este adaptador implementa un redactor automático de campos sensibles.
 * Sentry captura automáticamente req/res bodies en API routes.
 * Sin este redactor, keypairs, seeds y private keys quedarían en los logs.
 *
 * Campos que se redactan automáticamente:
 *   secretKey, keypair, privateKey, seed, mnemonic, authority,
 *   AUTHORITY_KEYPAIR_JSON, password, token (en bodies de auth)
 *
 * Uso:
 *   import { captureError, captureMessage } from "@/services/security/sentry.adapter";
 *   captureError(err, { userId: wallet, context: "claim_rent" });
 * ──────────────────────────────────────────────────────────────────────────────
 */

import * as Sentry from "@sentry/nextjs";

// ── Campos a redactar en TODOS los eventos ─────────────────────────────────────

const REDACTED_KEYS = new Set([
  "secretKey",
  "keypair",
  "privateKey",
  "private_key",
  "seed",
  "mnemonic",
  "seedPhrase",
  "seed_phrase",
  "authority",
  "AUTHORITY_KEYPAIR_JSON",
  "password",
  "passwd",
  "secret",
  "api_key",
  "apiKey",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "clientSecret",
  "client_secret",
  "authToken",
  "auth_token",
  "PRIVY_APP_SECRET",
  "STRIPE_SECRET_KEY",
  "ANTHROPIC_API_KEY",
  "TWILIO_AUTH_TOKEN",
  "FIRMA_CO_API_KEY",
]);

const REDACTED_VALUE = "[REDACTED]";

// ── Redactor recursivo ─────────────────────────────────────────────────────────

function redactSensitiveFields(obj: unknown, depth = 0): unknown {
  // Limitar profundidad para evitar stack overflow en objetos circulares
  if (depth > 10 || obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    // Redactar si parece un keypair JSON (array de bytes Solana)
    if (obj.startsWith("[") && obj.length > 100) {
      try {
        const parsed = JSON.parse(obj);
        if (Array.isArray(parsed) && parsed.length === 64) {
          return REDACTED_VALUE;
        }
      } catch {}
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    // Si es un array de 64 números (keypair Solana), redactar
    if (obj.length === 64 && obj.every((n) => typeof n === "number")) {
      return REDACTED_VALUE;
    }
    return obj.map((item) => redactSensitiveFields(item, depth + 1));
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(key)) {
        result[key] = REDACTED_VALUE;
      } else {
        result[key] = redactSensitiveFields(value, depth + 1);
      }
    }
    return result;
  }

  return obj;
}

// ── Inicialización (llamar en sentry.server.config.ts) ─────────────────────────

export function configureSentryRedactor() {
  Sentry.addEventProcessor((event) => {
    // Redactar request body
    if (event.request?.data) {
      event.request.data = redactSensitiveFields(event.request.data);
    }

    // Redactar query string
    if (event.request?.query_string) {
      if (typeof event.request.query_string === "object") {
        event.request.query_string = redactSensitiveFields(
          event.request.query_string
        ) as Record<string, string>;
      }
    }

    // Redactar headers sensibles
    if (event.request?.headers) {
      const headers = event.request.headers as Record<string, string>;
      const sensitiveHeaders = ["authorization", "cookie", "x-api-key", "x-privy-token"];
      for (const h of sensitiveHeaders) {
        if (headers[h]) headers[h] = REDACTED_VALUE;
      }
    }

    // Redactar variables de contexto adicional
    if (event.extra) {
      event.extra = redactSensitiveFields(event.extra) as Record<string, unknown>;
    }

    // Redactar contexts
    if (event.contexts) {
      event.contexts = redactSensitiveFields(event.contexts) as typeof event.contexts;
    }

    return event;
  });
}

// ── API pública del adaptador ──────────────────────────────────────────────────

export interface SentryContext {
  /** Pubkey de la wallet del usuario (segura de loggear — es pública) */
  walletAddress?: string;
  /** ID de la propiedad on-chain */
  propertyId?: string | number;
  /** Nombre de la instrucción Anchor que falló */
  anchorInstruction?: string;
  /** Contexto descriptivo de la operación */
  context?: string;
  /** Tags adicionales para filtrado en Sentry */
  tags?: Record<string, string>;
  /** Datos extra (se redactan automáticamente) */
  extra?: Record<string, unknown>;
  /** Level de severidad */
  level?: Sentry.SeverityLevel;
}

/**
 * Captura un error con contexto de Mampostera.
 * Los campos sensibles se redactan automáticamente.
 *
 * @example
 *   captureError(err, {
 *     walletAddress: "7xKX...AsU",
 *     anchorInstruction: "claim_rent",
 *     context: "Fallo distribuyendo renta — epoch 42",
 *   });
 */
export function captureError(
  error: unknown,
  ctx: SentryContext = {}
): string {
  return Sentry.withScope((scope) => {
    // Tags estructurados para filtrado en dashboard
    scope.setTag("app", "mampostera");
    scope.setTag("layer", "api");

    if (ctx.walletAddress) scope.setTag("wallet", ctx.walletAddress);
    if (ctx.propertyId)    scope.setTag("property_id", String(ctx.propertyId));
    if (ctx.anchorInstruction) scope.setTag("anchor_ix", ctx.anchorInstruction);
    if (ctx.context)       scope.setTag("operation", ctx.context);

    if (ctx.tags) {
      for (const [k, v] of Object.entries(ctx.tags)) {
        scope.setTag(k, v);
      }
    }

    // Contexto extra (redactado automáticamente por el processor)
    if (ctx.extra) {
      scope.setExtras(redactSensitiveFields(ctx.extra) as Record<string, unknown>);
    }

    if (ctx.level) scope.setLevel(ctx.level);

    return Sentry.captureException(error);
  });
}

/**
 * Captura un mensaje informativo (no es un error).
 * Útil para tracking de operaciones importantes on-chain.
 */
export function captureMessage(
  message: string,
  ctx: SentryContext = {}
): string {
  return Sentry.withScope((scope) => {
    scope.setTag("app", "mampostera");
    if (ctx.walletAddress)     scope.setTag("wallet", ctx.walletAddress);
    if (ctx.anchorInstruction) scope.setTag("anchor_ix", ctx.anchorInstruction);
    if (ctx.context)           scope.setTag("operation", ctx.context);
    if (ctx.tags) {
      for (const [k, v] of Object.entries(ctx.tags)) scope.setTag(k, v);
    }

    return Sentry.captureMessage(message, ctx.level ?? "info");
  });
}

/**
 * Wrapper para instrumentar funciones server-side con Sentry.
 * Captura el error automáticamente y lo re-lanza.
 *
 * @example
 *   const result = await withSentrySpan(
 *     "distribute_rent",
 *     () => program.methods.claimRent().rpc(),
 *     { walletAddress: investor }
 *   );
 */
export async function withSentrySpan<T>(
  operation: string,
  fn: () => Promise<T>,
  ctx: SentryContext = {}
): Promise<T> {
  return Sentry.startSpan(
    {
      name: operation,
      op:   "mampostera.operation",
      attributes: {
        wallet:    ctx.walletAddress ?? "unknown",
        property:  String(ctx.propertyId ?? ""),
        anchor_ix: ctx.anchorInstruction ?? "",
      },
    },
    async () => {
      try {
        return await fn();
      } catch (err) {
        captureError(err, { ...ctx, context: operation });
        throw err;
      }
    }
  );
}

/**
 * Identifica al usuario en Sentry cuando conecta su wallet.
 * Solo usa la wallet (dirección pública — segura). Nunca PII.
 */
export function identifyUser(walletAddress: string) {
  Sentry.setUser({
    id:       walletAddress,
    username: `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`,
  });
}

/**
 * Limpia la identidad del usuario cuando desconecta la wallet.
 */
export function clearUser() {
  Sentry.setUser(null);
}

// ── Re-export de funciones de Sentry que pueden ser útiles ────────────────────
export { Sentry };
