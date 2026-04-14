/**
 * v2/app/api/[[...route]]/route.ts
 * Hono.js en edge runtime — coexiste con las rutas REST de /api/.
 *
 * Las rutas /api/payments/stripe, /api/comms/sms, etc. siguen funcionando.
 * Este handler monta en /v2/api/ y agrega:
 *   - tRPC endpoint en /v2/api/trpc
 *   - Health check en /v2/api/health
 *   - Versión tipada de todos los endpoints con Zod
 *
 * Edge runtime: sin Node.js, latencia <1ms cold start, global.
 */

export const runtime = "edge";

import { Hono }               from "hono";
import { cors }               from "hono/cors";
import { logger }             from "hono/logger";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter }          from "../../../v2/trpc/router";
import type { TRPCContext }   from "../../../v2/trpc/router";

const app = new Hono().basePath("/v2/api");

// ── Middlewares ────────────────────────────────────────────────────────────────

app.use("*", cors({
  origin:         ["https://app.mampostera.co", "http://localhost:3000"],
  allowMethods:   ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders:   ["Content-Type", "Authorization", "x-wallet-address", "x-request-id"],
  exposeHeaders:  ["x-request-id"],
  credentials:    true,
}));

app.use("*", logger());

// ── Health check ───────────────────────────────────────────────────────────────

app.get("/health", (c) =>
  c.json({
    status:    "ok",
    version:   "v2",
    runtime:   "edge",
    timestamp: new Date().toISOString(),
  })
);

// ── tRPC handler ──────────────────────────────────────────────────────────────

app.all("/trpc/*", async (c) => {
  const walletAddress = c.req.header("x-wallet-address") ?? undefined;
  const country       = c.req.header("cf-ipcountry")     ?? undefined;
  const requestId     = c.req.header("x-request-id")     ?? crypto.randomUUID();

  const ctx: TRPCContext = { walletAddress, country, requestId };

  return fetchRequestHandler({
    endpoint: "/v2/api/trpc",
    req:      c.req.raw,
    router:   appRouter,
    createContext: () => ctx,
    onError: ({ error, path }) => {
      if (error.code !== "NOT_FOUND" && error.code !== "UNAUTHORIZED") {
        console.error(`[tRPC] Error en ${path}: ${error.message}`);
      }
    },
  });
});

// ── Next.js App Router adapter ────────────────────────────────────────────────

export const GET     = (req: Request) => app.fetch(req);
export const POST    = (req: Request) => app.fetch(req);
export const PUT     = (req: Request) => app.fetch(req);
export const DELETE  = (req: Request) => app.fetch(req);
export const OPTIONS = (req: Request) => app.fetch(req);
