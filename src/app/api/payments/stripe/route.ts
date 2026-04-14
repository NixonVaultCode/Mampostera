/**
 * app/api/payments/stripe/route.ts
 * Crea una sesión de Stripe para on-ramp fiat → USDC.
 * runtime = nodejs porque usa el Node SDK de Stripe.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createOnRampSession } from "@/services/payments/stripe.adapter";
import { requireSecrets, SecretKey } from "@/services/secrets.service";
import { captureError } from "@/services/security/sentry.adapter";

export async function POST(req: NextRequest) {
  try {
    await requireSecrets([SecretKey.STRIPE_SECRET_KEY]);

    const { amountUsdc, walletAddress, propertyId } = await req.json() as {
      amountUsdc:    number;
      walletAddress: string;
      propertyId?:   string;
    };

    if (!amountUsdc || amountUsdc < 1) {
      return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
    }
    if (!walletAddress) {
      return NextResponse.json({ error: "walletAddress requerido" }, { status: 400 });
    }

    const session = await createOnRampSession({ amountUsdc, walletAddress, propertyId });
    return NextResponse.json(session);
  } catch (err: unknown) {
    captureError(err as Error, { context: "stripe_onramp" });
    return NextResponse.json({ error: "Error creando sesión de pago" }, { status: 500 });
  }
}
