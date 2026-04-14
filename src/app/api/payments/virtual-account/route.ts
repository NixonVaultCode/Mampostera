/**
 * app/api/payments/virtual-account/route.ts
 *
 * R13: Cuenta virtual COP — renta automática en pesos colombianos.
 *
 * Flujo:
 *   1. Inversor vincula su número de celular (Nequi) o banco
 *   2. Cuando se distribuye renta on-chain (webhook Helius: RentClaimed),
 *      el sistema convierte SOL → USDC → COP via Bitso Colombia
 *      y transfiere automáticamente a la cuenta vinculada
 *   3. El inversor recibe WhatsApp: "Recibiste $47.320 COP de renta"
 *
 * Proveedores:
 *   - Treinta (neo-bank colombiano): API de desembolso a cuentas bancarias
 *   - Bold (fintech CO): transferencias inmediatas a Nequi
 *   - Fallback: Wompi disbursement API
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse }        from "next/server";
import { z }                                from "zod";
import { getDb }                            from "@/v2/db/client";
import { users }                            from "@/v2/db/schema";
import { eq }                               from "drizzle-orm";
import { getSecret, SecretKey }             from "@/services/secrets.service";
import { captureError }                     from "@/services/security/sentry.adapter";
import { sendWhatsApp }                     from "@/services/comms/twilio.adapter";

// ── Schema ────────────────────────────────────────────────────────────────────

const LinkAccountSchema = z.object({
  action:        z.enum(["link", "unlink", "convert_and_send"]),
  walletAddress: z.string().min(32),
  // Para "link":
  phone?:        z.string().regex(/^\+57\d{10}$/).optional(),
  bankAccount?:  z.string().min(10).max(20).optional(),
  bankCode?:     z.string().length(3).optional(),  // código SWIFT/ABA
  // Para "convert_and_send":
  amountLamports?: z.number().int().positive().optional(),
});

type VirtualAccountAction = z.infer<typeof LinkAccountSchema>;

// ── Tasa de cambio (en producción: API de Bancolombia o Fixer.io) ─────────────
const SOL_TO_COP_RATE = 850_000;   // 1 SOL ≈ $850.000 COP (actualizar con Fixer API)
const LAMPORTS_PER_SOL = 1_000_000_000;

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: VirtualAccountAction;
  try {
    body = LinkAccountSchema.parse(await req.json());
  } catch (err) {
    const issues = err instanceof z.ZodError
      ? err.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ")
      : "Payload inválido";
    return NextResponse.json({ error: issues }, { status: 400 });
  }

  try {
    const db = await getDb();

    if (body.action === "link") {
      // Guardar la cuenta virtual vinculada en la tabla users
      await db
        .update(users)
        .set({
          phoneE164:  body.phone ?? null,
          // virtualBankAccount y bankCode se añadirían al schema en producción
          updatedAt:  new Date(),
        })
        .where(eq(users.walletAddress, body.walletAddress));

      return NextResponse.json({
        ok:      true,
        message: `Cuenta vinculada para ${body.phone ?? body.bankAccount}`,
        provider: body.phone ? "nequi" : "bancolombia",
      });
    }

    if (body.action === "unlink") {
      await db
        .update(users)
        .set({ phoneE164: null, updatedAt: new Date() })
        .where(eq(users.walletAddress, body.walletAddress));

      return NextResponse.json({ ok: true, message: "Cuenta desvinculada" });
    }

    if (body.action === "convert_and_send") {
      if (!body.amountLamports) {
        return NextResponse.json({ error: "amountLamports requerido" }, { status: 400 });
      }

      // Obtener cuenta vinculada del usuario
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.walletAddress, body.walletAddress))
        .limit(1);

      if (!user?.phoneE164) {
        return NextResponse.json({
          error: "Sin cuenta vinculada — vincular primero con action=link",
        }, { status: 400 });
      }

      // Calcular monto en COP
      const amountCop = Math.round(
        (body.amountLamports / LAMPORTS_PER_SOL) * SOL_TO_COP_RATE
      );

      if (amountCop < 1_000) {
        return NextResponse.json({
          error: "Monto mínimo de conversión: $1.000 COP",
        }, { status: 400 });
      }

      // En producción: llamar API de Treinta o Bold para el desembolso
      // Aquí simulamos el resultado y enviamos notificación WhatsApp
      const conversionResult = await _simulateConversion({
        walletAddress: body.walletAddress,
        amountLamports: body.amountLamports,
        amountCop,
        phone: user.phoneE164,
      });

      // Notificación WhatsApp
      if (user.phoneE164) {
        await sendWhatsApp(
          user.phoneE164,
          `💰 *Mampostera* — Renta recibida\n\n` +
          `Recibiste *$${amountCop.toLocaleString("es-CO")} COP* de tu inversión.\n` +
          `SOL convertidos: ${(body.amountLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL\n\n` +
          `El dinero llegará a tu Nequi en los próximos minutos.`
        ).catch(() => {}); // Non-blocking
      }

      return NextResponse.json({
        ok:        true,
        amountCop,
        amountSol: body.amountLamports / LAMPORTS_PER_SOL,
        phone:     user.phoneE164,
        provider:  "nequi",
        ...conversionResult,
      });
    }

    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });

  } catch (err) {
    captureError(err as Error, { context: "virtual_account" });
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// ── Simulación de conversión (reemplazar con Bold/Treinta API en producción) ──
async function _simulateConversion(params: {
  walletAddress: string;
  amountLamports: number;
  amountCop: number;
  phone: string;
}) {
  // TODO producción:
  // 1. POST https://api.bold.co/v1/disbursements con amountCop + phone
  // 2. Bold transfiere a Nequi instantáneamente
  // 3. Retornar el disbursement_id para tracking
  return {
    disbursementId: `sim_${Date.now()}`,
    estimatedArrival: "2-5 minutos",
    conversionRate: SOL_TO_COP_RATE,
    provider: "bold_simulated",
  };
}
