/**
 * services/comms/resend.adapter.ts
 * SERVER-SIDE ONLY.
 *
 * Resend maneja todos los emails transaccionales:
 *  - Confirmación de KYC aprobado/revocado
 *  - Notificación de renta disponible para reclamar
 *  - Alertas de préstamo (vencimiento, LTV alto)
 *  - Confirmaciones de compra de tokens
 *  - Alertas de mantenimiento aprobado
 */

import { requireSecrets } from "@/services/secrets.service";
import { captureError }   from "@/services/security/sentry.adapter";

export interface EmailResult {
  ok:      boolean;
  id?:     string;   // ID del email en Resend
  error?:  string;
}

// ── Helper base ───────────────────────────────────────────────────────────────

async function send(payload: {
  to:      string | string[];
  subject: string;
  html:    string;
  replyTo?: string;
  tags?:   { name: string; value: string }[];
}): Promise<EmailResult> {
  try {
    const { RESEND_API_KEY, RESEND_FROM_EMAIL } = await requireSecrets([
      "RESEND_API_KEY",
      "RESEND_FROM_EMAIL",
    ]);

    const res = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from:     RESEND_FROM_EMAIL ?? "Mampostera <noreply@mampostera.co>",
        to:       Array.isArray(payload.to) ? payload.to : [payload.to],
        subject:  payload.subject,
        html:     payload.html,
        reply_to: payload.replyTo,
        tags:     payload.tags,
      }),
    });

    const json = await res.json() as Record<string, unknown>;

    if (!res.ok) {
      return { ok: false, error: json.message ?? `Resend error ${res.status}` };
    }

    return { ok: true, id: json.id };
  } catch (err) {
    captureError(err, { context: "resend_send", extra: { subject: payload.subject } });
    return {
      ok:    false,
      error: err instanceof Error ? err.message : "Email service error",
    };
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

/** Email genérico — para casos no cubiertos por las funciones específicas. */
export async function sendEmail(params: {
  to:      string;
  subject: string;
  html:    string;
}): Promise<EmailResult> {
  return send(params);
}

/** Notificación de renta disponible para reclamar. */
export async function sendRentNotification(params: {
  to:            string;
  walletDisplay: string;   // "7xKX...AsU"
  propertyName:  string;   // "Cra 7 #45-12, Bogotá"
  rentAmountSol: number;
  claimUrl:      string;
}): Promise<EmailResult> {
  return send({
    to:      params.to,
    subject: `💰 Tienes ${params.rentAmountSol.toFixed(4)} SOL de renta disponible`,
    tags:    [{ name: "type", value: "rent_notification" }],
    html: `
<!DOCTYPE html><html lang="es"><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:20px">
  <div style="border-radius:12px;border:1px solid #e5e7eb;padding:32px">
    <p style="color:#9945ff;font-weight:700;font-size:18px;margin:0 0 8px">⬡ Mampostera</p>
    <h1 style="font-size:22px;margin:0 0 16px;color:#111">Renta disponible</h1>
    <p style="color:#6b7280;margin:0 0 24px">
      Tu propiedad <strong>${params.propertyName}</strong> ha generado renta que puedes reclamar.
    </p>
    <div style="background:#f9fafb;border-radius:8px;padding:16px;margin:0 0 24px;text-align:center">
      <p style="color:#6b7280;margin:0 0 4px;font-size:13px">Total disponible</p>
      <p style="color:#14f195;font-size:28px;font-weight:800;margin:0">${params.rentAmountSol.toFixed(4)} SOL</p>
    </div>
    <a href="${params.claimUrl}" style="display:block;background:#14f195;color:#000;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
      Reclamar mi renta →
    </a>
    <p style="color:#9ca3af;font-size:12px;margin:20px 0 0;text-align:center">
      Wallet: ${params.walletDisplay} · mampostera.co
    </p>
  </div>
</body></html>`,
  });
}

/** KYC aprobado — bienvenida al inversor. */
export async function sendKycApprovalEmail(params: {
  to:           string;
  userName:     string;
  dashboardUrl: string;
}): Promise<EmailResult> {
  return send({
    to:      params.to,
    subject: "✅ Tu identidad ha sido verificada — Ya puedes invertir",
    tags:    [{ name: "type", value: "kyc_approved" }],
    html: `
<!DOCTYPE html><html lang="es"><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:20px">
  <div style="border-radius:12px;border:1px solid #e5e7eb;padding:32px">
    <p style="color:#9945ff;font-weight:700;font-size:18px;margin:0 0 8px">⬡ Mampostera</p>
    <h1 style="font-size:22px;margin:0 0 16px;color:#111">Verificación completada, ${params.userName}</h1>
    <p style="color:#6b7280;margin:0 0 24px">
      Tu identidad ha sido verificada exitosamente en la blockchain de Solana. 
      Ahora puedes invertir en propiedades fraccionadas en Colombia.
    </p>
    <a href="${params.dashboardUrl}" style="display:block;background:#9945ff;color:#fff;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
      Ver propiedades disponibles →
    </a>
  </div>
</body></html>`,
  });
}

/** KYC revocado — notificación de suspensión de cuenta. */
export async function sendKycRevokedEmail(params: {
  to:      string;
  reason?: string;
}): Promise<EmailResult> {
  return send({
    to:      params.to,
    subject: "⚠️ Tu acceso ha sido suspendido — Mampostera",
    tags:    [{ name: "type", value: "kyc_revoked" }],
    html: `
<!DOCTYPE html><html lang="es"><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:20px">
  <div style="border-radius:12px;border:1px solid #fca5a5;padding:32px">
    <p style="color:#9945ff;font-weight:700;font-size:18px;margin:0 0 8px">⬡ Mampostera</p>
    <h1 style="font-size:22px;margin:0 0 16px;color:#111">Acceso suspendido</h1>
    <p style="color:#6b7280;margin:0 0 16px">
      Tu cuenta ha sido suspendida por cumplimiento regulatorio.
      ${params.reason ? `<strong>Razón:</strong> ${params.reason}` : ""}
    </p>
    <p style="color:#6b7280;margin:0">
      Para apelar esta decisión, contáctanos en <a href="mailto:compliance@mampostera.co">compliance@mampostera.co</a>
    </p>
  </div>
</body></html>`,
  });
}

/** Alerta de préstamo — LTV alto o vencimiento próximo. */
export async function sendLoanAlert(params: {
  to:          string;
  alertType:   "ltv_warning" | "expiring_soon" | "defaulted";
  ltvPercent?: number;
  daysLeft?:   number;
  repayUrl:    string;
}): Promise<EmailResult> {
  const subjects = {
    ltv_warning:    `⚠️ Tu préstamo alcanzó el ${params.ltvPercent ?? 70}% LTV`,
    expiring_soon:  `⏰ Tu préstamo vence en ${params.daysLeft ?? 3} días`,
    defaulted:      "🔴 Tu préstamo está en mora — acción requerida",
  };

  return send({
    to:      params.to,
    subject: subjects[params.alertType],
    tags:    [{ name: "type", value: `loan_${params.alertType}` }],
    html: `
<!DOCTYPE html><html lang="es"><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:20px">
  <div style="border-radius:12px;border:1px solid #fca5a5;padding:32px">
    <p style="color:#9945ff;font-weight:700;font-size:18px;margin:0 0 8px">⬡ Mampostera</p>
    <h1 style="font-size:22px;margin:0 0 16px;color:#111">${subjects[params.alertType]}</h1>
    <p style="color:#6b7280;margin:0 0 24px">
      Repaga tu préstamo para liberar tu dNFT del escrow y evitar la liquidación automática.
    </p>
    <a href="${params.repayUrl}" style="display:block;background:#ef4444;color:#fff;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
      Repagar préstamo →
    </a>
  </div>
</body></html>`,
  });
}
