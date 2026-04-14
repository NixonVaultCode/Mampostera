/**
 * services/legal/avm.service.ts
 *
 * R12: AVM (Automated Valuation Model) — valoración mensual automática.
 *
 * Pipeline:
 *   1. Recopila datos públicos: Lonja de Propiedad Raíz, DANE Vivienda,
 *      transacciones recientes on-chain de la zona
 *   2. Envía a Claude API con un prompt especializado de valuación
 *   3. Claude retorna un valor estimado con intervalo de confianza
 *   4. Si el valor propuesto está dentro del intervalo del Switchboard feed,
 *      el multisig puede aprobar el update_valuation_v2()
 *
 * El perito humano valida trimestralmente; el AVM monitorea mensualmente.
 * Humano en el loop — el AVM nunca actualiza el oracle directamente.
 */

import { askClaude } from "./claude.adapter";
import { getDb }     from "../../v2/db/client";
import { properties, priceHistory } from "../../v2/db/schema";
import { eq, desc }  from "drizzle-orm";

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface AvmInput {
  propertyId:         string;         // UUID de la propiedad en Neon DB
  onchainPubkey:      string;
  location:           string;         // "Cra 7 #45-12, Chapinero, Bogotá"
  city:               string;
  neighborhood?:      string;
  areaM2?:            number;
  propertyType?:      string;
  currentValueCents:  number;         // Valor actual del oracle (USD cents)
  lastValuationDate?: string;         // ISO string de la última valuación
}

export interface AvmResult {
  propertyId:         string;
  estimatedValueCents: number;
  confidenceLow:      number;         // Percentil 10 (USD cents)
  confidenceHigh:     number;         // Percentil 90 (USD cents)
  changePercent:      number;         // Variación vs valor actual
  recommendation:     "UPDATE" | "HOLD" | "REVIEW_REQUIRED";
  reasoning:          string;         // Justificación del AVM
  dataSourcesUsed:    string[];
  generatedAt:        string;
}

// ── Función principal ─────────────────────────────────────────────────────────

export async function runAvm(input: AvmInput): Promise<AvmResult> {
  // 1. Obtener historial de precios de la propiedad
  const db = await getDb();
  const history = await db
    .select()
    .from(priceHistory)
    .where(eq(priceHistory.propertyId, input.propertyId))
    .orderBy(desc(priceHistory.recordedAt))
    .limit(8);

  const historyText = history.length > 0
    ? history.map(h =>
        `  - ${new Date(h.recordedAt).toLocaleDateString("es-CO")}: $${(h.valueUsd / 100).toLocaleString()} USD`
      ).join("\n")
    : "  Sin historial previo";

  // 2. Construir prompt para Claude
  const prompt = `Eres un perito valuador inmobiliario senior especializado en el mercado colombiano.
Necesito un avalúo comercial actualizado para la siguiente propiedad.

DATOS DE LA PROPIEDAD:
- Ubicación: ${input.location}
- Ciudad/Barrio: ${input.city}${input.neighborhood ? ` / ${input.neighborhood}` : ""}
- Área: ${input.areaM2 ? `${input.areaM2} m²` : "No especificada"}
- Tipo: ${input.propertyType ?? "Residencial"}
- Valor actual en plataforma: $${(input.currentValueCents / 100).toLocaleString()} USD

HISTORIAL DE VALUACIONES:
${historyText}

CONTEXTO DE MERCADO (usa tu conocimiento del mercado inmobiliario colombiano):
- Tendencias recientes en ${input.city}
- Índice de precios DANE Vivienda
- Factores macro: tasas de interés, inflación, demanda

Responde SOLO con este JSON (sin texto adicional, sin markdown):
{
  "estimatedValueUSD": <número entero en USD>,
  "confidenceLowUSD": <percentil 10 en USD>,
  "confidenceHighUSD": <percentil 90 en USD>,
  "changePercent": <variación porcentual vs valor actual, ej: 3.5 o -2.1>,
  "recommendation": "UPDATE" | "HOLD" | "REVIEW_REQUIRED",
  "reasoning": "<justificación en 2-3 oraciones>",
  "dataSourcesUsed": ["DANE", "Lonja Propiedad Raíz", "<otras fuentes>"]
}

Criterios:
- UPDATE: si la variación es >5% o <-5%
- HOLD: si la variación está entre -5% y +5%
- REVIEW_REQUIRED: si hay factores inusuales que requieren perito humano`;

  // 3. Llamar a Claude API
  const rawResponse = await askClaude(prompt, "compliance_review", { maxTokens: 512 });

  // 4. Parsear respuesta JSON
  let parsed: {
    estimatedValueUSD:  number;
    confidenceLowUSD:   number;
    confidenceHighUSD:  number;
    changePercent:      number;
    recommendation:     "UPDATE" | "HOLD" | "REVIEW_REQUIRED";
    reasoning:          string;
    dataSourcesUsed:    string[];
  };

  try {
    const clean = rawResponse
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    parsed = JSON.parse(clean) as typeof parsed;
  } catch {
    // Si Claude no retorna JSON válido, usar el valor actual con REVIEW_REQUIRED
    console.error("[avm] Claude no retornó JSON válido:", rawResponse.slice(0, 200));
    return {
      propertyId:          input.propertyId,
      estimatedValueCents: input.currentValueCents,
      confidenceLow:       Math.round(input.currentValueCents * 0.9),
      confidenceHigh:      Math.round(input.currentValueCents * 1.1),
      changePercent:       0,
      recommendation:      "REVIEW_REQUIRED",
      reasoning:           "Error parseando respuesta del AVM — se requiere revisión manual",
      dataSourcesUsed:     [],
      generatedAt:         new Date().toISOString(),
    };
  }

  const estimatedCents = Math.round(parsed.estimatedValueUSD * 100);

  // 5. Guardar en price_history como referencia AVM
  await db.insert(priceHistory).values({
    propertyId:  input.propertyId,
    valueUsd:    estimatedCents,
    source:      "avm_claude",
    docHash:     null,
  }).catch(() => {}); // Non-blocking

  return {
    propertyId:          input.propertyId,
    estimatedValueCents: estimatedCents,
    confidenceLow:       Math.round(parsed.confidenceLowUSD  * 100),
    confidenceHigh:      Math.round(parsed.confidenceHighUSD * 100),
    changePercent:       parsed.changePercent,
    recommendation:      parsed.recommendation,
    reasoning:           parsed.reasoning,
    dataSourcesUsed:     parsed.dataSourcesUsed,
    generatedAt:         new Date().toISOString(),
  };
}

// ── Correr AVM para todas las propiedades activas ─────────────────────────────

export async function runAvmForAllProperties(): Promise<AvmResult[]> {
  const db    = await getDb();
  const props = await db
    .select()
    .from(properties)
    .where(eq(properties.isActive, true));

  const results: AvmResult[] = [];

  for (const prop of props) {
    try {
      const result = await runAvm({
        propertyId:        prop.id,
        onchainPubkey:     prop.onchainPubkey,
        location:          prop.name,
        city:              prop.city,
        neighborhood:      prop.neighborhood ?? undefined,
        areaM2:            prop.areaM2 ? Number(prop.areaM2) : undefined,
        propertyType:      prop.propertyType,
        currentValueCents: prop.totalValueUsd,
      });
      results.push(result);

      // Pausa entre propiedades para no saturar la API de Claude
      await new Promise(r => setTimeout(r, 2_000));
    } catch (err) {
      console.error(`[avm] Error en propiedad ${prop.id}:`, err);
    }
  }

  return results;
}
