/**
 * sentry.server.config.ts
 * Configuración de Sentry para el servidor Node.js de Next.js.
 */
import * as Sentry from "@sentry/nextjs";
import { configureSentryRedactor } from "@/services/security/sentry.adapter";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // En server-side, capturar TODOS los errores no manejados
  // (es más crítico que en el cliente)

  beforeSend(event) {
    // Redactar campos sensibles ANTES de enviar
    // El redactor del adapter también corre, esto es una capa adicional
    if (event.request?.data) {
      const sensitiveKeys = ["secretKey", "keypair", "privateKey", "seed", "mnemonic"];
      for (const key of sensitiveKeys) {
        if (typeof event.request.data === "object" && event.request.data !== null) {
          if (key in (event.request.data as Record<string, unknown>)) {
            (event.request.data as Record<string, unknown>)[key] = "[REDACTED]";
          }
        }
      }
    }
    return event;
  },
});

// Activar el redactor completo (recursivo, cubre objetos anidados)
configureSentryRedactor();
