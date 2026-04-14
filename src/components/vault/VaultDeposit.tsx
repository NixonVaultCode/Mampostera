/**
 * components/vault/VaultDeposit.tsx
 *
 * Módulo PERIFÉRICO — Vault de Garantía para tokens MAMP.
 * Interactúa con el programa `mampostera_vault` (programs/mampostera_vault/src/lib.rs).
 * NO modifica el lib.rs original de Mampostera.
 *
 * Prerequisitos:
 *   1. KYC Civic activo
 *   2. Entidad jurídica SAS registrada (verificada contra VaultConfig.legal_entity_hash)
 *
 * Instrucciones soportadas:
 *   - lock_tokens   → bloquea MAMP + emite DepositReceipt
 *   - unlock_tokens → reclama MAMP + interés (si expiró el período)
 */

"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, VersionedTransaction, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useCivicKYC } from "../kyc/CivicKYC";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN — Actualiza estas constantes tras el deploy
// ─────────────────────────────────────────────────────────────────────────────

const VAULT_PROGRAM_ID = new PublicKey("VAULTMAMP11111111111111111111111111111111111");
const MAMP_MINT        = new PublicKey("MAMPoSTERA11111111111111111111111111111111");

// PDA seeds helper
async function findVaultConfig(adminPubkey: PublicKey): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress(
    [Buffer.from("vault_config"), adminPubkey.toBuffer()],
    VAULT_PROGRAM_ID
  );
}

