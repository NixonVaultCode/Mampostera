/**
 * services/legal/claude.adapter.ts
 *
 * Adaptador para Anthropic Claude API — Asistente Legal de Mampostera.
 *
 * PATRÓN ASÍNCRONO OBLIGATORIO:
 * Las llamadas a Claude pueden tardar 10-30 segundos.
 * Este adapter NUNCA bloquea el UI — encola el job en QStash
 * y retorna un jobId inmediatamente. El resultado llega por webhook.
 *
 * Casos de uso:
 *   - Redacción de escrituras públicas S.A.S.
 *   - Análisis de contratos de arrendamiento
 *   - Generación de cláusulas de tokenización
 *   - Respuestas a preguntas legales de inversores
 *   - Revisión de cumplimiento regulatorio (UIAF, Superfinanciera)
 *
 * Flujo:
 *   1. API route recibe solicitud → llama enqueueClaudeJob()
 *   2. Retorna { jobId, status: "queued" } al cliente (202)
 *   3. QStash ejecuta el job → llama a Anthropic API
 *   4. Resultado guardado en Redis con TTL de 1h
 *   5. Cliente hace polling a GET /api/legal/ai/[jobId]/status
 *      O recibe push via WebSocket/SSE si está conectado
 */

import Anthropic from "@anthropic-ai/sdk";
import { getSecret, SecretKey } from "../secrets.service";
import { queueJob } from "../../lib/queue/client";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type ClaudeJobType =
  | "draft_sas_escritura"       // Redactar escritura de constitución S.A.S.
  | "analyze_lease"             // Analizar contrato de arrendamiento
  | "generate_tokenization_clause" // Cláusula de tokenización para pacto accionistas
  | "investor_legal_qa"         // Responder pregunta legal de inversor
  | "compliance_review"         // Revisión de cumplimiento UIAF/Superfinanciera
  | "generic";                  // Uso genérico

export interface ClaudeJobRequest {
  type:       ClaudeJobType;
  prompt:     string;
  context?:   Record<string, unknown>;  // Datos adicionales (dirección, NIT, etc.)
  userId?:    string;                   // Wallet del usuario (para auditoría)
  propertyId?: string;
  maxTokens?: number;
  webhookUrl?: string;                  // Para recibir el resultado (opcional)
}

export interface ClaudeJobQueued {
  jobId:     string;
  status:    "queued";
  estimatedSecs: number;
}

export interface ClaudeJobResult {
  jobId:    string;
  status:   "completed" | "failed";
  content?: string;
  error?:   string;
  tokens?:  { input: number; output: number };
  durationMs?: number;
}

// ── System prompts por tipo ───────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<ClaudeJobType, string> = {
  draft_sas_escritura: `Eres un abogado especializado en derecho societario colombiano.
Tu función es redactar documentos de constitución de Sociedades por Acciones Simplificadas (S.A.S.)
bajo la Ley 1258 de 2008, específicamente para vehículos de propósito especial (SPV)
de tokenización inmobiliaria en Solana blockchain.

Lineamientos:
- Usar terminología legal colombiana correcta
- Incluir cláusulas de tokenización que vinculen tokens SPL con participación económica
- Mencionar que los tokens son evidencia digital bajo Ley 527/1999
- No incluir asesoramiento financiero, solo redacción legal
- Formato: escritura formal, párrafos numerados`,

  analyze_lease: `Eres un especialista en derecho inmobiliario colombiano.
Analiza contratos de arrendamiento identificando:
1. Cláusulas de riesgo para la S.A.S. tokenizadora
2. Compatibilidad con distribución de renta a múltiples tenedores de tokens
3. Cláusulas que requieren aprobación de la comunidad de inversores
4. Cumplimiento con Ley 820 de 2003 (arrendamiento urbano)
Responde con bullet points claros y riesgo identificado (ALTO/MEDIO/BAJO).`,

  generate_tokenization_clause: `Redacta cláusulas legales para pactos de accionistas de S.A.S.
colombianas que incorporen tokenización blockchain. Las cláusulas deben:
- Vincular tokens SPL de Solana con derechos económicos (no de dominio)
- Especificar que transferencia de tokens = transferencia de derechos económicos
- Incluir mecanismo de distribución de utilidades proporcional a tokens
- Cumplir Ley 1258/2008 y Decreto 1925/2009
- Ser ejecutables ante notario colombiano`,

  investor_legal_qa: `Eres el asistente legal de Mampostera, plataforma de inversión fraccionada
en bienes raíces tokenizados en Colombia. Respondes preguntas de inversores sobre:
- Estructura legal de las inversiones (S.A.S., tokens SPL)
- Implicaciones tributarias (DIAN, retención en la fuente)
- Derechos de los tenedores de tokens
- Proceso de distribución de renta
- Liquidez y mercado secundario

IMPORTANTE: Siempre aclarar que no es asesoramiento legal formal y recomendar
consultar un abogado para decisiones específicas. Citar la ley colombiana aplicable.`,

  compliance_review: `Analiza cumplimiento regulatorio colombiano para operaciones de tokenización
inmobiliaria. Verifica cumplimiento con:
- UIAF: Reporte de operaciones sospechosas (ROS), señales de alertas
- Superfinanciera: Si la actividad requiere inscripción como intermediario
- DIAN: Tratamiento tributario de tokens y distribución de utilidades
- Ley 1231 de 2008: Si aplica para la estructuración
- Circular 029 Superfinanciera: Activos digitales
Clasificar cada punto: CUMPLE / RIESGO / REQUIERE ACCIÓN.`,

  generic: `Eres un asistente legal especializado en derecho colombiano, blockchain,
tokenización de activos reales (RWA) y regulación fintech en Latinoamérica.
Responde con precisión legal y cita las normas aplicables.`,
};

