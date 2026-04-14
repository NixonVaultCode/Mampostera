/**
 * app/api/legal/ai/route.ts
 * Encola un job de Claude. Retorna 202 inmediatamente.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { enqueueClaudeJob, type ClaudeJobRequest } from "@/services/legal/claude.adapter";
import { captureError } from "@/services/security/sentry.adapter";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as ClaudeJobRequest;

    if (!body.prompt || !body.type) {
      return NextResponse.json({ error: "type y prompt son requeridos" }, { status: 400 });
    }

    const job = await enqueueClaudeJob(body);

    // 202 Accepted — el cliente hace polling a GET /api/legal/ai/[jobId]/status
    return NextResponse.json(job, { status: 202 });
  } catch (err: unknown) {
    captureError(err as Error, { context: "legal_ai_enqueue" });
    return NextResponse.json({ error: "Error encolando tarea legal" }, { status: 500 });
  }
}
