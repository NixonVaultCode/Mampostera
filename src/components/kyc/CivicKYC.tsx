/**
 * components/kyc/CivicKYC.tsx
 * Full Civic Pass on-chain KYC integration for Solana Testnet.
 *
 * Install:  yarn add @civic/solana-gateway-react
 * Docs:     https://docs.civic.com/integration-guides/civic-idv-services/
 */

"use client";
import React, { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { CIVIC_GATEKEEPER_NETWORK } from "../../lib/program";
import type { KYCState, KYCStatus } from "../../types";

// ── Types matching @civic/solana-gateway-react ─────────────────
interface GatewayToken {
  publicKey: PublicKey;
  isValid: () => boolean;
  expiryTime?: number;
  state: "ACTIVE" | "REVOKED" | "FROZEN";
}

// ── Hook: read gateway token from chain ───────────────────────
export function useCivicKYC(): KYCState & {
  refresh: () => void;
  requestVerification: () => void;
} {
  const { publicKey, connected } = useWallet();
  const { connection }           = useConnection();
  const [state, setState]        = useState<KYCState>({ status: "unchecked", network: "civic" });

  const check = useCallback(async () => {
    if (!publicKey || !connected) {
      setState({ status: "unchecked", network: "civic" });
      return;
    }

    setState(prev => ({ ...prev, status: "pending" }));

    try {
      // Derive gateway token PDA: seeds = ["gateway", wallet, gatekeeper_network]
      const [gatewayPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("gateway"),
          publicKey.toBuffer(),
          CIVIC_GATEKEEPER_NETWORK.toBuffer(),
        ],
        new PublicKey("gatem74V238djXdzWnJf94Wo1DcnuGkfijbf3AuBhfs")
      );

      const accountInfo = await connection.getAccountInfo(gatewayPDA);

      if (!accountInfo) {
        setState({ status: "failed", network: "civic" });
        return;
      }

      // Civic gateway token layout: byte 0 = state (0=Active,1=Revoked,2=Frozen)
      // bytes 56-64 = expiry timestamp (i64 little-endian)
      const stateByteVal = accountInfo.data[0];
      const expiryBytes  = accountInfo.data.slice(56, 64);
      const expiryTs     = Number(
        expiryBytes.reduce((acc, b, i) => acc + BigInt(b) * (BigInt(256) ** BigInt(i)), BigInt(0))
      );
      const expiresAt = expiryTs > 0 ? new Date(expiryTs * 1000) : undefined;
      const isExpired  = expiresAt ? expiresAt < new Date() : false;

      if (stateByteVal === 0 && !isExpired) {
        setState({
          status:       "verified",
          gatewayToken: gatewayPDA.toBase58(),
          expiresAt,
          network:      "civic",
        });
      } else if (isExpired) {
        setState({ status: "expired", expiresAt, network: "civic" });
      } else {
        setState({ status: "failed", network: "civic" });
      }
    } catch (err) {
      console.warn("Civic KYC check error:", err);
      setState({ status: "failed", network: "civic" });
    }
  }, [publicKey, connected, connection]);

  useEffect(() => { check(); }, [check]);

  const requestVerification = useCallback(() => {
    // Opens Civic's hosted verification flow in a new tab
    const url = `https://getpass.civic.com/?network=testnet&wallet=${publicKey?.toBase58() ?? ""}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [publicKey]);

  return { ...state, refresh: check, requestVerification };
}

// ── KYC Status Badge ─────────────────────────────────────────
export function KYCBadge({ status }: { status: KYCStatus }) {
  const configs: Record<KYCStatus, { label: string; color: string; bg: string; icon: string }> = {
    unchecked: { label: "Sin verificar",  color: "#7b8799", bg: "rgba(123,135,153,0.12)", icon: "○" },
    pending:   { label: "Verificando…",   color: "#f0c040", bg: "rgba(240,192,64,0.12)",  icon: "◌" },
    verified:  { label: "KYC Verificado", color: "#14f195", bg: "rgba(20,241,149,0.12)",  icon: "✓" },
    failed:    { label: "No verificado",  color: "#ff6b6b", bg: "rgba(255,107,107,0.12)", icon: "✕" },
    expired:   { label: "KYC Expirado",   color: "#ff9f43", bg: "rgba(255,159,67,0.12)",  icon: "⚠" },
  };
  const c = configs[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "5px",
      fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em",
      color: c.color, background: c.bg,
      border: `1px solid ${c.color}33`,
      borderRadius: "20px", padding: "3px 10px",
    }}>
      <span>{c.icon}</span>
      {c.label}
    </span>
  );
}

// ── Full KYC Panel Component ──────────────────────────────────
export function CivicKYCPanel() {
  const { status, gatewayToken, expiresAt, refresh, requestVerification } = useCivicKYC();
  const { connected } = useWallet();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="kyc-panel">
      <div className="kyc-header" onClick={() => setExpanded(e => !e)}>
        <div className="kyc-header-left">
          <div className="kyc-shield">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z"
                fill={status === "verified" ? "rgba(20,241,149,0.2)" : "rgba(153,69,255,0.2)"}
                stroke={status === "verified" ? "#14f195" : "#9945ff"}
                strokeWidth="1.5"/>
              {status === "verified" && (
                <path d="M9 12l2 2 4-4" stroke="#14f195" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              )}
            </svg>
          </div>
          <div>
            <span className="kyc-title">Verificación KYC</span>
            <span className="kyc-provider">Powered by Civic Pass · Solana Testnet</span>
          </div>
        </div>
        <div className="kyc-header-right">
          <KYCBadge status={status}/>
          <span className="kyc-chevron">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div className="kyc-body">
          {!connected && (
            <div className="kyc-notice kyc-notice-neutral">
              Conecta tu wallet para verificar tu identidad on-chain.
            </div>
          )}

          {connected && status === "verified" && (
            <div className="kyc-verified-info">
              <div className="kyc-info-row">
                <span className="ki-label">Gateway Token</span>
                <code className="ki-val">{gatewayToken?.slice(0,20)}…</code>
              </div>
              {expiresAt && (
                <div className="kyc-info-row">
                  <span className="ki-label">Expira</span>
                  <span className="ki-val">{expiresAt.toLocaleDateString("es-CO")}</span>
                </div>
              )}
              <div className="kyc-info-row">
                <span className="ki-label">Red</span>
                <span className="ki-val">Solana Testnet</span>
              </div>
              <div className="kyc-info-row">
                <span className="ki-label">Gatekeeper</span>
                <code className="ki-val">{CIVIC_GATEKEEPER_NETWORK.toBase58().slice(0,16)}…</code>
              </div>
              <div className="kyc-notice kyc-notice-success">
                ✅ Tu identidad está verificada on-chain. Puedes invertir en todas las propiedades.
              </div>
            </div>
          )}

          {connected && (status === "failed" || status === "unchecked") && (
            <div>
              <div className="kyc-steps">
                {[
                  { n: "1", text: "Haz clic en 'Iniciar verificación Civic'" },
                  { n: "2", text: "Completa el proceso de identidad (ID + selfie)" },
                  { n: "3", text: "Civic emite un Gateway Token on-chain en ~2 min" },
                  { n: "4", text: "Regresa aquí y haz clic en 'Verificar estado'" },
                ].map(s => (
                  <div key={s.n} className="kyc-step">
                    <span className="ks-num">{s.n}</span>
                    <span className="ks-text">{s.text}</span>
                  </div>
                ))}
              </div>
              <div className="kyc-actions">
                <button className="kyc-btn-primary" onClick={requestVerification}>
                  Iniciar verificación Civic →
                </button>
                <button className="kyc-btn-secondary" onClick={refresh}>
                  Verificar estado
                </button>
              </div>
            </div>
          )}

          {connected && status === "expired" && (
            <div>
              <div className="kyc-notice kyc-notice-warn">
                ⚠️ Tu Gateway Token expiró el {expiresAt?.toLocaleDateString("es-CO")}. Renueva tu verificación.
              </div>
              <div className="kyc-actions">
                <button className="kyc-btn-primary" onClick={requestVerification}>
                  Renovar verificación →
                </button>
              </div>
            </div>
          )}

          {connected && status === "pending" && (
            <div className="kyc-notice kyc-notice-neutral">
              <span className="kyc-spinner"/>
              Consultando Gateway Token on-chain…
            </div>
          )}
        </div>
      )}

      <style>{`
        .kyc-panel { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        .kyc-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; cursor: pointer; transition: background .15s; }
        .kyc-header:hover { background: var(--bg3); }
        .kyc-header-left { display: flex; align-items: center; gap: 10px; }
        .kyc-shield { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: var(--bg3); border-radius: 8px; }
        .kyc-title { display: block; font-size: 13px; font-weight: 700; }
        .kyc-provider { display: block; font-size: 10px; color: var(--text3); margin-top: 1px; }
        .kyc-header-right { display: flex; align-items: center; gap: 10px; }
        .kyc-chevron { font-size: 9px; color: var(--text3); }
        .kyc-body { padding: 0 16px 16px; border-top: 1px solid var(--border); padding-top: 14px; }
        .kyc-notice { font-size: 12px; border-radius: 8px; padding: 10px 12px; line-height: 1.5; display: flex; align-items: center; gap: 8px; }
        .kyc-notice-neutral { background: var(--bg3); color: var(--text2); }
        .kyc-notice-success { background: rgba(20,241,149,0.08); color: #14f195; border: 1px solid rgba(20,241,149,0.2); margin-top: 12px; }
        .kyc-notice-warn { background: rgba(255,159,67,0.08); color: #ff9f43; border: 1px solid rgba(255,159,67,0.2); }
        .kyc-spinner { width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.15); border-top-color: var(--text2); border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .kyc-verified-info { display: flex; flex-direction: column; gap: 8px; }
        .kyc-info-row { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
        .ki-label { color: var(--text3); }
        .ki-val { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text2); }
        .kyc-steps { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
        .kyc-step { display: flex; align-items: flex-start; gap: 10px; font-size: 12px; color: var(--text2); }
        .ks-num { width: 18px; height: 18px; border-radius: 50%; background: var(--bg4); color: var(--text3); font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .kyc-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .kyc-btn-primary { flex: 1; background: #9945ff; color: #fff; font-size: 12px; font-weight: 700; border: none; border-radius: 7px; padding: 9px 14px; cursor: pointer; transition: opacity .15s; min-width: 160px; }
        .kyc-btn-primary:hover { opacity: .85; }
        .kyc-btn-secondary { background: transparent; border: 1px solid var(--border2); color: var(--text2); font-size: 12px; font-weight: 600; border-radius: 7px; padding: 9px 14px; cursor: pointer; transition: all .15s; }
        .kyc-btn-secondary:hover { color: var(--text); border-color: var(--text3); }
      `}</style>
    </div>
  );
}
