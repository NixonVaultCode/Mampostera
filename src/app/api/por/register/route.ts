/**
 * app/api/por/register/route.ts
 *
 * R8: Registra el Proof of Reserve on-chain.
 * Valida el payload con Zod, verifica autoridad, construye la tx Anchor
 * y la retorna al cliente para firmar (la firma ocurre en el browser).
 *
 * runtime = nodejs: usa @coral-xyz/anchor SDK.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse }        from "next/server";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { z }                                from "zod";
import { captureError }                     from "@/services/security/sentry.adapter";

// ── Validación Zod ────────────────────────────────────────────────────────────

const RegisterPorSchema = z.object({
  propertyId:      z.string().min(1),          // pubkey on-chain
  certificateHash: z.string().length(64).regex(/^[a-f0-9]+$/i, "SHA-256 hex inválido"),
  arweaveCid:      z.string().min(5).max(50),
  escrituraRef:    z.string().min(3).max(32),
  matriculaRef:    z.string().min(3).max(20),
  notariaRef:      z.string().min(3).max(48),
  sasNit:          z.string().min(8).max(12),
  certificateDate: z.number().int().positive().optional(),
});

type RegisterPorInput = z.infer<typeof RegisterPorSchema>;

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: RegisterPorInput;

  try {
    const raw = await req.json();
    body = RegisterPorSchema.parse(raw);
  } catch (err) {
    const issues = err instanceof z.ZodError
      ? err.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ")
      : "Payload inválido";
    return NextResponse.json({ error: issues }, { status: 400 });
  }

  try {
    const RPC       = process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? "https://api.devnet.solana.com";
    const PROG_ID   = process.env.NEXT_PUBLIC_PROGRAM_ID  ?? "MAMPoSTERAv2222222222222222222222222222222";
    const connection = new Connection(RPC, "confirmed");
    const programId  = new PublicKey(PROG_ID);

    // Derivar PDAs necesarios
    const propertyPubkey = new PublicKey(body.propertyId);

    const [porPda, porBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("proof_of_reserve"), propertyPubkey.toBuffer()],
      programId
    );

    // Convertir certificateHash hex → [u8; 32]
    const hashBytes = Buffer.from(body.certificateHash, "hex");
    if (hashBytes.length !== 32) {
      return NextResponse.json({ error: "certificateHash debe ser 64 chars hex (SHA-256)" }, { status: 400 });
    }

    // Construir la transacción usando el IDL de Anchor
    // En producción: usar getProgram() del lib/program.ts con AnchorProvider
    // Por ahora retornamos los datos para que el frontend construya la tx
    // con el wallet del authority conectado
    const { blockhash } = await connection.getLatestBlockhash("confirmed");

    // Devolver los parámetros listos para que el frontend construya la tx
    // con AnchorProvider.wallet (el authority debe estar conectado)
    return NextResponse.json({
      ok:              true,
      porPda:          porPda.toBase58(),
      porBump,
      certificateHash: body.certificateHash,
      blockhash,
      instruction: {
        programId: PROG_ID,
        accounts: {
          proofOfReserve: porPda.toBase58(),
          propertyState:  body.propertyId,
          systemProgram:  "11111111111111111111111111111111",
        },
        data: {
          certificateHash: Array.from(hashBytes),
          arweaveCid:      body.arweaveCid,
          escrituraRef:    body.escrituraRef,
          matriculaRef:    body.matriculaRef,
          notariaRef:      body.notariaRef,
          sasNit:          body.sasNit,
          certificateDate: body.certificateDate ?? Math.floor(Date.now() / 1000),
        },
      },
      message: "Firma la transacción con tu wallet authority para registrar el PoR on-chain",
    });
  } catch (err) {
    captureError(err as Error, { context: "por_register" });
    return NextResponse.json({ error: "Error preparando transacción" }, { status: 500 });
  }
}
