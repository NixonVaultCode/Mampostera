/**
 * services/payments/moonpay.adapter.ts
 * SERVER-SIDE ONLY. export const runtime = 'nodejs' en las routes que lo usen.
 *
 * MoonPay es el on-ramp principal para Colombia/LATAM:
 *  - Soporta PSE (Pagos Seguros en Línea) — débito bancario directo
 *  - Soporta Efecty — pago en efectivo en puntos físicos
 *  - Soporta tarjetas débito/crédito colombianas
 *  - USDC nativo en Solana (sin wrapped tokens)
 *
 * PRINCIPIO DE FALLBACK (R2):
 * Si MoonPay devuelve error 5xx o está down, createOnRampWithFallback()
 * redirige automáticamente a Stripe. El usuario ve un error controlado,
 * nunca un crash de la app.
 */

import { requireSecrets } from "@/services/secrets.service";
import { captureError }   from "@/services/security/sentry.adapter";
import { createOnRampSession as stripeOnRamp } from "./stripe.adapter";

export interface MoonPayResult {
  ok:          boolean;
  widgetUrl?:  string;   // URL con firma para abrir el widget de MoonPay
  sessionId?:  string;
  error?:      string;
  provider:    "moonpay";
}

export interface OnRampResult {
  ok:          boolean;
  widgetUrl?:  string;
  clientSecret?: string;  // Solo para Stripe
  provider:    "moonpay" | "stripe";
  fallback:    boolean;   // true si se usó el proveedor secundario
  error?:      string;
}

// ── Crear URL firmada de MoonPay ──────────────────────────────────────────────

/**
 * Genera una URL firmada para el widget de MoonPay.
 * El usuario completa el pago en el widget y recibe USDC en su wallet Solana.
 *
 * @param walletAddress Dirección Solana del destinatario
 * @param amountUsd     Cantidad en USD (número entero, ej: 50 = $50)
 * @param currency      Moneda origen (default: "cop" para Colombia)
 */
export async function createMoonPayUrl(
  walletAddress: string,
  amountUsd:     number,
  currency = "cop"
): Promise<MoonPayResult> {
  try {
    const { MOONPAY_API_KEY, MOONPAY_SECRET_KEY } = await requireSecrets([
      "MOONPAY_API_KEY",
      "MOONPAY_SECRET_KEY",
    ]);

    // Parámetros del widget
    const params = new URLSearchParams({
      apiKey:              MOONPAY_API_KEY,
      currencyCode:        "usdc_sol",           // USDC en Solana
      walletAddress:       walletAddress,
      baseCurrencyCode:    currency,
      baseCurrencyAmount:  String(amountUsd),
      redirectURL:         `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/dashboard`,
      language:            "es",                  // Español para Colombia
      showOnlyCurrencies:  "cop,usd",
    });

    const baseUrl   = `https://buy.moonpay.com?${params.toString()}`;
    const signature = await signMoonPayUrl(baseUrl, MOONPAY_SECRET_KEY);
    const widgetUrl = `${baseUrl}&signature=${encodeURIComponent(signature)}`;

    return {
      ok:        true,
      widgetUrl,
      sessionId: `moonpay_${Date.now()}`,
      provider:  "moonpay",
    };
  } catch (err) {
    captureError(err, {
      context:       "moonpay_create_url",
      extra:         { walletAddress, amountUsd },
    });
    return {
      ok:       false,
      error:    err instanceof Error ? err.message : "MoonPay error",
      provider: "moonpay",
    };
  }
}

/**
 * Firma una URL de MoonPay con HMAC-SHA256.
 * MoonPay requiere que la URL esté firmada con el secret key.
 */
async function signMoonPayUrl(url: string, secret: string): Promise<string> {
  const encoder  = new TextEncoder();
  const keyData  = encoder.encode(secret);
  const urlData  = encoder.encode(url);

  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, urlData);
  return Buffer.from(signature).toString("base64");
}

// ── Verificar webhook de MoonPay ──────────────────────────────────────────────

/**
 * Verifica la autenticidad de un webhook de MoonPay.
 * MoonPay envía eventos cuando el pago es completado, fallido, etc.
 */
export async function verifyMoonPaySignature(
  body:      string,
  signature: string
): Promise<boolean> {
  try {
    const { MOONPAY_WEBHOOK_KEY } = await requireSecrets(["MOONPAY_WEBHOOK_KEY"]);
    const expected = await signMoonPayUrl(body, MOONPAY_WEBHOOK_KEY);
    return expected === signature;
  } catch {
    return false;
  }
}

// ── On-ramp con fallback automático (R2) ──────────────────────────────────────

/**
 * Crea una sesión de on-ramp intentando MoonPay primero.
 * Si MoonPay falla (error, timeout, no disponible), hace fallback a Stripe.
 *
 * IMPLEMENTA RESTRICCIÓN R2: Principio de Fallback.
 *
 * @param walletAddress Dirección Solana del destinatario
 * @param amountUsd     Cantidad en USD
 * @param preferredProvider Forzar un proveedor específico (para testing)
 */
export async function createOnRampWithFallback(
  walletAddress:     string,
  amountUsd:         number,
  preferredProvider?: "moonpay" | "stripe"
): Promise<OnRampResult> {
  // Forzar proveedor si se especifica (útil para tests A/B)
  if (preferredProvider === "stripe") {
    const result = await stripeOnRamp(walletAddress, amountUsd * 100);
    return {
      ok:           result.ok,
      clientSecret: result.clientSecret,
      provider:     "stripe",
      fallback:     false,
      error:        result.error,
    };
  }

  // Intentar MoonPay primero
  const moonpayResult = await createMoonPayUrl(walletAddress, amountUsd);

  if (moonpayResult.ok && moonpayResult.widgetUrl) {
    return {
      ok:        true,
      widgetUrl: moonpayResult.widgetUrl,
      provider:  "moonpay",
      fallback:  false,
    };
  }

  // MoonPay falló → fallback a Stripe
  console.warn(
    `[moonpay] Fallback a Stripe. Razón: ${moonpayResult.error ?? "unknown"}`
  );

  const stripeResult = await stripeOnRamp(walletAddress, amountUsd * 100);

  if (stripeResult.ok) {
    return {
      ok:           true,
      clientSecret: stripeResult.clientSecret,
      provider:     "stripe",
      fallback:     true,   // ← indica que se usó el proveedor de respaldo
    };
  }

  // Ambos fallaron → error controlado (no tumba la app)
  return {
    ok:       false,
    provider: "stripe",
    fallback: true,
    error:    "Servicio de pago temporalmente no disponible. Intenta de nuevo en unos minutos.",
  };
}
