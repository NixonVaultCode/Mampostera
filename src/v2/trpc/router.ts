/**
 * v2/trpc/router.ts
 * tRPC v11 — API type-safe sobre los adaptadores existentes de /services/.
 *
 * INTEROPERABILIDAD: Los procedures llaman a los mismos adapters de /services/
 * que usan las routes REST actuales. No se duplica lógica.
 *
 * Los endpoints REST actuales (/api/payments/stripe, etc.) siguen funcionando.
 * tRPC es una capa adicional para el frontend /v2 con tipos end-to-end.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import { z }                   from "zod";
import { getDb, getRedis, CacheKeys, CACHE_TTL } from "../db/client";
import { properties, priceHistory } from "../db/schema";
import { eq, desc }            from "drizzle-orm";
import { fetchAllProperties }  from "../../lib/program";
import { enqueueClaudeJob }    from "../../services/legal/claude.adapter";
import { sendForSignature }    from "../../services/legal/firma.adapter";
import { createOnRampSession } from "../../services/payments/stripe.adapter";
import { createMoonPayUrl }    from "../../services/payments/moonpay.adapter";
import { sendEmail }           from "../../services/comms/resend.adapter";
import { sendOtp, verifyOtp }  from "../../services/comms/twilio.adapter";
import { trackEvent, MamposteraEvents } from "../../services/analytics/posthog.adapter";

// ── Contexto ──────────────────────────────────────────────────────────────────

export interface TRPCContext {
  walletAddress?: string;
  country?:       string;
  requestId?:     string;
}

// ── Init ──────────────────────────────────────────────────────────────────────

const t = initTRPC.context<TRPCContext>().create();

export const router     = t.router;
export const publicProc = t.procedure;
export const authedProc = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.walletAddress) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Wallet no conectado" });
  }
  return next({ ctx: { ...ctx, walletAddress: ctx.walletAddress } });
});

// ── Routers ───────────────────────────────────────────────────────────────────

const propertiesRouter = router({
  list: publicProc.query(async () => {
    const redis = getRedis();
    try {
      const cached = await redis.get<unknown[]>(CacheKeys.properties);
      if (cached) return cached;
    } catch {}

    const db   = await getDb();
    const rows = await db.select().from(properties).where(eq(properties.isActive, true));

    try { await redis.setex(CacheKeys.properties, CACHE_TTL.properties, JSON.stringify(rows)); } catch {}
    return rows;
  }),

  byId: publicProc
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const db  = await getDb();
      const [prop] = await db.select().from(properties).where(eq(properties.id, input.id));
      if (!prop) throw new TRPCError({ code: "NOT_FOUND" });
      return prop;
    }),

  priceHistory: publicProc
    .input(z.object({ propertyId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      return db
        .select()
        .from(priceHistory)
        .where(eq(priceHistory.propertyId, input.propertyId))
        .orderBy(desc(priceHistory.recordedAt))
        .limit(input.limit);
    }),
});

const paymentsRouter = router({
  createStripeSession: authedProc
    .input(z.object({
      amountUsdc:  z.number().positive().max(1_000_000),
      propertyId:  z.string().uuid().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await trackEvent(ctx.walletAddress!, MamposteraEvents.ONRAMP_STARTED, {
        provider: "stripe", amountUsdc: input.amountUsdc,
      });
      return createOnRampSession({
        amountUsdc:    input.amountUsdc,
        walletAddress: ctx.walletAddress!,
        propertyId:    input.propertyId,
      });
    }),

  createMoonPayUrl: authedProc
    .input(z.object({
      amountUsdc: z.number().positive(),
      currency:   z.enum(["COP", "USD", "EUR", "BRL", "MXN"]).default("COP"),
      propertyId: z.string().uuid().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await createMoonPayUrl({
          amountUsdc:    input.amountUsdc,
          walletAddress: ctx.walletAddress!,
          currency:      input.currency,
          propertyId:    input.propertyId,
        });
        return { ...result, provider: "moonpay" as const };
      } catch {
        const result = await createOnRampSession({
          amountUsdc:    input.amountUsdc,
          walletAddress: ctx.walletAddress!,
        });
        return { ...result, provider: "stripe" as const, fallback: true };
      }
    }),
});

const legalRouter = router({
  askAI: authedProc
    .input(z.object({
      type:       z.enum(["draft_sas_escritura","analyze_lease","generate_tokenization_clause","investor_legal_qa","compliance_review","generic"]),
      prompt:     z.string().min(10).max(4000),
      context:    z.record(z.unknown()).optional(),
      propertyId: z.string().uuid().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return enqueueClaudeJob({ ...input, userId: ctx.walletAddress });
    }),

  signDocument: authedProc
    .input(z.object({
      documentType: z.enum(["pacto_accionistas","poder_especial","terminos_condiciones","avaluo_notarial","contrato_arrendamiento","generic"]),
      documentUrl:  z.string().url(),
      documentHash: z.string().length(64).regex(/^[a-f0-9]+$/i),
      signers:      z.array(z.object({
        name:  z.string(),
        email: z.string().email(),
        role:  z.string().optional(),
      })).min(1),
      propertyId:   z.string().uuid().optional(),
    }))
    .mutation(async ({ input }) => {
      return sendForSignature(input);
    }),
});

const commsRouter = router({
  sendOtp: authedProc
    .input(z.object({
      phone:   z.string().regex(/^\+[1-9]\d{7,14}$/),
      channel: z.enum(["sms","whatsapp"]).default("sms"),
    }))
    .mutation(async ({ input }) => {
      await sendOtp(input);
      return { sent: true };
    }),

  verifyOtp: authedProc
    .input(z.object({
      phone: z.string(),
      code:  z.string().length(6),
    }))
    .mutation(async ({ input }) => {
      return verifyOtp(input);
    }),
});

// ── R8: Proof of Reserve router ───────────────────────────────────────────────

const porRouter = router({
  // Leer el PDA de PoR de una propiedad desde la DB (indexado por Helius)
  get: publicProc
    .input(z.object({ propertyPubkey: z.string().min(32) }))
    .query(async ({ input }) => {
      // Los datos del PoR viven on-chain — el frontend los lee directamente
      // del RPC via use-proof-of-reserve.ts. Este procedure es para el
      // historial de renovaciones indexado en onchain_events.
      const db = await getDb();
      const { onchainEvents } = await import("../db/schema");
      const { eq, desc }      = await import("drizzle-orm");

      const events = await db
        .select()
        .from(onchainEvents)
        .where(eq(onchainEvents.walletAddr, input.propertyPubkey))
        .orderBy(desc(onchainEvents.slot))
        .limit(10);

      return { propertyPubkey: input.propertyPubkey, events };
    }),

  // Encolar registro de PoR (la tx se firma en el browser, no aquí)
  prepareRegistration: authedProc
    .input(z.object({
      propertyId:   z.string().min(32),
      certificateHash: z.string().length(64).regex(/^[a-f0-9]+$/i),
      arweaveCid:   z.string().min(5).max(50),
      escrituraRef: z.string().min(3).max(32),
      matriculaRef: z.string().min(3).max(20),
      notariaRef:   z.string().min(3).max(48),
      sasNit:       z.string().min(8).max(12),
    }))
    .mutation(async ({ input }) => {
      // Llama al API route que construye la instrucción Anchor
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/por/register`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(input),
        }
      );
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.error ?? "Error preparando PoR" });
      }
      return res.json();
    }),
});

// ── R9: Liquidity Pool router ─────────────────────────────────────────────────

const liquidityRouter = router({
  // Estado del pool de una propiedad (leer el LiquidityPool PDA)
  poolStatus: publicProc
    .input(z.object({ propertyPubkey: z.string().min(32) }))
    .query(async ({ input }) => {
      // El PDA se lee directamente del RPC en LiquidityPoolCard.tsx
      // Este procedure provee metadatos adicionales desde la DB
      const db = await getDb();
      const { onchainEvents } = await import("../db/schema");
      const { eq, desc }      = await import("drizzle-orm");

      const swapEvents = await db
        .select()
        .from(onchainEvents)
        .where(eq(onchainEvents.eventType, "OfferAccepted"))
        .orderBy(desc(onchainEvents.slot))
        .limit(5);

      return {
        propertyPubkey: input.propertyPubkey,
        recentSwaps:    swapEvents,
        orcaUrl: `https://www.orca.so/liquidity/browse`,
      };
    }),
});

// ── App router principal ──────────────────────────────────────────────────────

// ── R10: Token MAMP ve-tokenomics router ──────────────────────────────────────

const mampRouter = router({
  // Estado del FeePool y veStake del usuario (datos vienen del RPC directo)
  // Este procedure provee datos complementarios de la DB
  poolStats: publicProc.query(async () => {
    const db = await getDb();
    const { onchainEvents } = await import("../db/schema");
    const { desc } = await import("drizzle-orm");

    const recentDistributions = await db
      .select()
      .from(onchainEvents)
      .orderBy(desc(onchainEvents.slot))
      .limit(5);

    return {
      recentDistributions,
      nextDistributionEta: "Cada lunes 9:00 AM COT",
      feeSharePercent:     20,
    };
  }),
});

// ── R13: Virtual account COP router ──────────────────────────────────────────

const virtualAccountRouter = router({
  conversionRate: publicProc.query(async () => {
    // En producción: fetch desde Fixer.io o API Bancolombia
    return {
      solToCop:   850_000,
      usdcToCop:  4_200,
      provider:   "reference_rate",
      updatedAt:  new Date().toISOString(),
    };
  }),
});

export const appRouter = router({
  properties:     propertiesRouter,
  payments:       paymentsRouter,
  legal:          legalRouter,
  comms:          commsRouter,
  por:            porRouter,            // R8: Proof of Reserve
  liquidity:      liquidityRouter,      // R9: CLMM Orca pool
  mamp:           mampRouter,           // R10: ve-tokenomics MAMP
  virtualAccount: virtualAccountRouter, // R13: cuenta virtual COP
});

export type AppRouter = typeof appRouter;
