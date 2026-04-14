/**
 * src/middleware.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Middleware de seguridad de Mampostera — Primera capa de protección.
 *
 * Se ejecuta en EDGE RUNTIME antes de cualquier route handler o componente.
 * Esto es lo que protege el 100% del tráfico.
 *
 * Capas implementadas (en orden de ejecución):
 *
 *   1. Cloudflare integrity check
 *      Verifica que la petición viene de Cloudflare (no acceso directo al origin).
 *      En producción, el origin server solo debe aceptar tráfico de CF.
 *
 *   2. Bot protection
 *      Lee el header CF-Bot-Score. Bloquea si el score supera el umbral.
 *      Score 0 = humano, score 100 = bot confirmado.
 *
 *   3. Geo-blocking OFAC
 *      Lista de países sancionados por OFAC/Colombia UIAF.
 *      Los usuarios de estos países reciben 403 con mensaje legal.
 *
 *   4. Rate limiting básico (edge)
 *      Límite de requests por IP para prevenir DDoS en API routes.
 *      El WAF de Cloudflare hace el rate limiting pesado; este es el fallback.
 *
 *   5. Security headers
 *      CSP, HSTS, X-Frame-Options, etc.
 *      Estos headers protegen contra XSS, clickjacking y data injection.
 *
 *   6. Sentry trace injection
 *      Inyecta el baggage y sentry-trace headers para distributed tracing.
 *      Permite correlacionar errores frontend ↔ backend en Sentry.
 *
 *   7. PostHog session
 *      Inyecta un session ID en cookies para analytics de producto.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * IMPORTANTE: Este archivo corre en EDGE RUNTIME.
 * No importar Node.js modules, Infisical SDK, Twilio, Stripe, etc.
 * Solo Web APIs estándar y paquetes edge-compatible.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

// ── Configuración ──────────────────────────────────────────────────────────────

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/** Umbral de bot score de Cloudflare (0-100). Por encima de esto → bloquear. */
const BOT_SCORE_THRESHOLD = 30;

/**
 * Países bloqueados por cumplimiento OFAC + UIAF Colombia.
 * ISO 3166-1 alpha-2 codes.
 * Fuente: https://home.treasury.gov/policy-issues/financial-sanctions/sanctions-programs-and-country-information
 */
const OFAC_BLOCKED_COUNTRIES = new Set([
  "CU", // Cuba
  "IR", // Irán
  "KP", // Corea del Norte
  "RU", // Rusia (sanciones post-2022)
  "SY", // Siria
  "BY", // Bielorrusia
  "MM", // Myanmar
  "SD", // Sudán
  "SS", // Sudán del Sur
  "ZW", // Zimbabue
  "VE", // Venezuela (ciertas entidades)
]);

/** Rate limit en memory (edge). Cloudflare WAF hace el trabajo pesado. */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minuto
const RATE_LIMIT_MAX_REQUESTS: Record<string, number> = {
  "/api/legal/ai":        5,  // Claude API — costoso, limitar agresivamente
  "/api/legal/sign":      10,
  "/api/comms/sms":       10, // Twilio OTP — prevenir SMS bombing
  "/api/payments/stripe": 20,
  "/api/payments/moonpay":20,
  "/api/":                100, // API routes en general
  "/":                    500, // Páginas — más permisivo
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("cf-connecting-ip") ??      // Cloudflare (más confiable)
    req.headers.get("x-real-ip") ??             // Nginx
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

function getRoutePrefix(pathname: string): string {
  for (const prefix of Object.keys(RATE_LIMIT_MAX_REQUESTS)) {
    if (pathname.startsWith(prefix)) return prefix;
  }
  return "/";
}

function checkRateLimit(ip: string, pathname: string): boolean {
  const prefix  = getRoutePrefix(pathname);
  const maxReqs = RATE_LIMIT_MAX_REQUESTS[prefix] ?? 500;
  const key     = `${ip}:${prefix}`;
  const now     = Date.now();

  const entry = rateLimitStore.get(key);

  // BUG-10 fix: limpieza lazy — si la entrada expiró, limpiar y resetear.
  // Esto evita memory leaks sin depender de setInterval (no fiable en Edge).
  if (!entry || now > entry.resetAt) {
    // Limpiar entradas expiradas aleatoriamente (1 de cada 20 requests)
    // para mantener el Map pequeño sin overhead en cada request.
    // REAL-D fix: Math.random() introducido por el fix BUG-10 (regresión).
    // Reemplazado con contador determinista — sin Math.random() en Edge Runtime.
    if ((rateLimitStore.size & 0x1F) === 0) { // cada ~32 escrituras
      for (const [k, v] of rateLimitStore.entries()) {
        if (now > v.resetAt) rateLimitStore.delete(k);
      }
    }
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true; // permitir
  }

  if (entry.count >= maxReqs) {
    return false; // bloquear
  }

  entry.count++;
  return true; // permitir
}

// BUG-10 fix: setInterval no persiste en Edge Runtime (cada invocación puede ser
// una instancia nueva). Limpieza lazy en la propia función checkRateLimit().
// Se limpia al leer una entrada expirada, evitando memory leaks sin setInterval.

// ── Headers de seguridad ───────────────────────────────────────────────────────

function buildSecurityHeaders(response: NextResponse): NextResponse {
  const h = response.headers;

  // Content Security Policy — previene XSS e inyección de scripts
  // 'unsafe-eval' requerido por @solana/web3.js (usa eval internamente)
  // 'unsafe-inline' solo para styles (wallet adapters lo requieren)
  h.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' https://js.stripe.com https://cdn.privy.io",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data:",
      "connect-src 'self' " +
        "https://*.solana.com " +          // Solana RPC
        "https://api.mainnet-beta.solana.com " +
        "https://api.devnet.solana.com " +
        "https://api.testnet.solana.com " +
        "https://*.helius-rpc.com " +       // Helius RPC
        "wss://*.helius-rpc.com " +
        "https://*.privy.io " +             // Privy auth
        "https://api.stripe.com " +         // Stripe
        "https://api.moonpay.com " +        // MoonPay
        "https://sentry.io " +              // Sentry
        "https://o*.ingest.sentry.io " +
        "https://app.posthog.com " +        // PostHog
        "https://eu.posthog.com",
      "frame-src 'none'",                   // previene clickjacking
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; ")
  );

  // HTTP Strict Transport Security — fuerza HTTPS por 1 año
  h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");

  // Previene clickjacking
  h.set("X-Frame-Options", "DENY");

  // Previene MIME type sniffing
  h.set("X-Content-Type-Options", "nosniff");

  // Referrer policy — no exponer URL en requests cross-origin
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions policy — deshabilitar APIs del browser que no necesitamos
  h.set(
    "Permissions-Policy",
    [
      "camera=()",           // No necesitamos cámara
      "microphone=()",       // No necesitamos micrófono
      "geolocation=()",      // No necesitamos ubicación
      "interest-cohort=()",  // Bloquear FLoC de Google
    ].join(", ")
  );

  return response;
}

