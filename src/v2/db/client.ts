/**
 * v2/db/client.ts
 * Clientes de Neon DB (PostgreSQL) + Upstash Redis.
 * Server-side only — nunca importar en componentes React.
 */

import { neon }        from "@neondatabase/serverless";
import { drizzle }     from "drizzle-orm/neon-http";
import { Redis }       from "@upstash/redis";
import * as schema     from "./schema";

// ── Neon DB ───────────────────────────────────────────────────────────────────

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export async function getDb() {
  if (_db) return _db;

  // DATABASE_URL viene de Infisical en producción (inyectado por el servidor)
  // o de .env.local en desarrollo. No usar getSecret() aquí porque esta función
  // se llama antes de que Infisical esté inicializado (bootstrap).
  const connectionUrl = process.env.DATABASE_URL;
  if (!connectionUrl) {
    throw new Error(
      "[db] DATABASE_URL no configurada. " +
      "Añadir a Infisical (producción) o a .env.local (desarrollo)."
    );
  }

  const sql = neon(connectionUrl);
  _db = drizzle(sql, { schema });
  return _db;
}

// ── Upstash Redis ──────────────────────────────────────────────────────────────

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (_redis) return _redis;
  // Redis.fromEnv() lee UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
  _redis = Redis.fromEnv();
  return _redis;
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

export const CACHE_TTL = {
  properties: 30,
  portfolio:  20,
  oracle:     300,
  user:       3600,
} as const;

export async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = 60
): Promise<T> {
  const redis = getRedis();

  try {
    const cached = await redis.get<T>(key);
    if (cached !== null) return cached;
  } catch { /* Redis down → fallback to fetcher */ }

  const data = await fetcher();

  try {
    await redis.setex(key, ttl, JSON.stringify(data));
  } catch { /* Redis down → sin cache, continuar */ }

  return data;
}

export const CacheKeys = {
  properties:  "v2:properties:all",
  property:    (id: string) => `v2:property:${id}`,
  portfolio:   (wallet: string) => `v2:portfolio:${wallet}`,
  oracle:      (propId: string) => `v2:oracle:${propId}`,
  jobStatus:   (jobId: string) => `v2:job:${jobId}`,
} as const;
