/**
 * app/api/events/property/[id]/route.ts
 * Eventos de una propiedad específica.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getDb, getCached, CacheKeys, CACHE_TTL } from "@/v2/db/client";
import { onchainEvents } from "@/v2/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const data = await getCached(
      `v2:events:property:${params.id}`,
      async () => {
        const db = await getDb();
        return db
          .select()
          .from(onchainEvents)
          .where(eq(onchainEvents.propertyId, params.id))
          .orderBy(desc(onchainEvents.slot))
          .limit(50);
      },
      CACHE_TTL.properties
    );
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
