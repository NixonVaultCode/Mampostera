/**
 * drizzle.config.ts
 * Configuración de Drizzle Kit para migraciones de Neon DB.
 *
 * Comandos:
 *   yarn db:generate  → genera SQL de migración
 *   yarn db:migrate   → aplica migraciones en producción
 *   yarn db:push      → push directo al schema (dev)
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema:    "./src/v2/db/schema.ts",
  out:       "./src/v2/db/migrations",
  dialect:   "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict:  true,
});
