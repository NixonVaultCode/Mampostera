/**
 * v2/wrappers/queue-v1.ts
 * Wrapper: mantiene la API de queueJob() de v1 pero usa Inngest internamente.
 * Drop-in replacement — cambiar el import es suficiente.
 *
 * Antes: import { queueJob } from "@/lib/queue/client"
 * Después: import { queueJob } from "@/v2/wrappers/queue-v1"
 */

import { queueJobV2 } from "../jobs/inngest";
import type { QueueJobOptions } from "../../lib/queue/client";

export async function queueJob(opts: QueueJobOptions): Promise<void> {
  return queueJobV2(opts);
}
