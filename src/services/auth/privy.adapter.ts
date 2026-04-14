/**
 * services/auth/privy.adapter.ts
 * SERVER-SIDE ONLY. Importar solo en /app/api/** o middleware.ts
 *
 * Privy resuelve el mayor bloqueador de adopción de Mampostera:
 * el usuario promedio colombiano no tiene Phantom ni entiende seed phrases.
 * Privy permite login con Google/email → crea embedded wallet invisible.
 *
 * CONFLICTO RESUELTO:
 * Privy + Civic + wallet-adapter pueden colisionar si el orden de
 * providers es incorrecto. Ver app/providers.tsx para el orden correcto.
 */

import { requireSecrets } from "@/services/secrets.service";
import { captureError }   from "@/services/security/sentry.adapter";

export interface PrivyUser {
  id:            string;       // "did:privy:..."
  walletAddress: string | null; // embedded wallet Solana
  email:         string | null;
  phone:         string | null;
  createdAt:     Date;
  linkedAccounts: Array<{
    type:    "wallet" | "email" | "phone" | "google_oauth" | "twitter_oauth";
    address?: string;
    subject?: string;
  }>;
}

export interface PrivyVerifyResult {
  ok:     boolean;
  user?:  PrivyUser;
  userId?: string;
  error?: string;
}

// ── Verificar token JWT de Privy ──────────────────────────────────────────────

/**
 * Verifica el token de Privy desde el header Authorization o cookie.
 * Usar en middleware.ts o en API routes protegidas.
 *
 * @param token JWT de Privy (sin "Bearer ")
 */
export async function verifyPrivyToken(
  token: string
): Promise<PrivyVerifyResult> {
  try {
    const { PRIVY_APP_ID, PRIVY_APP_SECRET } = await requireSecrets([
      "PRIVY_APP_ID",
      "PRIVY_APP_SECRET",
    ]);

    // Privy usa su propia API para verificar tokens — no hay JWT local
    const res = await fetch("https://auth.privy.io/api/v1/users/me", {
      headers: {
        "privy-app-id":  PRIVY_APP_ID,
        "Authorization": `Bearer ${token}`,
        "privy-app-secret": PRIVY_APP_SECRET,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Privy verify failed: ${res.status} ${body}` };
    }

    const raw = await res.json() as Record<string, unknown>;

    const user: PrivyUser = {
      id:             raw.id,
      walletAddress:  raw.linked_accounts?.find(
        (a: any) => a.type === "wallet" && a.chain_type === "solana"
      )?.address ?? null,
      email:          raw.linked_accounts?.find(
        (a: any) => a.type === "email"
      )?.address ?? null,
      phone:          raw.linked_accounts?.find(
        (a: any) => a.type === "phone"
      )?.number ?? null,
      createdAt:      new Date(raw.created_at),
      linkedAccounts: raw.linked_accounts ?? [],
    };

    return { ok: true, user, userId: raw.id };
  } catch (err) {
    captureError(err, { context: "privy_verify_token" });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown Privy error",
    };
  }
}

/**
 * Obtiene el usuario completo de Privy por su DID.
 * Útil en rutas de admin o cuando necesitamos datos frescos del usuario.
 */
export async function getPrivyUser(userId: string): Promise<PrivyUser | null> {
  try {
    const { PRIVY_APP_ID, PRIVY_APP_SECRET } = await requireSecrets([
      "PRIVY_APP_ID",
      "PRIVY_APP_SECRET",
    ]);

    const res = await fetch(
      `https://auth.privy.io/api/v1/users/${userId}`,
      {
        headers: {
          "privy-app-id":     PRIVY_APP_ID,
          "privy-app-secret": PRIVY_APP_SECRET,
        },
      }
    );

    if (!res.ok) return null;
    const raw = await res.json() as Record<string, unknown>;

    return {
      id:             raw.id,
      walletAddress:  raw.linked_accounts?.find(
        (a: any) => a.type === "wallet" && a.chain_type === "solana"
      )?.address ?? null,
      email:          raw.linked_accounts?.find((a: any) => a.type === "email")?.address ?? null,
      phone:          raw.linked_accounts?.find((a: any) => a.type === "phone")?.number ?? null,
      createdAt:      new Date(raw.created_at),
      linkedAccounts: raw.linked_accounts ?? [],
    };
  } catch (err) {
    captureError(err, { context: "privy_get_user", extra: { userId } });
    return null;
  }
}

/**
 * Verifica la firma del webhook de Privy.
 * Usar en /api/webhooks/privy/route.ts
 */
export async function verifyPrivyWebhook(
  req: Request
): Promise<{ ok: boolean; event?: any; error?: string }> {
  try {
    const { PRIVY_WEBHOOK_SECRET } = await requireSecrets(["PRIVY_WEBHOOK_SECRET"]);
    const signature = req.headers.get("privy-signature");
    const body      = await req.text();

    if (!signature) {
      return { ok: false, error: "Missing privy-signature header" };
    }

    // Verificar HMAC-SHA256
    const encoder  = new TextEncoder();
    const keyData  = encoder.encode(PRIVY_WEBHOOK_SECRET);
    const msgData  = encoder.encode(body);

    const cryptoKey = await crypto.subtle.importKey(
      "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );

    const sigBytes = Buffer.from(signature, "hex");
    const valid    = await crypto.subtle.verify(
      "HMAC", cryptoKey, sigBytes, msgData
    );

    if (!valid) return { ok: false, error: "Invalid Privy webhook signature" };

    const event = JSON.parse(body);
    return { ok: true, event };
  } catch (err) {
    captureError(err, { context: "privy_webhook_verify" });
    return { ok: false, error: "Webhook verification error" };
  }
}

/**
 * Factory para crear el handler de webhooks de Privy.
 * Procesa eventos de login, wallet vinculada, etc.
 */
export function createPrivyWebhookHandler(handlers: {
  onUserCreated?:      (user: PrivyUser) => Promise<void>;
  onWalletLinked?:     (userId: string, walletAddress: string) => Promise<void>;
  onUserAuthenticated?: (userId: string) => Promise<void>;
}) {
  return async function handlePrivyWebhook(event: any) {
    switch (event.type) {
      case "user.created":
        await handlers.onUserCreated?.({
          id:             event.data.id,
          walletAddress:  null,
          email:          event.data.email?.address ?? null,
          phone:          null,
          createdAt:      new Date(event.data.created_at),
          linkedAccounts: [],
        });
        break;
      case "user.linked_account":
        if (event.data.linked_account?.type === "wallet") {
          await handlers.onWalletLinked?.(
            event.data.user.id,
            event.data.linked_account.address
          );
        }
        break;
      case "user.authenticated":
        await handlers.onUserAuthenticated?.(event.data.user.id);
        break;
    }
  };
}
