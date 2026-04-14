/**
 * lib/queue/jobs/rent-notify.job.ts
 * BUG-04 fix: alinear campos con la interfaz de sendRentNotification().
 */
import { sendRentNotification } from "../../services/comms/resend.adapter";

// Alineado exactamente con los parámetros de sendRentNotification()
export interface RentNotifyPayload {
  to:            string;   // era investorEmail
  walletDisplay: string;   // era investorName
  propertyName:  string;   // era propertyAddress
  rentAmountSol: number;   // era rentAmountSOL (capitalización diferente)
  claimUrl:      string;
}

export async function runJob(payload: Record<string, unknown>): Promise<void> {
  const req = payload as RentNotifyPayload;

  // Validación mínima antes de llamar al adapter
  if (!req.to || !req.claimUrl) {
    throw new Error("[rent-notify] Payload incompleto: to y claimUrl son requeridos");
  }

  await sendRentNotification(req);
  console.info(`[rent-notify] Notificación enviada a ${req.to}`);
}
