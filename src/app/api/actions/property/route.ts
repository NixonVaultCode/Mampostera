/**
 * frontend/src/app/api/actions/property/[id]/route.ts
 *
 * R7: Solana Actions (blinks) — cada propiedad como link compartible.
 *
 * Un link como https://mampostera.co/api/actions/property/cr7-bog-001
 * puede compartirse en Twitter/Discord/WhatsApp y ejecutar una inversión
 * directamente desde cualquier app compatible con Solana Actions (Phantom, Backpack).
 *
 * Spec: https://solana.com/docs/advanced/actions
 */

export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb }    from "@/v2/db/client";
import { properties } from "@/v2/db/schema";
import { eq }       from "drizzle-orm";
import { Connection, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";

const APP_URL     = process.env.NEXT_PUBLIC_APP_URL ?? "https://mampostera.co";
const RPC_ENDPOINT = process.env.NEXT_PUBLIC_RPC_ENDPOINT ?? "https://api.devnet.solana.com";

// ── GET: devuelve el ActionSpec (metadata del blink) ─────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Headers requeridos por el protocolo Solana Actions
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Action-Version":             "1",
    "Content-Type":                 "application/json",
  };

  try {
    const db   = await getDb();
    const [prop] = await db.select().from(properties).where(eq(properties.id, params.id)).limit(1);

    if (!prop) {
      return NextResponse.json({ error: "Property not found" }, { status: 404, headers });
    }

    const pricePerTokenCOP = Math.round((prop.totalValueUsd / prop.totalTokens) * 4200);  // aprox COP
    const apyLabel = prop.targetApy ? `${prop.targetApy}% APY est.` : "APY estimado 8.5%";

    const actionSpec = {
      title:       `Invertir en ${prop.name}`,
      icon:        `${APP_URL}/api/property-image/${params.id}`,
      description: `${prop.city}, ${prop.country} · ${apyLabel} · $${(prop.totalValueUsd / 1000).toFixed(0)}K USD total`,
      label:       "Invertir ahora",
      links: {
        actions: [
          {
            label:  "Invertir $50.000 COP",
            href:   `${APP_URL}/api/actions/property/${params.id}/buy?amount=50000&currency=COP`,
          },
          {
            label:  "Invertir $100.000 COP",
            href:   `${APP_URL}/api/actions/property/${params.id}/buy?amount=100000&currency=COP`,
          },
          {
            label:  "Invertir $200.000 COP",
            href:   `${APP_URL}/api/actions/property/${params.id}/buy?amount=200000&currency=COP`,
          },
          {
            label: "Monto personalizado",
            href:  `${APP_URL}/api/actions/property/${params.id}/buy`,
            parameters: [
              {
                name:     "amount",
                label:    "Monto en pesos colombianos",
                required: true,
                pattern:  "^[0-9]+$",
              },
            ],
          },
        ],
      },
    };

    return NextResponse.json(actionSpec, { headers });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500, headers });
  }
}

// ── POST: construye la transacción Solana para firmar ─────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type":                 "application/json",
  };

  try {
    const body = await req.json() as { account: string };
    const { searchParams } = new URL(req.url);
    const amountCOP = Number(searchParams.get("amount") ?? "50000");

    const investorPubkey = new PublicKey(body.account);
    const connection     = new Connection(RPC_ENDPOINT);

    // En producción: construir la tx real de mintFractionalTokens()
    // Por ahora: tx de ejemplo (transfer 0 SOL = "memo" on-chain)
    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: investorPubkey,
    });

    // Añadir instrucción de memo con los detalles de la inversión
    tx.add(
      SystemProgram.transfer({
        fromPubkey: investorPubkey,
        toPubkey:   investorPubkey,  // Self-transfer como placeholder
        lamports:   0,
      })
    );

    const serializedTx = tx.serialize({ requireAllSignatures: false });

    return NextResponse.json({
      transaction: Buffer.from(serializedTx).toString("base64"),
      message:     `Inversión de $${amountCOP.toLocaleString("es-CO")} COP en procesamiento`,
    }, { headers });
  } catch {
    return NextResponse.json({ error: "Error building transaction" }, { status: 500, headers });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
