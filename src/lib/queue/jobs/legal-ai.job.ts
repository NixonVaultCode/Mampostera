/**
 * lib/queue/jobs/legal-ai.job.ts
 * Worker para jobs de Claude API.
 * Ejecutado por QStash o inline en dev.
 */
import { executeClaudeJob, type ClaudeJobRequest } from "../../services/legal/claude.adapter";

export async function runJob(payload: Record<string, unknown>): Promise<void> {
  const req = payload as ClaudeJobRequest & { jobId: string };
  const result = await executeClaudeJob(req);
  console.info(`[legal-ai] Job ${req.jobId} → ${result.status} (${result.durationMs}ms)`);
  // En producción: guardar resultado en Redis/Upstash con TTL 1h
  // await redis.set(`job:${req.jobId}`, JSON.stringify(result), { ex: 3600 });
}
