/**
 * app/api/comms/sms/route.ts
 * OTP via SMS o WhatsApp usando Twilio.
 * runtime = nodejs — Twilio no funciona en Edge.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { sendOtp, verifyOtp } from "@/services/comms/twilio.adapter";
import { captureError } from "@/services/security/sentry.adapter";

export async function POST(req: NextRequest) {
  try {
    const { action, phone, code, channel = "sms" } = await req.json() as {
      action:   "send" | "verify";
      phone:    string;   // E.164: +573001234567
      code?:    string;
      channel?: "sms" | "whatsapp";
    };

    if (!phone) {
      return NextResponse.json({ error: "phone requerido (formato E.164)" }, { status: 400 });
    }

    if (action === "send") {
      await sendOtp({ phone, channel });
      return NextResponse.json({ sent: true });
    }

    if (action === "verify") {
      if (!code) return NextResponse.json({ error: "code requerido" }, { status: 400 });
      const { valid } = await verifyOtp({ phone, code });
      return NextResponse.json({ valid });
    }

    return NextResponse.json({ error: "action debe ser 'send' o 'verify'" }, { status: 400 });
  } catch (err: unknown) {
    captureError(err as Error, { context: "sms_otp" });
    return NextResponse.json({ error: "Error en servicio de OTP" }, { status: 500 });
  }
}
