/**
 * app/api/auth/privy/route.ts
 * Webhook de Privy — se llama cuando un usuario crea o vincula su wallet.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { verifyPrivyWebhook } from "@/services/auth/privy.adapter";
import { trackEvent, MamposteraEvents } from "@/services/analytics/posthog.adapter";
import { captureError } from "@/services/security/sentry.adapter";

export async function POST(req: NextRequest) {
  try {
    const body      = await req.text();
    const signature = req.headers.get("privy-signature") ?? "";

    const event = await verifyPrivyWebhook(body, signature);

    if (event.type === "user.created" || event.type === "user.linked_account") {
      await trackEvent(event.userId, MamposteraEvents.WALLET_CONNECTED, {
        walletType: event.walletType,
        country:    req.headers.get("cf-ipcountry") ?? "unknown",
      });
    }

    return NextResponse.json({ received: true });
  } catch (err: unknown) {
    captureError(err as Error, { context: "privy_webhook" });
    return NextResponse.json({ error: "Webhook error" }, { status: 400 });
  }
}
