/**
 * app/api/legal/por/route.ts
 *
 * R8: Endpoint para registrar el Proof of Reserve de una propiedad.
 * Recibe el PDF del certificado notarial → calcula hash → sube a Arweave
 * → retorna los parámetros para llamar register_proof_of_reserve() on-chain.
 *
 * El frontend usa estos parámetros para construir y firmar la tx on-chain.
 * runtime = nodejs: necesita Buffer y crypto para SHA-256 del PDF.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse }  from "next/server";
import { preparePorAttestation, verifyPor } from "@/services/legal/por.service";
import { captureError }               from "@/services/security/sentry.adapter";

// POST: preparar attestation (hash + Arweave upload)
export async function POST(req: NextRequest) {
  try {
    const formData     = await req.formData();
    const pdfFile      = formData.get("certificate") as File | null;
    const propertyName = formData.get("propertyName") as string;
    const escrituraRef = formData.get("escrituraRef") as string;
    const matriculaRef = formData.get("matriculaRef") as string;
    const notariaRef   = formData.get("notariaRef")   as string;
    const sasNit       = formData.get("sasNit")       as string;
    const certDateStr  = formData.get("certificateDate") as string;

    if (!pdfFile || pdfFile.type !== "application/pdf") {
      return NextResponse.json({ error: "Se requiere un PDF del certificado notarial" }, { status: 400 });
    }
    if (!escrituraRef || !matriculaRef || !notariaRef || !sasNit) {
      return NextResponse.json({ error: "Faltan campos requeridos del certificado" }, { status: 400 });
    }

    const pdfBuffer      = await pdfFile.arrayBuffer();
    const certificateDate = certDateStr ? new Date(certDateStr) : new Date();

    const attestation = await preparePorAttestation(
      pdfBuffer, propertyName, escrituraRef,
      matriculaRef, notariaRef, sasNit, certificateDate
    );

    return NextResponse.json({
      // Parámetros para llamar register_proof_of_reserve() on-chain
      certificateHashHex: attestation.certificateHashHex,
      certificateHashBytes: Array.from(attestation.certificateHash), // u8[32]
      arweaveCid:         attestation.arweaveCid,
      escrituraRef:       attestation.escrituraRef,
      matriculaRef:       attestation.matriculaRef,
      notariaRef:         attestation.notariaRef,
      sasNit:             attestation.sasNit,
      certificateDate:    attestation.certificateDate,
    });
  } catch (err: unknown) {
    captureError(err as Error, { context: "por_prepare" });
    return NextResponse.json({ error: "Error preparando el Proof of Reserve" }, { status: 500 });
  }
}

// GET: verificar un PoR existente dado el Arweave CID y hash on-chain
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const arweaveCid   = searchParams.get("arweaveCid") ?? "";
  const hashHex      = searchParams.get("hash") ?? "";
  const registeredAt = Number(searchParams.get("registeredAt") ?? "0");

  if (!arweaveCid || !hashHex || !registeredAt) {
    return NextResponse.json({ error: "arweaveCid, hash y registeredAt son requeridos" }, { status: 400 });
  }

  try {
    const hashBytes = new Uint8Array(
      hashHex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) ?? []
    );
    const result = await verifyPor(arweaveCid, hashBytes, registeredAt);
    return NextResponse.json(result);
  } catch (err: unknown) {
    captureError(err as Error, { context: "por_verify" });
    return NextResponse.json({ error: "Error verificando el Proof of Reserve" }, { status: 500 });
  }
}
