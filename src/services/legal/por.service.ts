/**
 * services/legal/por.service.ts
 *
 * R8: Servicio de Proof of Reserve — genera y verifica attestations notariales.
 *
 * Flujo completo:
 *   1. Notario firma el certificado PDF digitalmente
 *   2. Backend calcula SHA-256 del PDF y lo registra on-chain
 *   3. El hash vive en el ProofOfReserve PDA — inmutable
 *   4. Cualquier tercero puede verificar: descarga el PDF de Arweave,
 *      calcula el SHA-256, compara con el PDA on-chain
 */

import { getSecret, SecretKey } from "../secrets.service";

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface PorAttestation {
  certificateHash: Uint8Array;   // SHA-256 del PDF (32 bytes)
  certificateHashHex: string;    // hex string para display
  arweaveCid:      string;       // "ar://<id>" donde vive el PDF
  escrituraRef:    string;       // "Escritura 4821/2026 Notaría 20 Bogotá"
  matriculaRef:    string;       // "50C-1234567"
  notariaRef:      string;       // "Notaría 20 de Bogotá"
  sasNit:          string;       // "901.234.567-8"
  certificateDate: number;       // Unix timestamp de la fecha del certificado
}

export interface PorVerificationResult {
  isValid:         boolean;
  hashMatches:     boolean;
  ageMonths:       number;
  isExpired:       boolean;      // > 6 meses
  details:         string;
}

// ── Calcular SHA-256 de un PDF ────────────────────────────────────────────────

export async function hashPdfBuffer(pdfBuffer: ArrayBuffer): Promise<{
  hashBytes: Uint8Array;
  hashHex:   string;
}> {
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", pdfBuffer);
  const hashBytes  = new Uint8Array(hashBuffer);
  const hashHex    = Array.from(hashBytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return { hashBytes, hashHex };
}

// ── Subir certificado a Arweave ───────────────────────────────────────────────

export async function uploadToArweave(
  pdfBuffer:    ArrayBuffer,
  propertyName: string
): Promise<{ arweaveCid: string; txId: string }> {
  const arweaveKey = await getSecret(SecretKey.POSTHOG_API_KEY, {
    throwIfMissing: false,
    defaultValue:   "",
  });

  if (!arweaveKey) {
    // En desarrollo: retornar CID simulado
    console.warn("[por] ARWEAVE_KEY no configurado — usando CID simulado");
    const mockId = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(22)))
      .map(b => b.toString(36))
      .join("")
      .slice(0, 43);
    return { arweaveCid: `ar://${mockId}`, txId: mockId };
  }

  // Subir a Arweave usando la API bundlr/turbo
  const response = await fetch("https://turbo.ardrive.io/v1/tx", {
    method:  "POST",
    headers: {
      "Content-Type":  "application/pdf",
      "X-Content-Type": "application/pdf",
      "Authorization": `Bearer ${arweaveKey}`,
      "tags": JSON.stringify([
        { name: "App-Name",       value: "Mampostera" },
        { name: "Content-Type",   value: "application/pdf" },
        { name: "Property-Name",  value: propertyName },
        { name: "Document-Type",  value: "ProofOfReserve" },
        { name: "Timestamp",      value: String(Date.now()) },
      ]),
    },
    body: pdfBuffer,
  });

  if (!response.ok) {
    throw new Error(`[por] Error subiendo a Arweave: ${response.status}`);
  }

  const data = await response.json() as { id: string };
  return {
    arweaveCid: `ar://${data.id}`,
    txId:       data.id,
  };
}

// ── Preparar attestation completa ─────────────────────────────────────────────

export async function preparePorAttestation(
  pdfBuffer:      ArrayBuffer,
  propertyName:   string,
  escrituraRef:   string,
  matriculaRef:   string,
  notariaRef:     string,
  sasNit:         string,
  certificateDate: Date
): Promise<PorAttestation> {
  // 1. Calcular hash del PDF
  const { hashBytes, hashHex } = await hashPdfBuffer(pdfBuffer);

  // 2. Subir a Arweave
  const { arweaveCid } = await uploadToArweave(pdfBuffer, propertyName);

  return {
    certificateHash:    hashBytes,
    certificateHashHex: hashHex,
    arweaveCid,
    escrituraRef:       escrituraRef.slice(0, 32),
    matriculaRef:       matriculaRef.slice(0, 20),
    notariaRef:         notariaRef.slice(0, 48),
    sasNit:             sasNit.slice(0, 12),
    certificateDate:    Math.floor(certificateDate.getTime() / 1000),
  };
}

// ── Verificar un PoR existente ────────────────────────────────────────────────

export async function verifyPor(
  arweaveCid:   string,
  onchainHash:  Uint8Array,
  registeredAt: number
): Promise<PorVerificationResult> {
  const nowMs       = Date.now();
  const ageMs       = nowMs - (registeredAt * 1000);
  const ageMonths   = ageMs / (1000 * 60 * 60 * 24 * 30);
  const isExpired   = ageMonths > 6;

  try {
    // Descargar el PDF de Arweave y verificar el hash
    const arweaveUrl = arweaveCid.replace("ar://", "https://arweave.net/");
    const response   = await fetch(arweaveUrl);

    if (!response.ok) {
      return {
        isValid:     false,
        hashMatches: false,
        ageMonths,
        isExpired,
        details:     `No se pudo descargar el certificado de Arweave (${response.status})`,
      };
    }

    const pdfBuffer = await response.arrayBuffer();
    const { hashBytes } = await hashPdfBuffer(pdfBuffer);

    // Comparar byte a byte
    const hashMatches = hashBytes.length === onchainHash.length &&
      hashBytes.every((b, i) => b === onchainHash[i]);

    return {
      isValid:     hashMatches && !isExpired,
      hashMatches,
      ageMonths,
      isExpired,
      details: hashMatches
        ? isExpired
          ? "Certificado auténtico pero expirado — requiere renovación semestral"
          : "Certificado auténtico y vigente ✓"
        : "ADVERTENCIA: El hash del PDF no coincide con el registro on-chain",
    };
  } catch (err) {
    return {
      isValid:     false,
      hashMatches: false,
      ageMonths,
      isExpired,
      details:     `Error verificando: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
