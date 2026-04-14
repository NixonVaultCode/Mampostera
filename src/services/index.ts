/**
 * services/index.ts — Re-exports centralizados.
 * Las API routes importan desde aquí, nunca del SDK directamente.
 */
export { getSecret, getSecrets, requireSecrets, SecretKey } from "./secrets.service";
export { captureError, captureMessage, initSentry }         from "./security/sentry.adapter";
export { verifyCfRequest, purgeCloudflareCache }            from "./security/cloudflare.adapter";
export { verifyPrivyWebhook, getPrivyUser }                 from "./auth/privy.adapter";
export { createOnRampSession, verifyStripeWebhook }         from "./payments/stripe.adapter";
export { createWompiSession, verifyWompiWebhook,
         extractApprovedTransaction }                       from "./payments/wompi.adapter";
export { createMoonPayUrl }                                 from "./payments/moonpay.adapter";
export { sendEmail, sendRentNotification }                  from "./comms/resend.adapter";
export { sendOtp, verifyOtp }                               from "./comms/twilio.adapter";
export { enqueueClaudeJob, executeClaudeJob, askClaude }    from "./legal/claude.adapter";
export { sendForSignature, executeSignJob,
         processSignatureWebhook, getEnvelopeStatus }       from "./legal/firma.adapter";
export { trackEvent, isFeatureEnabled, MamposteraEvents }   from "./analytics/posthog.adapter";

export { parseHeliusEvent, persistEvent, verifyHeliusWebhook, registerHeliusWebhook } from "./indexer/helius.service";
