/**
 * sentry.edge.config.ts
 * Configuración de Sentry para Edge Runtime (middleware.ts).
 * Edge Runtime tiene APIs limitadas — sin Node.js modules.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // Reducir sampling en edge (muchos requests de middleware)
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.05 : 0.5,
});
