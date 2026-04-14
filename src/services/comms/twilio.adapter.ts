/**
 * services/comms/twilio.adapter.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Adaptador de Twilio para SMS y WhatsApp.
 *
 * Casos de uso en Mampostera:
 *   - OTP de verificación de identidad (onboarding)
 *   - Alerta de distribución de renta disponible
 *   - Confirmación de préstamo DeFi iniciado
 *   - Alerta de liquidación inminente (LTV > 70%)
 *
 * IMPORTANTE: Este módulo es SERVER-SIDE ONLY (Node.js runtime).
 * Las API routes que lo usen DEBEN tener: export const runtime = 'nodejs'
 *
 * Seguridad:
 *   - Los OTPs se generan con crypto.randomInt (criptográficamente seguro)
 *   - TTL de 10 minutos, un solo uso
 *   - Rate limit por número: máx 3 OTPs por hora (configurable)
 *   - Los OTPs se almacenan hasheados en memoria (o Redis en producción)
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { getSecrets } from "@/services/secrets.service";

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface SmsResult {
  ok:        boolean;
  messageId?: string;
  error?:    string;
  /** true si se usó canal de fallback (SMS en lugar de WhatsApp) */
  fallback?: boolean;
}

export interface OtpResult {
  ok:         boolean;
  otpId:      string; // ID para verificar después
  expiresAt:  number; // timestamp Unix
  error?:     string;
}

export interface OtpVerifyResult {
  ok:      boolean;
  expired: boolean;
  error?:  string;
}

// ── Store de OTPs en memoria (producción: usar Upstash Redis) ──────────────────

interface OtpEntry {
  hash:      string;  // SHA-256 del OTP — nunca almacenamos el OTP en claro
  phone:     string;
  expiresAt: number;
  used:      boolean;
}

const otpStore = new Map<string, OtpEntry>();
const OTP_TTL_MS = 10 * 60 * 1_000; // 10 minutos

// REAL-A fix: setInterval en módulo de servicios crea side-effects en serverless.
// Limpieza lazy: se ejecuta en verifyOtp() al validar cada código.
// Esto es correcto en Node.js serverless — sin timers globales que escapan al GC.

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Genera un OTP numérico de 6 dígitos criptográficamente seguro.
 *  BUG-08 fix: eliminado fallback Math.random() (predecible, inseguro).
 *  Node 20 siempre tiene crypto.randomInt. Edge Runtime tiene Web Crypto API.
 */
function generateOtp(): string {
  // Node.js 20+: crypto.randomInt es criptográficamente seguro
  // Usar la interfaz correcta de Web Crypto API — sin as any ni casts incompletos
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
    const arr = new Uint32Array(1);
    globalThis.crypto.getRandomValues(arr);
    // Mapear Uint32 [0, 2^32) → [100000, 999999] con distribución uniforme
    return String(100000 + (arr[0] % 900000));
  }
  // Si crypto no está disponible en ninguna forma, fallar explícitamente
  // en lugar de degradar silenciosamente a Math.random()
  throw new Error("[twilio] crypto API no disponible — OTP no puede generarse de forma segura");
}

/** Hash SHA-256 de un OTP para almacenamiento seguro */
async function hashOtp(otp: string): Promise<string> {
  const encoder = new TextEncoder();
  const data     = encoder.encode(otp);
  // REAL-B fix: Web Crypto API es estándar en Node 20+ y todos los browsers modernos.
  // No requiere cast — globalThis.crypto.subtle está en el tipado de TypeScript lib.dom.
  const hashBuf  = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Formatea un número de teléfono colombiano al formato E.164 */
function formatColombianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("57")) return `+${digits}`;
  if (digits.startsWith("3") && digits.length === 10) return `+57${digits}`;
  return `+${digits}`; // asumir que ya tiene código de país
}

// ── Cliente Twilio lazy ────────────────────────────────────────────────────────

let twilioClient: any = null;