// ── Función principal: encolar job ────────────────────────────────────────────

/**
 * Encola un job de Claude en QStash.
 * Retorna inmediatamente con un jobId — no bloquea el UI.
 *
 * @example
 * // En una API route:
 * const job = await enqueueClaudeJob({
 *   type: "draft_sas_escritura",
 *   prompt: "Redactar escritura para propiedad en Cra 7 #45-12 Bogotá",
 *   context: { propertyAddress: "Cra 7 #45-12", city: "Bogotá" },
 *   userId: walletAddress,
 * });
 * return Response.json(job, { status: 202 });
 */
export async function enqueueClaudeJob(
  request: ClaudeJobRequest
): Promise<ClaudeJobQueued> {
  const jobId = `claude-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await queueJob({
    jobId,
    handler: "legal-ai",
    payload:  { ...request, jobId },
    // Claude jobs tienen prioridad baja — no son urgentes
    delay:   0,
    retries: 2,
  });

  const estimatedSecs =
    request.type === "draft_sas_escritura" ? 30 :
    request.type === "analyze_lease"       ? 20 :
    15;

  return { jobId, status: "queued", estimatedSecs };
}

// ── Ejecutar job (llamado por el worker de QStash) ────────────────────────────

/**
 * Ejecuta la llamada real a Claude API.
 * Esta función corre en el worker de QStash, NO en el request path del usuario.
 * Se llama desde /api/legal/ai/route.ts cuando QStash entrega el job.
 */
export async function executeClaudeJob(
  request: ClaudeJobRequest & { jobId: string }
): Promise<ClaudeJobResult> {
  const startMs = Date.now();

  try {
    const apiKey = await getSecret(SecretKey.ANTHROPIC_API_KEY);
    const client = new Anthropic({ apiKey });

    const systemPrompt = SYSTEM_PROMPTS[request.type] ?? SYSTEM_PROMPTS.generic;
    const maxTokens    = request.maxTokens ?? 2048;

    // Construir el prompt con contexto adicional si existe
    let userMessage = request.prompt;
    if (request.context && Object.keys(request.context).length > 0) {
      userMessage +=
        "\n\n**Contexto adicional:**\n" +
        Object.entries(request.context)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n");
    }

    const message = await client.messages.create({
      model:      "claude-opus-4-6",   // Máxima calidad para documentos legales
      max_tokens: maxTokens,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userMessage }],
    });

    const content = message.content
      .filter((b) => b.type === "text")
      .map((b)   => (b as Anthropic.TextBlock).text)
      .join("\n");

    return {
      jobId:     request.jobId,
      status:    "completed",
      content,
      tokens:    {
        input:  message.usage.input_tokens,
        output: message.usage.output_tokens,
      },
      durationMs: Date.now() - startMs,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[claude] Job ${request.jobId} failed: ${error}`);
    return {
      jobId:     request.jobId,
      status:    "failed",
      error,
      durationMs: Date.now() - startMs,
    };
  }
}

// ── Llamada directa (para casos sincrónicos simples) ──────────────────────────

/**
 * Llamada directa a Claude — solo para casos donde la latencia es aceptable.
 * Preferir siempre enqueueClaudeJob() para el UI.
 * Uso principal: jobs internos, scripts, pre-generación de documentos.
 */
export async function askClaude(
  prompt:  string,
  type:    ClaudeJobType = "generic",
  options: { maxTokens?: number } = {}
): Promise<string> {
  const apiKey = await getSecret(SecretKey.ANTHROPIC_API_KEY);
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model:      "claude-sonnet-4-6",  // Más rápido para llamadas directas
    max_tokens: options.maxTokens ?? 1024,
    system:     SYSTEM_PROMPTS[type],
    messages:   [{ role: "user", content: prompt }],
  });

  return message.content
    .filter((b) => b.type === "text")
    .map((b)   => (b as Anthropic.TextBlock).text)
    .join("\n");
}
