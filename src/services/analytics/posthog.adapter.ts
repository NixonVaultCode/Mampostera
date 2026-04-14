/**
 * services/analytics/posthog.adapter.ts
 * PostHog — analytics de producto + feature flags.
 * Server-side usa posthog-node. Browser usa posthog-js (en providers.tsx).
 */

import { PostHog } from "posthog-node";
import { getSecret, SecretKey } from "../secrets.service";

let _client: PostHog | null = null;

async function getClient(): Promise<PostHog> {
  if (_client) return _client;
  const [apiKey, host] = await Promise.all([
    getSecret(SecretKey.POSTHOG_API_KEY),
    getSecret(SecretKey.POSTHOG_HOST, { throwIfMissing: false, defaultValue: "https://app.posthog.com" }),
  ]);
  _client = new PostHog(apiKey, { host, flushAt: 20, flushInterval: 10_000 });
  return _client;
}

/** Captura un evento de producto (server-side) */
export async function trackEvent(
  distinctId: string,  // wallet address o session ID
  event: string,
  properties?: Record<string, unknown>
): Promise<void> {
  try {
    const client = await getClient();
    client.capture({ distinctId, event, properties: properties ?? {} });
  } catch (e) {
    console.warn("[posthog] trackEvent failed silently:", e);
  }
}

/** Eventos predefinidos de Mampostera */
export const MamposteraEvents = {
  PROPERTY_VIEWED:    "property_viewed",
  TOKEN_PURCHASED:    "token_purchased",
  RENT_CLAIMED:       "rent_claimed",
  KYC_STARTED:        "kyc_started",
  KYC_COMPLETED:      "kyc_completed",
  OFFER_CREATED:      "offer_created",
  OFFER_ACCEPTED:     "offer_accepted",
  LOAN_INITIATED:     "loan_initiated",
  LOAN_REPAID:        "loan_repaid",
  WALLET_CONNECTED:   "wallet_connected",
  ONRAMP_STARTED:     "onramp_started",
  ONRAMP_COMPLETED:   "onramp_completed",
  LEGAL_DOC_SIGNED:   "legal_doc_signed",
} as const;

/** Verifica si un feature flag está activo para un usuario */
export async function isFeatureEnabled(
  flag: string,
  distinctId: string
): Promise<boolean> {
  try {
    const client = await getClient();
    return await client.isFeatureEnabled(flag, distinctId) ?? false;
  } catch {
    return false; // Fail open — si PostHog cae, no bloquear features
  }
}

/** Shutdown limpio (llamar en SIGTERM) */
export async function shutdownPostHog(): Promise<void> {
  await _client?.shutdown();
}