async function findDepositReceipt(
  holderPubkey: PublicKey,
  lockedAtTs: bigint
): Promise<[PublicKey, number]> {
  const tsBytes = Buffer.alloc(8);
  tsBytes.writeBigInt64LE(lockedAtTs, 0);
  return PublicKey.findProgramAddress(
    [Buffer.from("receipt"), holderPubkey.toBuffer(), tsBytes],
    VAULT_PROGRAM_ID
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

export interface DepositReceiptUI {
  pda:           string;
  amountLocked:  number;
  lockedAt:      Date;
  unlockAt:      Date;
  yieldBps:      number;
  isClaimed:     boolean;
  estimatedYield: number; // tokens de interés estimados
}

export interface VaultInfo {
  adminPubkey:      string;
  legalEntityHash:  string;
  annualYieldBps:   number;
  totalLocked:      number;
  isActive:         boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────

function calcEstimatedYield(amount: number, durationDays: number, yieldBps: number): number {
  return Math.floor((amount * yieldBps * durationDays) / (10000 * 365));
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function daysFromSeconds(s: number): string {
  const d = Math.floor(s / 86400);
  if (d >= 30) return `${Math.floor(d / 30)} meses`;
  return `${d} días`;
}

const DURATION_OPTIONS = [
  { label: "30 días",   secs: 30  * 86400 },
  { label: "90 días",   secs: 90  * 86400 },
  { label: "180 días",  secs: 180 * 86400 },
  { label: "365 días",  secs: 365 * 86400 },
];

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export default function VaultDeposit() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection }         = useConnection();
  const { status: kycStatus }  = useCivicKYC();

  const [mampBalance,   setMampBalance]   = useState(0);
  const [vaultInfo,     setVaultInfo]     = useState<VaultInfo | null>(null);
  const [receipts,      setReceipts]      = useState<DepositReceiptUI[]>([]);
  const [lockAmount,    setLockAmount]    = useState("");
  const [lockDuration,  setLockDuration]  = useState(DURATION_OPTIONS[1].secs);
  const [loading,       setLoading]       = useState(false);
  const [txStatus,      setTxStatus]      = useState<string | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [activeTab,     setActiveTab]     = useState<"lock" | "receipts">("lock");

  // ── Cargar balance MAMP ──────────────────────────────────────────────────
  const loadBalance = useCallback(async () => {
    if (!publicKey || !connected) return;
    try {
      const ata  = getAssociatedTokenAddressSync(MAMP_MINT, publicKey);
      const acct = await getAccount(connection, ata);
      setMampBalance(Number(acct.amount));
    } catch {
      setMampBalance(0);
    }
  }, [publicKey, connected, connection]);

  // ── Cargar info del vault (mock mientras no está deployed) ───────────────
  const loadVaultInfo = useCallback(async () => {
    // En producción: deserializa VaultConfig PDA con Anchor IDL
    // Mock para demo:
    setVaultInfo({
      adminPubkey:     "AdminWallet111111111111111111111111111",
      legalEntityHash: "a".repeat(64), // SHA-256 del acta SAS real
      annualYieldBps:  500,            // 5% APY
      totalLocked:     42000,
      isActive:        true,
    });
  }, []);

  // ── Cargar recibos del holder ────────────────────────────────────────────
  const loadReceipts = useCallback(async () => {
    if (!publicKey) return;
    // En producción: getProgramAccounts filtrando por holder pubkey
    // Mock para demo:
    const now = Date.now();
    setReceipts([
      {
        pda:           "RCPT111...",
        amountLocked:  500,
        lockedAt:      new Date(now - 45 * 86400000),
        unlockAt:      new Date(now + 45 * 86400000),
        yieldBps:      500,
        isClaimed:     false,
        estimatedYield: calcEstimatedYield(500, 90, 500),
      },
    ]);
  }, [publicKey]);

  useEffect(() => {
    loadBalance();
    loadVaultInfo();
    loadReceipts();
  }, [loadBalance, loadVaultInfo, loadReceipts]);

  // ── BLOQUEAR TOKENS ──────────────────────────────────────────────────────
  const handleLock = async () => {
    if (!publicKey || !connected) return;
    setError(null);
    setTxStatus(null);

    // ── Prerequisito 1: KYC ────────────────────────────────────────────────
    if (kycStatus !== "verified") {
      setError("⛔ KYC de Civic requerido. Completa la verificación para usar el vault.");
      return;
    }

    // ── Prerequisito 2: SAS ────────────────────────────────────────────────
    if (!vaultInfo?.legalEntityHash || vaultInfo.legalEntityHash.length !== 64) {
      setError("⛔ El vault no tiene una entidad jurídica SAS registrada.");
      return;
    }

    const amount = parseInt(lockAmount, 10);
    if (!amount || amount <= 0) { setError("Ingresa un monto válido."); return; }
    if (amount > mampBalance)   { setError("Saldo MAMP insuficiente."); return; }
    if (!vaultInfo?.isActive)   { setError("El vault está pausado."); return; }

    setLoading(true);
    setTxStatus("⏳ Preparando transacción…");

    try {
      /**
       * En producción usarías el IDL generado por Anchor:
       *
       * const program = new Program(IDL, VAULT_PROGRAM_ID, provider);
       * const tx = await program.methods
       *   .lockTokens(new BN(amount), new BN(lockDuration))
       *   .accounts({ ... })
       *   .transaction();
       *
       * Por ahora construimos una tx placeholder para demostrar el flujo.
       */
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey:   publicKey, // placeholder
          lamports:   1,
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer        = publicKey;

      setTxStatus("✍️ Esperando firma de wallet…");
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      setTxStatus(`✅ Tokens bloqueados. TX: ${sig.slice(0, 16)}…`);
      setLockAmount("");
      await loadBalance();
      await loadReceipts();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Error: ${msg}`);
      setTxStatus(null);
    } finally {
      setLoading(false);
    }
  };

  // ── RECLAMAR (UNLOCK) ────────────────────────────────────────────────────
  const handleUnlock = async (receipt: DepositReceiptUI) => {
    if (!publicKey || !connected) return;
    setError(null);
    setTxStatus(null);

    if (kycStatus !== "verified") {
      setError("⛔ KYC de Civic requerido para reclamar tokens.");
      return;
    }
    if (new Date() < receipt.unlockAt) {
      setError(`⛔ El período de bloqueo termina el ${formatDate(receipt.unlockAt)}.`);
      return;
    }

    setLoading(true);
    setTxStatus("⏳ Preparando reclamo…");
    try {
      // En producción: program.methods.unlockTokens().accounts({...}).transaction()
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: publicKey, lamports: 1 })
      );
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash  = blockhash;
      tx.feePayer         = publicKey;

      setTxStatus("✍️ Esperando firma de wallet…");
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      setTxStatus(`✅ ${receipt.amountLocked + receipt.estimatedYield} MAMP reclamados. TX: ${sig.slice(0,16)}…`);
      await loadBalance();
      await loadReceipts();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Error: ${msg}`);
      setTxStatus(null);
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const durationDays   = Math.floor(lockDuration / 86400);
  const estimatedYield = calcEstimatedYield(parseInt(lockAmount) || 0, durationDays, vaultInfo?.annualYieldBps ?? 500);

  return (
    <div style={S.wrapper}>
      {/* ── HEADER ───────────────────────────────────────────────────────── */}
      <div style={S.header}>
        <div>
          <h2 style={S.title}>🔒 Vault de Garantía MAMP</h2>
          <p style={S.subtitle}>Bloquea tokens MAMP y recibe un recibo de depósito on-chain</p>
        </div>
        {vaultInfo && (
          <div style={S.vaultStats}>
            <div style={S.statItem}>
              <span style={S.statLabel}>APY</span>
              <span style={S.statVal}>{(vaultInfo.annualYieldBps / 100).toFixed(1)}%</span>
            </div>
            <div style={S.statItem}>
              <span style={S.statLabel}>Total bloqueado</span>
              <span style={S.statVal}>{vaultInfo.totalLocked.toLocaleString()} MAMP</span>
            </div>
            <div style={{ ...S.chip, background: vaultInfo.isActive ? "#14532d" : "#7f1d1d", color: vaultInfo.isActive ? "#86efac" : "#fca5a5" }}>
              {vaultInfo.isActive ? "● Activo" : "● Pausado"}
            </div>
          </div>
        )}
      </div>

      {/* ── PREREQUISITOS ───────────────────────────────────────────────── */}
      <div style={S.prereqRow}>
        <div style={{ ...S.prereqChip, background: kycStatus === "verified" ? "#0f2414" : "#1a0a0a", border: `1px solid ${kycStatus === "verified" ? "#166534" : "#7f1d1d"}` }}>
          {kycStatus === "verified" ? "✅" : "❌"} KYC Civic
        </div>
        <div style={{ ...S.prereqChip, background: vaultInfo?.legalEntityHash ? "#0f2414" : "#1a0a0a", border: `1px solid ${vaultInfo?.legalEntityHash ? "#166534" : "#7f1d1d"}` }}>
          {vaultInfo?.legalEntityHash ? "✅" : "❌"} Entidad SAS
        </div>
        <div style={S.prereqChip}>
          💼 {connected ? `${mampBalance.toLocaleString()} MAMP disponibles` : "Wallet desconectada"}
        </div>
      </div>

      {/* ── TABS ─────────────────────────────────────────────────────────── */}
      <div style={S.tabs}>
        {(["lock", "receipts"] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{ ...S.tab, ...(activeTab === t ? S.tabActive : {}) }}
          >
            {t === "lock" ? "🔒 Bloquear MAMP" : `📄 Mis Recibos (${receipts.filter(r => !r.isClaimed).length})`}
          </button>
        ))}
      </div>

      {/* ── MENSAJES ─────────────────────────────────────────────────────── */}
      {error    && <div style={S.errorBox}>{error}</div>}
      {txStatus && <div style={{ ...S.infoBox, background: txStatus.startsWith("✅") ? "#0a1a0a" : "#0d1117", borderColor: txStatus.startsWith("✅") ? "#22c55e" : "#4f46e5" }}>{txStatus}</div>}

      {/* ── TAB: LOCK ────────────────────────────────────────────────────── */}
      {activeTab === "lock" && (
        <div style={S.card}>
          <h3 style={S.cardTitle}>Bloquear tokens MAMP</h3>

          <label style={S.label}>Cantidad de MAMP a bloquear</label>
          <div style={S.inputRow}>
            <input
              type="number"
              min="1"
              max={mampBalance}
              value={lockAmount}
              onChange={e => setLockAmount(e.target.value)}
              placeholder="Ej: 100"
              style={S.input}
            />
            <button
              onClick={() => setLockAmount(String(mampBalance))}
              style={S.maxBtn}
            >
              MAX
            </button>
          </div>

          <label style={S.label}>Período de bloqueo</label>
          <div style={S.durationGrid}>
            {DURATION_OPTIONS.map(opt => (
              <button
                key={opt.secs}
                onClick={() => setLockDuration(opt.secs)}
                style={{
                  ...S.durationBtn,
                  background: lockDuration === opt.secs ? "#312e81" : "#1e293b",
                  border:     lockDuration === opt.secs ? "1.5px solid #818cf8" : "1px solid #334155",
                  color:      lockDuration === opt.secs ? "#c7d2fe" : "#94a3b8",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Preview de rendimiento */}
          {lockAmount && parseInt(lockAmount) > 0 && (
            <div style={S.yieldPreview}>
              <div style={S.yieldRow}>
                <span>Principal bloqueado</span>
                <strong>{parseInt(lockAmount).toLocaleString()} MAMP</strong>
              </div>
              <div style={S.yieldRow}>
                <span>Período</span>
                <strong>{daysFromSeconds(lockDuration)}</strong>
              </div>
              <div style={S.yieldRow}>
                <span>APY ({(vaultInfo?.annualYieldBps ?? 500) / 100}%)</span>
                <strong style={{ color: "#86efac" }}>+{estimatedYield.toLocaleString()} MAMP</strong>
              </div>
              <div style={{ ...S.yieldRow, borderTop: "1px solid #334155", paddingTop: 8, marginTop: 4 }}>
                <span>Total al vencimiento</span>
                <strong style={{ color: "#a78bfa", fontSize: 16 }}>
                  {(parseInt(lockAmount) + estimatedYield).toLocaleString()} MAMP
                </strong>
              </div>
            </div>
          )}

          <button
            onClick={handleLock}
            disabled={loading || !connected || kycStatus !== "verified" || !lockAmount}
            style={{ ...S.primaryBtn, opacity: loading || !connected || kycStatus !== "verified" || !lockAmount ? 0.45 : 1 }}
          >
            {loading ? "⏳ Procesando…" : "🔒 Bloquear y emitir recibo"}
          </button>

          {kycStatus !== "verified" && (
            <p style={{ color: "#f59e0b", fontSize: 12, marginTop: 8 }}>
              ⚠️ Completa el KYC de Civic para desbloquear el vault.
            </p>
          )}
        </div>
      )}

      {/* ── TAB: RECIBOS ─────────────────────────────────────────────────── */}
      {activeTab === "receipts" && (
        <div>
          {receipts.length === 0 ? (
            <div style={S.emptyState}>
              <div style={{ fontSize: 32 }}>📭</div>
              <p>No tienes recibos de depósito activos.</p>
            </div>
          ) : (
            receipts.map((r, i) => {
              const isReady   = new Date() >= r.unlockAt;
              const progress  = Math.min(100, ((Date.now() - r.lockedAt.getTime()) / (r.unlockAt.getTime() - r.lockedAt.getTime())) * 100);

              return (
                <div key={i} style={S.receiptCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <span style={S.receiptId}>Recibo #{r.pda.slice(0, 10)}…</span>
                      <div style={{ marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <span style={S.receiptStat}><strong>{r.amountLocked.toLocaleString()}</strong> MAMP bloqueados</span>
                        <span style={{ ...S.receiptStat, color: "#86efac" }}>+{r.estimatedYield} MAMP interés</span>
                      </div>
                    </div>
                    <div style={{ ...S.chip, background: r.isClaimed ? "#374151" : isReady ? "#14532d" : "#1e3a5f", color: r.isClaimed ? "#9ca3af" : isReady ? "#86efac" : "#93c5fd" }}>
                      {r.isClaimed ? "Reclamado" : isReady ? "✅ Listo" : "🔒 Bloqueado"}
                    </div>
                  </div>

                  {/* Barra de progreso */}
                  <div style={S.progressTrack}>
                    <div style={{ ...S.progressBar, width: `${progress}%` }} />
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginTop: 4 }}>
                    <span>Bloqueado: {formatDate(r.lockedAt)}</span>
                    <span>Vence: {formatDate(r.unlockAt)}</span>
                  </div>

                  {isReady && !r.isClaimed && (
                    <button
                      onClick={() => handleUnlock(r)}
                      disabled={loading}
                      style={{ ...S.primaryBtn, marginTop: 12, background: "#0f766e" }}
                    >
                      {loading ? "⏳ Reclamando…" : `💰 Reclamar ${(r.amountLocked + r.estimatedYield).toLocaleString()} MAMP`}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ESTILOS
// ─────────────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  wrapper:      { background: "#0f172a", borderRadius: 14, padding: "28px 24px", color: "#e2e8f0", fontFamily: "Inter, system-ui, sans-serif" },
  header:       { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, marginBottom: 18 },
  title:        { margin: 0, fontSize: 22, fontWeight: 700, color: "#f1f5f9" },
  subtitle:     { margin: "4px 0 0", fontSize: 13, color: "#64748b" },
  vaultStats:   { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" },
  statItem:     { display: "flex", flexDirection: "column", alignItems: "flex-end" },
  statLabel:    { fontSize: 10, color: "#64748b", textTransform: "uppercase" as const },
  statVal:      { fontSize: 16, fontWeight: 700, color: "#f1f5f9" },
  prereqRow:    { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  prereqChip:   { background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: "4px 12px", fontSize: 12 },
  chip:         { borderRadius: 5, padding: "3px 9px", fontSize: 11, fontWeight: 600 },
  tabs:         { display: "flex", gap: 2, marginBottom: 18, borderBottom: "1px solid #1e293b", paddingBottom: 0 },
  tab:          { background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: "8px 16px", fontSize: 13, borderBottom: "2px solid transparent" },
  tabActive:    { color: "#a78bfa", borderBottom: "2px solid #7c3aed", fontWeight: 600 },
  errorBox:     { background: "#1a0a0a", border: "1px solid #ef4444", color: "#fca5a5", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 },
  infoBox:      { border: "1px solid #4f46e5", color: "#e2e8f0", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 },
  card:         { background: "#1e293b", borderRadius: 10, padding: "20px" },
  cardTitle:    { margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#f1f5f9" },
  label:        { display: "block", fontSize: 12, color: "#94a3b8", marginBottom: 6, marginTop: 14 },
  inputRow:     { display: "flex", gap: 8 },
  input:        { flex: 1, background: "#0f172a", border: "1px solid #334155", color: "#f1f5f9", borderRadius: 8, padding: "10px 14px", fontSize: 14, outline: "none" },
  maxBtn:       { background: "#312e81", color: "#c7d2fe", border: "none", borderRadius: 8, padding: "0 14px", cursor: "pointer", fontWeight: 700, fontSize: 12 },
  durationGrid: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 },
  durationBtn:  { borderRadius: 7, padding: "10px 4px", cursor: "pointer", fontSize: 12, fontWeight: 600 },
  yieldPreview: { background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "14px 16px", marginTop: 16 },
  yieldRow:     { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#94a3b8", padding: "3px 0" },
  primaryBtn:   { width: "100%", marginTop: 18, background: "#7c3aed", color: "#fff", border: "none", borderRadius: 9, padding: "13px", cursor: "pointer", fontWeight: 700, fontSize: 15 },
  emptyState:   { textAlign: "center" as const, color: "#64748b", padding: "40px 0" },
  receiptCard:  { background: "#1e293b", borderRadius: 10, padding: "16px", marginBottom: 12 },
  receiptId:    { fontSize: 11, color: "#64748b", fontFamily: "monospace" },
  receiptStat:  { fontSize: 13, color: "#94a3b8" },
  progressTrack:{ height: 6, background: "#0f172a", borderRadius: 3, margin: "10px 0 4px" },
  progressBar:  { height: "100%", background: "linear-gradient(90deg,#7c3aed,#06b6d4)", borderRadius: 3, transition: "width 0.5s" },
};
