/**
 * components/governance/GovernanceVoting.tsx
 *
 * Módulo PERIFÉRICO de gobernanza para Mampostera v4.
 * NO modifica lib.rs — opera 100% off-chain con firma de mensajes on-chain.
 *
 * Prerequisitos (igual que el resto de Mampostera):
 *   1. KYC activo via Civic gateway token
 *   2. El votante debe ser holder del `propertyMint` indicado
 *
 * Flujo:
 *   1. Admin crea una propuesta (almacenada localmente / en IPFS)
 *   2. Holder verifica KYC + balance de tokens
 *   3. Holder firma el mensaje de votación con su wallet (signMessage)
 *   4. La firma se registra en el estado del componente (y opcionalmente en IPFS)
 *
 * Para persistencia real, conecta `submitVote` a tu backend / Arweave / tableland.
 */

"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { useCivicKYC } from "../kyc/CivicKYC";

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

export type VoteChoice = "YES" | "NO" | "ABSTAIN";

export interface Proposal {
  id: string;          // UUID o hash
  title: string;
  description: string;
  propertyMint: string; // Solo holders de este mint pueden votar
  endsAt: Date;
  quorumTokens: number; // Tokens mínimos para validar resultado
  createdBy: string;   // Pubkey del admin
}

export interface CastVote {
  proposalId: string;
  voter: string;        // Pubkey
  choice: VoteChoice;
  tokenBalance: number;
  signature: string;   // Base58 de la firma Ed25519
  timestamp: number;
  message: string;     // Mensaje firmado en texto
}

