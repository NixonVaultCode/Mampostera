/**
 * sentry.client.config.ts
 * Configuración de Sentry para el browser.
 * Next.js lo carga automáticamente en el cliente.
 */
import * as Sentry from "@sentry/nextjs";
import { configureSentryRedactor } from "@/services/security/sentry.adapter";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV,

  // Porcentaje de transacciones a rastrear (performance monitoring)
  // 10% en producción para no saturar la cuota
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Session Replay: 2% de sesiones en producción, 100% en dev
  replaysSessionSampleRate: process.env.NODE_ENV === "production" ? 0.02 : 1.0,
  replaysOnErrorSampleRate: 1.0, // 100% cuando hay un error

  integrations: [
    Sentry.replayIntegration({
      // Enmascarar texto para no capturar datos personales
      maskAllText:    true,
      blockAllMedia:  false,
    }),
    Sentry.browserTracingIntegration(),
  ],

  // Ignorar errores de wallets (comunes, no son bugs nuestros)
  ignoreErrors: [
    "User rejected the request",
    "WalletNotConnectedError",
    "WalletSignTransactionError",
    "Transaction was not confirmed",
    // Errores de extensiones del browser
    /^chrome-extension/,
    /^moz-extension/,
  ],

  // beforeSend: redactar campos sensibles ANTES de enviar a Sentry
  beforeSend(event) {
    // No enviar errores en desarrollo (usar console.error en su lugar)
    if (process.env.NODE_ENV === "development") return null;

    // Redacción adicional de campos en el cliente
    if (event.request?.headers) {
      delete event.request.headers["authorization"];
      delete event.request.headers["cookie"];
    }

    return event;
  },
});

// Activar el redactor de campos sensibles (keypairs, seeds, etc.)
configureSentryRedactor();
