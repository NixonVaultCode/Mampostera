/**
 * app/api/events/wallet/[address]/route.ts
 * Actividad on-chain del wallet del inversor.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getCached, CACHE_TTL } from "@/v2/db/client";
import { onchainEvents } from "@/v2/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { address: string } }
) {
  try {
    const data = await getCached(
      `v2:events:wallet:${params.address}`,
      async () => {
        const db = await getDb();
        return db
          .select()
          .from(onchainEvents)
          .where(eq(onchainEvents.walletAddr, params.address))
          .orderBy(desc(onchainEvents.slot))
          .limit(30);
      },
      CACHE_TTL.portfolio
    );
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
