/**
 * app/api/events/recent/route.ts
 * Últimos N eventos on-chain indexados por Helius.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getCached, CacheKeys, CACHE_TTL } from "@/v2/db/client";
import { onchainEvents } from "@/v2/db/schema";
import { desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 100);

  try {
    const data = await getCached(
      `${CacheKeys.properties}:events:recent:${limit}`,
      async () => {
        const db = await getDb();
        return db
          .select()
          .from(onchainEvents)
          .orderBy(desc(onchainEvents.slot))
          .limit(limit);
      },
      CACHE_TTL.properties // 30s — invalidado por Helius webhook
    );
    return NextResponse.json(data);
  } catch (err) {
    console.error("[events/recent]", err);
    return NextResponse.json([], { status: 200 }); // fail gracefully
  }
}