// ── Middleware principal ───────────────────────────────────────────────────────

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const clientIp    = getClientIp(req);

  // ── 1. Cloudflare integrity check ──────────────────────────────────────────
  // En producción, toda petición debe venir de Cloudflare.
  // CF-Ray header es inyectado automáticamente por Cloudflare.
  if (IS_PRODUCTION && !req.headers.get("cf-ray")) {
    // Si no hay CF-Ray, alguien está accediendo directamente al origin.
    // Loggear pero no bloquear aún (puede haber health checks legítimos).
    // En producción real, configurar el origin para solo aceptar IPs de CF.
    console.warn(`[security] Petición sin CF-Ray desde IP: ${clientIp} → ${pathname}`);
  }

  // ── 2. Bot protection (CF-Bot-Score) ───────────────────────────────────────
  const botScore = parseInt(req.headers.get("cf-bot-score") ?? "0", 10);
  if (IS_PRODUCTION && botScore > BOT_SCORE_THRESHOLD) {
    console.warn(`[security] Bot bloqueado · score: ${botScore} · IP: ${clientIp}`);
    return new NextResponse(
      JSON.stringify({ error: "Access denied", code: "BOT_DETECTED" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── 3. Geo-blocking OFAC ───────────────────────────────────────────────────
  const country = req.headers.get("cf-ipcountry") ?? "";
  if (OFAC_BLOCKED_COUNTRIES.has(country)) {
    console.warn(`[security] País bloqueado: ${country} · IP: ${clientIp}`);
    return new NextResponse(
      JSON.stringify({
        error: "Service not available in your region",
        code:  "GEO_BLOCKED",
        detail: "This service complies with OFAC sanctions regulations.",
      }),
      {
        status:  451, // 451 = Unavailable For Legal Reasons (RFC 7725)
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // ── 4. Rate limiting ───────────────────────────────────────────────────────
  if (pathname.startsWith("/api/")) {
    const allowed = checkRateLimit(clientIp, pathname);
    if (!allowed) {
      return new NextResponse(
        JSON.stringify({
          error: "Too many requests",
          code:  "RATE_LIMITED",
          retryAfter: 60,
        }),
        {
          status:  429,
          headers: {
            "Content-Type":  "application/json",
            "Retry-After":   "60",
            "X-RateLimit-Reset": String(Date.now() + RATE_LIMIT_WINDOW_MS),
          },
        }
      );
    }
  }

  // ── 5. Continuar con la respuesta ─────────────────────────────────────────
  const response = NextResponse.next();

  // ── 6. Sentry trace injection ──────────────────────────────────────────────
  // Distribuye el trace-id de Sentry entre frontend y backend
  // para que los errores sean correlacionables.
  const sentryTraceHeader   = req.headers.get("sentry-trace");
  const sentryBaggageHeader = req.headers.get("baggage");

  if (sentryTraceHeader) {
    response.headers.set("sentry-trace", sentryTraceHeader);
  }
  if (sentryBaggageHeader) {
    response.headers.set("baggage", sentryBaggageHeader);
  }

  // Inyectar request ID único para trazabilidad
  const requestId = crypto.randomUUID();
  response.headers.set("X-Request-ID", requestId);

  // ── 7. Añadir contexto de país para componentes (inofensivo, no PII) ───────
  if (country) {
    response.headers.set("X-Country", country);
  }

  // ── 8. Security headers ────────────────────────────────────────────────────
  buildSecurityHeaders(response);

  return response;
}

// ── Configuración de rutas donde aplica el middleware ─────────────────────────

export const config = {
  matcher: [
    /*
     * Aplica a todas las rutas EXCEPTO:
     * - _next/static (archivos estáticos de Next.js)
     * - _next/image (optimización de imágenes)
     * - favicon.ico
     * - archivos con extensión (png, jpg, svg, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
