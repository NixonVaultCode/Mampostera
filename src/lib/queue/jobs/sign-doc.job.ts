/**
 * lib/queue/jobs/sign-doc.job.ts
 */
import { executeSignJob, type SendForSignatureRequest } from "../../services/legal/firma.adapter";

export async function runJob(payload: Record<string, unknown>): Promise<void> {
  const req = payload as SendForSignatureRequest & { jobId: string };
  const result = await executeSignJob(req);
  console.info(`[sign-doc] Job ${req.jobId} → envelope: ${result.envelopeId} via ${result.provider}`);
}