export interface GovernanceProps {
  /** Propuestas activas para esta sesión */
  proposals?: Proposal[];
  /** Callback cuando se emite un voto — guárdalo en tu backend */
  onVoteCast?: (vote: CastVote) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────

function buildVoteMessage(proposal: Proposal, choice: VoteChoice, voter: string): string {
  return [
    "=== MAMPOSTERA GOVERNANCE VOTE ===",
    `Proposal ID : ${proposal.id}`,
    `Title       : ${proposal.title}`,
    `Property    : ${proposal.propertyMint}`,
    `Voter       : ${voter}`,
    `Choice      : ${choice}`,
    `Timestamp   : ${new Date().toISOString()}`,
    "==================================",
    "I confirm this vote with my Solana wallet. KYC verified via Civic.",
  ].join("\n");
}

function b58encode(bytes: Uint8Array): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let result = "";
  let n = BigInt("0x" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join(""));
  while (n > 0n) {
    result = ALPHABET[Number(n % 58n)] + result;
    n = n / 58n;
  }
  for (const byte of bytes) {
    if (byte === 0) result = "1" + result;
    else break;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROPUESTAS DE DEMO (reemplaza con fetch a tu backend)
// ─────────────────────────────────────────────────────────────────────────────

const DEMO_PROPOSALS: Proposal[] = [
  {
    id: "prop-2025-001",
    title: "Aprobación de contrato de arrendamiento — Carrera 7 #45-12",
    description:
      "Se somete a votación la aprobación del contrato de arrendamiento con Arrendatario S.A.S. " +
      "por un período de 24 meses a $4.500.000 COP/mes. Requiere mayoría simple (>50%).",
    propertyMint: "MAMPoSTERA11111111111111111111111111111111",
    endsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    quorumTokens: 1000,
    createdBy: "AdminWallet111111111111111111111111111",
  },
  {
    id: "prop-2025-002",
    title: "Distribución extraordinaria de rentas acumuladas Q1",
    description:
      "Distribución del excedente de $12.000.000 COP acumulados en Q1 2025 entre todos " +
      "los holders proporcional a su tenencia. Requiere quórum del 30%.",
    propertyMint: "MAMPoSTERA11111111111111111111111111111111",
    endsAt: new Date(Date.now() + 3 * 24 * 3600 * 1000),
    quorumTokens: 500,
    createdBy: "AdminWallet111111111111111111111111111",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export default function GovernanceVoting({
  proposals = DEMO_PROPOSALS,
  onVoteCast,
}: GovernanceProps) {
  const { publicKey, connected, signMessage } = useWallet();
  const { connection } = useConnection();
  const { status: kycStatus, refresh: refreshKYC } = useCivicKYC();

  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<VoteChoice | null>(null);
  const [tokenBalances, setTokenBalances] = useState<Record<string, number>>({});
  const [castVotes, setCastVotes] = useState<Record<string, CastVote>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // ── Verificar balance de tokens para cada propuesta ──────────────────────
  const fetchTokenBalances = useCallback(async () => {
    if (!publicKey || !connected) return;

    const balances: Record<string, number> = {};
    const mints = [...new Set(proposals.map(p => p.propertyMint))];

    await Promise.allSettled(
      mints.map(async (mintStr) => {
        try {
          const mint = new PublicKey(mintStr);
          const ata  = getAssociatedTokenAddressSync(mint, publicKey);
          const acct = await getAccount(connection, ata);
          balances[mintStr] = Number(acct.amount);
        } catch {
          balances[mintStr] = 0;
        }
      })
    );
    setTokenBalances(balances);
  }, [publicKey, connected, connection, proposals]);

  useEffect(() => {
    fetchTokenBalances();
  }, [fetchTokenBalances]);

  // ── EMITIR VOTO ───────────────────────────────────────────────────────────
  const handleCastVote = async () => {
    if (!selectedProposal || !selectedChoice || !publicKey || !signMessage) return;
    setError(null);
    setSuccessMsg(null);

    // ── Prerequisito 1: KYC Civic ─────────────────────────────────────────
    if (kycStatus !== "verified") {
      setError("⛔ Tu KYC de Civic no está activo. Completa la verificación antes de votar.");
      return;
    }

    // ── Prerequisito 2: Holder del mint ───────────────────────────────────
    const balance = tokenBalances[selectedProposal.propertyMint] ?? 0;
    if (balance === 0) {
      setError("⛔ No tienes tokens de esta propiedad. Solo los holders pueden votar.");
      return;
    }

    // ── Verificar plazo de votación ───────────────────────────────────────
    if (new Date() > selectedProposal.endsAt) {
      setError("⛔ El período de votación ha expirado.");
      return;
    }

    // ── Verificar voto duplicado ──────────────────────────────────────────
    const voteKey = `${selectedProposal.id}:${publicKey.toBase58()}`;
    if (castVotes[voteKey]) {
      setError("⚠️ Ya has votado en esta propuesta.");
      return;
    }

    setLoading(true);
    try {
      const voterStr  = publicKey.toBase58();
      const message   = buildVoteMessage(selectedProposal, selectedChoice, voterStr);
      const msgBytes  = new TextEncoder().encode(message);
      const sigBytes  = await signMessage(msgBytes);
      const signature = b58encode(sigBytes);

      const vote: CastVote = {
        proposalId:   selectedProposal.id,
        voter:        voterStr,
        choice:       selectedChoice,
        tokenBalance: balance,
        signature,
        timestamp:    Date.now(),
        message,
      };

      // Guardar localmente
      setCastVotes(prev => ({ ...prev, [voteKey]: vote }));

      // Callback externo (backend / IPFS / Tableland)
      if (onVoteCast) await onVoteCast(vote);

      setSuccessMsg(
        `✅ Voto "${selectedChoice}" registrado con firma: ${signature.slice(0, 16)}…`
      );
      setSelectedProposal(null);
      setSelectedChoice(null);
      setShowPreview(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Error al firmar: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  const kycBadge = () => {
    const map = {
      verified: { bg: "#14532d", color: "#86efac", text: "✅ KYC Activo" },
      pending:  { bg: "#713f12", color: "#fde68a", text: "⏳ KYC Pendiente" },
      failed:   { bg: "#7f1d1d", color: "#fca5a5", text: "❌ KYC Fallido" },
      expired:  { bg: "#7f1d1d", color: "#fca5a5", text: "⏰ KYC Expirado" },
      unchecked:{ bg: "#1e293b", color: "#94a3b8", text: "— KYC No verificado" },
    } as const;
    const s = map[kycStatus] ?? map.unchecked;
    return (
      <span style={{ background: s.bg, color: s.color, padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
        {s.text}
      </span>
    );
  };

  const timeLeft = (endsAt: Date) => {
    const ms = endsAt.getTime() - Date.now();
    if (ms <= 0) return "Expirado";
    const h = Math.floor(ms / 3600000);
    const d = Math.floor(h / 24);
    return d > 0 ? `${d}d ${h % 24}h restantes` : `${h}h restantes`;
  };

  const getVoteForProposal = (pid: string) =>
    publicKey ? castVotes[`${pid}:${publicKey.toBase58()}`] : undefined;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER PRINCIPAL
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={styles.wrapper}>
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>🗳️ Gobernanza Mampostera</h2>
          <p style={styles.subtitle}>Vota en propuestas de gestión de propiedades tokenizadas</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {kycBadge()}
          <button onClick={refreshKYC} style={styles.refreshBtn}>↻ KYC</button>
        </div>
      </div>

      {/* ── PRERREQUISITOS INFO ──────────────────────────────────────────── */}
      {kycStatus !== "verified" && connected && (
        <div style={styles.warningBox}>
          <strong>Prerequisitos para votar:</strong>
          <ul style={{ margin: "6px 0 0 0", paddingLeft: 18 }}>
            <li>KYC activo via <strong>Civic</strong> — complétalo en la sección KYC</li>
            <li>Ser holder del token de la propiedad correspondiente</li>
            <li>Entidad jurídica SAS vinculada al contrato de la propiedad</li>
          </ul>
        </div>
      )}

      {!connected && (
        <div style={styles.warningBox}>
          Conecta tu wallet para participar en la gobernanza.
        </div>
      )}

      {/* ── MENSAJES ─────────────────────────────────────────────────────── */}
      {error      && <div style={styles.errorBox}>{error}</div>}
      {successMsg && <div style={styles.successBox}>{successMsg}</div>}

      {/* ── LISTA DE PROPUESTAS ──────────────────────────────────────────── */}
      <div style={styles.proposalList}>
        {proposals.map(p => {
          const myVote    = getVoteForProposal(p.id);
          const balance   = tokenBalances[p.propertyMint] ?? 0;
          const isExpired = new Date() > p.endsAt;
          const canVote   = connected && kycStatus === "verified" && balance > 0 && !isExpired && !myVote;

          return (
            <div
              key={p.id}
              style={{
                ...styles.proposalCard,
                border: selectedProposal?.id === p.id
                  ? "1.5px solid #7c3aed"
                  : "1px solid #334155",
              }}
            >
              {/* Cabecera */}
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <span style={styles.proposalId}>{p.id}</span>
                <span style={{ ...styles.chip, background: isExpired ? "#374151" : "#1d4ed8" }}>
                  {timeLeft(p.endsAt)}
                </span>
              </div>

              <h3 style={styles.proposalTitle}>{p.title}</h3>
              <p style={styles.proposalDesc}>{p.description}</p>

              {/* Metadata */}
              <div style={styles.meta}>
                <span>🏠 Mint: <code style={styles.code}>{p.propertyMint.slice(0, 12)}…</code></span>
                <span>📊 Quórum: {p.quorumTokens.toLocaleString()} tokens</span>
                {connected && (
                  <span>💼 Tu balance: <strong style={{ color: balance > 0 ? "#86efac" : "#fca5a5" }}>
                    {balance.toLocaleString()} tokens
                  </strong></span>
                )}
              </div>

              {/* Estado de voto */}
              {myVote && (
                <div style={styles.votedBadge}>
                  ✅ Votaste <strong>{myVote.choice}</strong> con {myVote.tokenBalance} tokens
                  <br />
                  <span style={{ fontSize: 11, opacity: 0.7 }}>
                    Firma: {myVote.signature.slice(0, 20)}…
                  </span>
                </div>
              )}

              {/* Acción */}
              {canVote && (
                <button
                  onClick={() => {
                    setSelectedProposal(p);
                    setSelectedChoice(null);
                    setShowPreview(false);
                    setError(null);
                    setSuccessMsg(null);
                    // Scroll al panel de votación
                    setTimeout(() => document.getElementById("vote-panel")?.scrollIntoView({ behavior: "smooth" }), 100);
                  }}
                  style={styles.voteBtn}
                >
                  🗳️ Votar en esta propuesta
                </button>
              )}

              {!canVote && !myVote && !isExpired && connected && (
                <div style={{ ...styles.chip, marginTop: 10, display: "inline-block", background: "#374151" }}>
                  {balance === 0 ? "Sin tokens — no elegible" : "KYC requerido para votar"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── PANEL DE VOTACIÓN ───────────────────────────────────────────── */}
      {selectedProposal && (
        <div id="vote-panel" style={styles.votePanel}>
          <h3 style={{ margin: "0 0 8px", color: "#e2e8f0" }}>
            Emitir voto — <span style={{ color: "#a78bfa" }}>{selectedProposal.title}</span>
          </h3>
          <p style={{ color: "#94a3b8", margin: "0 0 16px", fontSize: 13 }}>
            Tu voto será firmado criptográficamente con tu wallet. No podrás cambiarlo.
          </p>

          {/* Opciones */}
          <div style={styles.choiceGrid}>
            {(["YES", "NO", "ABSTAIN"] as VoteChoice[]).map(c => (
              <button
                key={c}
                onClick={() => setSelectedChoice(c)}
                style={{
                  ...styles.choiceBtn,
                  background:
                    selectedChoice === c
                      ? c === "YES" ? "#14532d"
                        : c === "NO" ? "#7f1d1d"
                        : "#374151"
                      : "#1e293b",
                  border:
                    selectedChoice === c
                      ? `2px solid ${c === "YES" ? "#22c55e" : c === "NO" ? "#ef4444" : "#94a3b8"}`
                      : "1.5px solid #334155",
                  color:
                    selectedChoice === c
                      ? c === "YES" ? "#86efac" : c === "NO" ? "#fca5a5" : "#e2e8f0"
                      : "#94a3b8",
                }}
              >
                {c === "YES" ? "✅ A FAVOR" : c === "NO" ? "❌ EN CONTRA" : "⚪ ABSTENCIÓN"}
              </button>
            ))}
          </div>

          {/* Preview del mensaje */}
          {selectedChoice && (
            <>
              <button
                onClick={() => setShowPreview(!showPreview)}
                style={styles.previewToggle}
              >
                {showPreview ? "▲ Ocultar mensaje" : "▼ Ver mensaje a firmar"}
              </button>
              {showPreview && (
                <pre style={styles.messagePreview}>
                  {buildVoteMessage(
                    selectedProposal,
                    selectedChoice,
                    publicKey?.toBase58() ?? "—"
                  )}
                </pre>
              )}
            </>
          )}

          {/* Confirmar */}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              onClick={handleCastVote}
              disabled={!selectedChoice || loading}
              style={{
                ...styles.confirmBtn,
                opacity: !selectedChoice || loading ? 0.5 : 1,
              }}
            >
              {loading ? "⏳ Firmando…" : "🔏 Confirmar y firmar voto"}
            </button>
            <button
              onClick={() => { setSelectedProposal(null); setSelectedChoice(null); }}
              style={styles.cancelBtn}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ESTILOS
// ─────────────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  wrapper:     { background: "#0f172a", borderRadius: 14, padding: "28px 24px", color: "#e2e8f0", fontFamily: "Inter, system-ui, sans-serif" },
  header:      { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 20 },
  title:       { margin: 0, fontSize: 22, fontWeight: 700, color: "#f1f5f9" },
  subtitle:    { margin: "4px 0 0", fontSize: 13, color: "#64748b" },
  refreshBtn:  { background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 },
  warningBox:  { background: "#1e293b", border: "1px solid #f59e0b", color: "#fde68a", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13 },
  errorBox:    { background: "#1a0a0a", border: "1px solid #ef4444", color: "#fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 },
  successBox:  { background: "#0a1a0a", border: "1px solid #22c55e", color: "#86efac", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 },
  proposalList:{ display: "flex", flexDirection: "column", gap: 14 },
  proposalCard:{ background: "#1e293b", borderRadius: 10, padding: "18px 16px" },
  proposalId:  { fontSize: 11, color: "#64748b", fontFamily: "monospace" },
  proposalTitle:{ margin: "8px 0 6px", fontSize: 16, fontWeight: 600, color: "#f1f5f9" },
  proposalDesc: { margin: "0 0 12px", fontSize: 13, color: "#94a3b8", lineHeight: 1.55 },
  meta:        { display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, color: "#64748b", marginBottom: 12 },
  code:        { fontFamily: "monospace", color: "#a78bfa" },
  chip:        { background: "#1e293b", color: "#94a3b8", borderRadius: 5, padding: "2px 8px", fontSize: 11, fontWeight: 600 },
  votedBadge:  { background: "#0f2414", border: "1px solid #166534", color: "#86efac", borderRadius: 7, padding: "8px 12px", fontSize: 12, marginTop: 8 },
  voteBtn:     { marginTop: 10, background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", cursor: "pointer", fontWeight: 600, fontSize: 13 },
  votePanel:   { background: "#1a2234", border: "1.5px solid #4f46e5", borderRadius: 12, padding: "20px", marginTop: 20 },
  choiceGrid:  { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 },
  choiceBtn:   { borderRadius: 8, padding: "12px 8px", cursor: "pointer", fontWeight: 700, fontSize: 13, transition: "all 0.15s" },
  previewToggle:{ background: "none", border: "none", color: "#7c3aed", cursor: "pointer", fontSize: 12, padding: "4px 0" },
  messagePreview:{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "12px", fontSize: 11, color: "#94a3b8", whiteSpace: "pre-wrap", fontFamily: "monospace", marginTop: 8, maxHeight: 160, overflowY: "auto" },
  confirmBtn:  { background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", cursor: "pointer", fontWeight: 700, fontSize: 14 },
  cancelBtn:   { background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", borderRadius: 8, padding: "10px 16px", cursor: "pointer", fontSize: 13 },
};
