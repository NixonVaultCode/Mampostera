/**
 * app/api/comms/email/route.ts
 * Envío de emails transaccionales via Resend.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { sendEmail, EmailTemplate } from "@/services/comms/resend.adapter";
import { captureError } from "@/services/security/sentry.adapter";

export async function POST(req: NextRequest) {
  try {
    const { template, to, data } = await req.json() as {
      template: EmailTemplate;
      to:       string;
      data:     Record<string, unknown>;
    };

    if (!template || !to) {
      return NextResponse.json({ error: "template y to son requeridos" }, { status: 400 });
    }

    await sendEmail({ template, to, data });
    return NextResponse.json({ sent: true });
  } catch (err: unknown) {
    captureError(err as Error, { context: "send_email" });
    return NextResponse.json({ error: "Error enviando email" }, { status: 500 });
  }
}