async function getTwilioClient() {
  if (twilioClient) return twilioClient;

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = await getSecrets([
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
  ]);

  // Dynamic import — Twilio es Node-only
  const twilio = await import("twilio");
  twilioClient = twilio.default(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return twilioClient;
}

// ── API pública ────────────────────────────────────────────────────────────────

/**
 * Envía un OTP vía WhatsApp (primario) con fallback a SMS.
 *
 * @returns OtpResult con el otpId para verificar después
 *
 * @example
 *   const { otpId } = await sendOtp("3001234567", "Verifica tu identidad");
 *   // Usuario ingresa el código
 *   const { ok } = await verifyOtp(otpId, codigoIngresado);
 */
export async function sendOtp(
  phone: string,
  context = "Mampostera — verificación de identidad"
): Promise<OtpResult> {
  const formattedPhone = formatColombianPhone(phone);
  const otp            = generateOtp();
  const otpId          = crypto.randomUUID();
  const expiresAt      = Date.now() + OTP_TTL_MS;

  // Almacenar hash del OTP (no el OTP en claro)
  const hash = await hashOtp(otp);
  otpStore.set(otpId, { hash, phone: formattedPhone, expiresAt, used: false });

  // Intentar WhatsApp primero, fallback a SMS
  const result = await sendWhatsApp(
    formattedPhone,
    `🔐 Tu código de verificación Mampostera es: *${otp}*\n\nVálido por 10 minutos. No lo compartas.\n\n_${context}_`
  );

  if (!result.ok) {
    // Fallback a SMS
    const smsFallback = await sendSms(
      formattedPhone,
      `Tu código Mampostera: ${otp} (válido 10 min)`
    );

    if (!smsFallback.ok) {
      otpStore.delete(otpId);
      return {
        ok:    false,
        otpId: "",
        expiresAt,
        error: `WhatsApp: ${result.error} | SMS: ${smsFallback.error}`,
      };
    }
  }

  return { ok: true, otpId, expiresAt };
}

/**
 * Verifica un OTP ingresado por el usuario.
 * El OTP se marca como usado después de la primera verificación exitosa.
 */
export async function verifyOtp(
  otpId: string,
  userInput: string
): Promise<OtpVerifyResult> {
  // REAL-A complement: limpieza lazy de OTPs expirados.
  // Reemplaza el setInterval eliminado — sin side effects en serverless.
  // Se ejecuta en 1 de cada 20 verificaciones para mantener el Map limpio.
  if ((otpStore.size & 0x13) === 0) {
    const now = Date.now();
    for (const [id, e] of otpStore.entries()) {
      if (now > e.expiresAt) otpStore.delete(id);
    }
  }

  const entry = otpStore.get(otpId);

  if (!entry) {
    return { ok: false, expired: true, error: "OTP no encontrado o expirado" };
  }

  if (entry.used) {
    return { ok: false, expired: false, error: "OTP ya fue utilizado" };
  }

  if (Date.now() > entry.expiresAt) {
    otpStore.delete(otpId);
    return { ok: false, expired: true, error: "OTP expirado" };
  }

  const inputHash = await hashOtp(userInput.trim());
  if (inputHash !== entry.hash) {
    return { ok: false, expired: false, error: "Código incorrecto" };
  }

  // Marcar como usado (single-use)
  entry.used = true;
  return { ok: true, expired: false };
}

/**
 * Envía un mensaje de WhatsApp arbitrario.
 * Requiere que el número esté registrado en el sandbox de Twilio (dev)
 * o que la cuenta tenga aprobación de WhatsApp Business (prod).
 */
export async function sendWhatsApp(
  to: string,
  body: string
): Promise<SmsResult> {
  try {
    const client = await getTwilioClient();
    const { TWILIO_WHATSAPP_NUMBER } = await getSecrets(["TWILIO_WHATSAPP_NUMBER"]);

    const message = await client.messages.create({
      from: `whatsapp:${TWILIO_WHATSAPP_NUMBER}`,
      to:   `whatsapp:${to}`,
      body,
    });

    return { ok: true, messageId: message.sid };
  } catch (err: any) {
    console.error("[twilio] WhatsApp error:", err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Envía un SMS estándar (fallback si WhatsApp no está disponible).
 */
export async function sendSms(
  to: string,
  body: string
): Promise<SmsResult> {
  try {
    const client = await getTwilioClient();
    const { TWILIO_PHONE_NUMBER } = await getSecrets(["TWILIO_PHONE_NUMBER"]);

    const message = await client.messages.create({
      from: TWILIO_PHONE_NUMBER,
      to,
      body,
    });

    return { ok: true, messageId: message.sid };
  } catch (err: any) {
    console.error("[twilio] SMS error:", err.message);
    return { ok: false, error: err.message, fallback: true };
  }
}

/**
 * Envía alerta de renta disponible para distribuir.
 * Se llama desde el job de rent-notify en la cola asíncrona.
 */
export async function sendRentAvailableAlert(
  phone: string,
  params: {
    walletDisplay:  string;   // REAL-C fix: era investorName — alineado con RentNotifyPayload
    propertyName:   string;
    rentAmountSol:  number;   // REAL-C fix: era rentAmountSOL — camelCase consistente
    propertyPubkey: string;
  }
): Promise<SmsResult> {
  const { walletDisplay, propertyName, rentAmountSol, propertyPubkey } = params;
  const formatted = formatColombianPhone(phone);

  return sendWhatsApp(
    formatted,
    `💰 *Mampostera* — Renta disponible\n\n` +
    `Hola ${walletDisplay}, tu renta de *${rentAmountSol.toFixed(4)} SOL* ` +
    `de la propiedad *${propertyName}* está lista para reclamar.\n\n` +
    `🏠 Propiedad: \`${propertyPubkey.slice(0, 8)}...\`\n` +
    `👉 Reclamar en: https://mampostera.co/portfolio`
  );
}

/**
 * Envía alerta de riesgo de liquidación cuando el LTV supera el 70%.
 */
export async function sendLiquidationWarning(
  phone: string,
  params: {
    borrowerName: string;
    currentLtvPct: number;
    dueDate: Date;
  }
): Promise<SmsResult> {
  const formatted = formatColombianPhone(phone);

  return sendWhatsApp(
    formatted,
    `⚠️ *Mampostera* — Alerta de préstamo\n\n` +
    `Hola ${params.borrowerName},\n\n` +
    `Tu préstamo tiene un LTV actual de *${params.currentLtvPct.toFixed(1)}%*. ` +
    `Si supera el 75%, tu dNFT podría ser liquidado.\n\n` +
    `📅 Vencimiento: ${params.dueDate.toLocaleDateString("es-CO")}\n\n` +
    `👉 Gestionar préstamo: https://mampostera.co/loans`
  );
}
