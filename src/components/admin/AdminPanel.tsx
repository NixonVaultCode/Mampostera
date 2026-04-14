/**
 * components/admin/AdminPanel.tsx
 * Admin panel: list new properties on-chain, toggle status, view all.
 * Only accessible to the program authority wallet.
 */

"use client";
import React, { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
// Web Crypto API — disponible en browser y Node 18+, no requiere import
// (window.crypto.subtle / globalThis.crypto.subtle)
import { useInitProperty, useToggleProperty } from "../../hooks/useMampostera";
import type { PropertyUI, NewPropertyForm, ToastType } from "../../types";

// ── Admin guard: only program authority ──────────────────────
const PROGRAM_AUTHORITY =
  process.env.NEXT_PUBLIC_AUTHORITY_PUBKEY || "";

function useIsAuthority(): boolean {
  const { publicKey } = useWallet();
  if (!publicKey || !PROGRAM_AUTHORITY) return false;
  try {
    return publicKey.equals(new PublicKey(PROGRAM_AUTHORITY));
  } catch { return false; }
}

// ── SHA-256 helper (browser-safe) ─────────────────────────────
async function sha256File(file: File): Promise<string> {
  const buf    = await file.arrayBuffer();
  const hash   = await globalThis.crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Default form ──────────────────────────────────────────────
const EMPTY_FORM: NewPropertyForm = {
  location:      "",
  city:          "",
  country:       "Colombia",
  totalValueUSD: 0,
  totalTokens:   1_000_000,
  legalDocHash:  "",
  ipfsCid:       "",
  apy:           8.0,
  propertyType:  "Apartamento",
};

// ── New Property Form ─────────────────────────────────────────
function NewPropertyForm_({
  push,
  onSuccess,
}: {
  push: (msg: string, type: ToastType, dur?: number) => number;
  onSuccess: () => void;
}) {
  const [form, setForm]             = useState<NewPropertyForm>(EMPTY_FORM);
  const [legalFile, setLegalFile]   = useState<File | null>(null);
  const [hashLoading, setHashLoading] = useState(false);
  const { submit, submitting }      = useInitProperty(push);

  const set = (k: keyof NewPropertyForm, v: any) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const handleLegalFile = useCallback(async (file: File) => {
    setLegalFile(file);
    setHashLoading(true);
    const hash = await sha256File(file);
    set("legalDocHash", hash);
    setHashLoading(false);
    push(`📄 Hash calculado: ${hash.slice(0, 16)}…`, "info");
  }, [push]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.location || !form.city)      return push("Ingresa ubicación y ciudad", "error");
    if (form.totalValueUSD <= 0)           return push("El valor debe ser mayor que 0", "error");
    if (form.legalDocHash.length !== 64)   return push("Sube el documento legal primero", "error");
    if (!form.ipfsCid.startsWith("Qm") && !form.ipfsCid.startsWith("baf"))
      return push("IPFS CID inválido", "error");

    const sig = await submit(form);
    if (sig) { setForm(EMPTY_FORM); setLegalFile(null); onSuccess(); }
  };

  return (
    <form className="admin-form" onSubmit={handleSubmit}>
      <div className="af-section-title">📍 Información de la propiedad</div>
      <div className="af-grid-2">
        <div className="af-field">
          <label>Dirección</label>
          <input value={form.location} onChange={e => set("location", e.target.value)}
            placeholder="Cra 7 #45-12" required/>
        </div>
        <div className="af-field">
          <label>Ciudad</label>
          <input value={form.city} onChange={e => set("city", e.target.value)}
            placeholder="Bogotá" required/>
        </div>
        <div className="af-field">
          <label>País</label>
          <input value={form.country} onChange={e => set("country", e.target.value)}/>
        </div>
        <div className="af-field">
          <label>Tipo</label>
          <select value={form.propertyType} onChange={e => set("propertyType", e.target.value)}>
            {["Apartamento","Casa","Oficina","Local Comercial","Bodega","Finca"].map(t => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="af-section-title">💵 Tokenomics</div>
      <div className="af-grid-3">
        <div className="af-field">
          <label>Valor total (USD)</label>
          <input type="number" min="1000" value={form.totalValueUSD || ""}
            onChange={e => set("totalValueUSD", Number(e.target.value))}
            placeholder="120000" required/>
        </div>
        <div className="af-field">
          <label>Total tokens</label>
          <input type="number" min="100" max="100000000"
            value={form.totalTokens}
            onChange={e => set("totalTokens", Number(e.target.value))}/>
          <span className="af-hint">
            Precio/token: ${form.totalValueUSD > 0 ? (form.totalValueUSD / form.totalTokens).toFixed(4) : "—"} USD
          </span>
        </div>
        <div className="af-field">
          <label>APY estimado (%)</label>
          <input type="number" step="0.1" min="0" max="100"
            value={form.apy}
            onChange={e => set("apy", Number(e.target.value))}/>
        </div>
      </div>

      <div className="af-section-title">📜 Documentación legal</div>
      <div className="af-field">
        <label>Documento legal (PDF — se calcula SHA-256 automáticamente)</label>
        <div className={`af-dropzone ${legalFile ? "af-dropzone-filled" : ""}`}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleLegalFile(f); }}>
          {legalFile ? (
            <span className="af-file-name">📄 {legalFile.name} · {(legalFile.size / 1024).toFixed(0)} KB</span>
          ) : (
            <span className="af-dropzone-hint">Arrastra el PDF de constitución de LLC aquí</span>
          )}
          <input type="file" accept=".pdf,.doc,.docx"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleLegalFile(f); }}
            className="af-file-input"/>
        </div>
        {hashLoading && <span className="af-hint">Calculando SHA-256…</span>}
        {form.legalDocHash && (
          <div className="af-hash-preview">
            <span className="af-hash-label">SHA-256:</span>
            <code>{form.legalDocHash}</code>
          </div>
        )}
      </div>

      <div className="af-field">
        <label>IPFS CID (documento en IPFS / Pinata)</label>
        <input value={form.ipfsCid}
          onChange={e => set("ipfsCid", e.target.value)}
          placeholder="QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"/>
        <span className="af-hint">
          Sube el PDF a{" "}
          <a href="https://app.pinata.cloud" target="_blank" rel="noreferrer">Pinata</a>
          {" "}o{" "}
          <a href="https://web3.storage" target="_blank" rel="noreferrer">web3.storage</a>
          {" "}y pega el CID aquí
        </span>
      </div>

      <div className="af-summary">
        <div className="af-sum-row">
          <span>Ubicación on-chain</span>
          <span>{form.location ? `${form.location}, ${form.city}, ${form.country}` : "—"}</span>
        </div>
        <div className="af-sum-row">
          <span>Valor total</span>
          <span>${form.totalValueUSD.toLocaleString()} USD ({(form.totalValueUSD * 100).toLocaleString()} cents)</span>
        </div>
        <div className="af-sum-row">
          <span>Total tokens SPL</span>
          <span>{form.totalTokens.toLocaleString()}</span>
        </div>
        <div className="af-sum-row af-sum-row-accent">
          <span>Network</span>
          <span>Solana Testnet</span>
        </div>
      </div>

      <button type="submit" className="af-submit" disabled={submitting}>
        {submitting ? (
          <><span className="btn-spinner"/><span>Enviando transacción…</span></>
        ) : (
          "⬡ Inicializar propiedad on-chain"
        )}
      </button>
    </form>
  );
}

// ── Property List Item (admin view) ──────────────────────────
function AdminPropertyRow({
  property,
  push,
  onRefresh,
}: {
  property: PropertyUI;
  push: (msg: string, type: ToastType, dur?: number) => number;
  onRefresh: () => void;
}) {
  const { toggle } = useToggleProperty(push);
  const [toggling, setToggling] = useState(false);

  const handleToggle = async () => {
    setToggling(true);
    const ok = await toggle(property.pubkey, !property.isActive);
    if (ok) onRefresh();
    setToggling(false);
  };

  return (
    <div className={`admin-row ${property.isActive ? "" : "admin-row-inactive"}`}>
      <div className="ar-status">
        <span className={`ar-dot ${property.isActive ? "ar-dot-active" : "ar-dot-inactive"}`}/>
      </div>
      <div className="ar-location">
        <span className="ar-loc-main">{property.location}</span>
        <span className="ar-loc-sub">{property.city} · {property.propertyType}</span>
      </div>
      <div className="ar-value">${property.totalValueUSD.toLocaleString()}</div>
      <div className="ar-tokens">
        <span className="ar-issued">{property.tokensIssued.toLocaleString()}</span>
        <span className="ar-total"> / {property.totalTokens.toLocaleString()}</span>
      </div>
      <div className="ar-funded">{property.fundedPercent.toFixed(1)}%</div>
      <div className="ar-actions">
        <a
          href={`https://explorer.solana.com/address/${property.pubkey}?cluster=testnet`}
          target="_blank" rel="noreferrer" className="ar-btn ar-btn-ghost"
        >
          Explorer ↗
        </a>
        <a
          href={`https://ipfs.io/ipfs/${property.ipfsCid}`}
          target="_blank" rel="noreferrer" className="ar-btn ar-btn-ghost"
        >
          IPFS ↗
        </a>
        <button
          className={`ar-btn ${property.isActive ? "ar-btn-warn" : "ar-btn-success"}`}
          onClick={handleToggle}
          disabled={toggling}
        >
          {toggling ? "…" : property.isActive ? "Pausar" : "Activar"}
        </button>
      </div>
    </div>
  );
}

// ── Main Admin Panel ──────────────────────────────────────────
interface AdminPanelProps {
  properties: PropertyUI[];
  push: (msg: string, type: ToastType, dur?: number) => number;
  onRefresh: () => void;
}

export function AdminPanel({ properties, push, onRefresh }: AdminPanelProps) {
  const { connected, publicKey } = useWallet();
  const isAuthority = useIsAuthority();
  const [tab, setTab]   = useState<"list" | "new">("list");

  if (!connected) {
    return (
      <div className="admin-gate">
        <span className="admin-gate-icon">🔐</span>
        <h3>Panel de Administración</h3>
        <p>Conecta la wallet de autoridad del programa para acceder.</p>
      </div>
    );
  }

  if (!isAuthority) {
    return (
      <div className="admin-gate">
        <span className="admin-gate-icon">⛔</span>
        <h3>Acceso denegado</h3>
        <p>Solo la wallet authority del programa puede acceder al panel admin.</p>
        <code>{publicKey?.toBase58()}</code>
        <p className="admin-gate-hint">
          Configura <code>NEXT_PUBLIC_AUTHORITY_PUBKEY</code> en tu <code>.env.local</code>
        </p>
      </div>
    );
  }

  return (
    <div className="admin-panel">
      {/* Header */}
      <div className="admin-header">
        <div>
          <h2 className="admin-title">Panel de Administración</h2>
          <p className="admin-sub">Authority: <code>{publicKey?.toBase58().slice(0,12)}…</code> · Solana Testnet</p>
        </div>
        <div className="admin-tab-row">
          <button className={`admin-tab ${tab === "list" ? "active" : ""}`} onClick={() => setTab("list")}>
            Propiedades ({properties.length})
          </button>
          <button className={`admin-tab ${tab === "new" ? "active" : ""}`} onClick={() => setTab("new")}>
            + Nueva propiedad
          </button>
        </div>
      </div>

      {tab === "list" && (
        <div className="admin-list">
          <div className="admin-list-header">
            <span>Estado</span>
            <span>Propiedad</span>
            <span>Valor</span>
            <span>Tokens</span>
            <span>Financiado</span>
            <span>Acciones</span>
          </div>
          {properties.length === 0 ? (
            <div className="admin-empty">
              No hay propiedades on-chain todavía. Crea la primera →
            </div>
          ) : (
            properties.map(p => (
              <AdminPropertyRow key={p.pubkey} property={p} push={push} onRefresh={onRefresh}/>
            ))
          )}
        </div>
      )}

      {tab === "new" && (
        <NewPropertyForm_ push={push} onSuccess={() => { setTab("list"); onRefresh(); }}/>
      )}

      <style>{`
        .admin-panel { display: flex; flex-direction: column; gap: 0; }
        .admin-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 24px; border-bottom: 1px solid var(--border); flex-wrap: wrap; gap: 12px; }
        .admin-title { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
        .admin-sub { font-size: 12px; color: var(--text3); }
        .admin-sub code { font-family: 'JetBrains Mono', monospace; color: var(--text2); }
        .admin-tab-row { display: flex; gap: 6px; }
        .admin-tab { background: transparent; border: 1px solid var(--border2); color: var(--text2); font-size: 12px; font-weight: 600; padding: 7px 14px; border-radius: 7px; cursor: pointer; transition: all .15s; }
        .admin-tab.active, .admin-tab:hover { background: var(--bg3); color: var(--text); }
        .admin-list { display: flex; flex-direction: column; }
        .admin-list-header { display: grid; grid-template-columns: 40px 1fr 100px 130px 80px 180px; gap: 12px; padding: 10px 20px; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text3); border-bottom: 1px solid var(--border); }
        .admin-row { display: grid; grid-template-columns: 40px 1fr 100px 130px 80px 180px; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--border); align-items: center; transition: background .15s; }
        .admin-row:hover { background: var(--bg3); }
        .admin-row-inactive { opacity: 0.55; }
        .ar-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .ar-dot-active { background: var(--green); box-shadow: 0 0 6px var(--green); }
        .ar-dot-inactive { background: var(--text3); }
        .ar-loc-main { display: block; font-size: 13px; font-weight: 600; }
        .ar-loc-sub { display: block; font-size: 11px; color: var(--text3); margin-top: 2px; }
        .ar-value { font-size: 13px; font-weight: 700; }
        .ar-issued { font-size: 13px; font-weight: 700; }
        .ar-total { font-size: 11px; color: var(--text3); }
        .ar-funded { font-size: 13px; font-weight: 600; }
        .ar-actions { display: flex; gap: 6px; }
        .ar-btn { font-size: 11px; font-weight: 600; padding: 5px 10px; border-radius: 5px; cursor: pointer; transition: all .15s; white-space: nowrap; border: none; }
        .ar-btn-ghost { background: transparent; color: var(--text3); border: 1px solid var(--border2) !important; }
        .ar-btn-ghost:hover { color: var(--text); }
        .ar-btn-warn { background: rgba(255,107,107,0.15); color: #ff6b6b; }
        .ar-btn-success { background: rgba(20,241,149,0.15); color: var(--green); }
        .admin-empty { padding: 40px; text-align: center; color: var(--text3); font-size: 13px; }
        .admin-gate { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 60px 24px; text-align: center; }
        .admin-gate-icon { font-size: 36px; }
        .admin-gate h3 { font-size: 18px; font-weight: 700; }
        .admin-gate p { font-size: 13px; color: var(--text2); max-width: 360px; }
        .admin-gate code { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--purple); background: rgba(153,69,255,0.1); padding: 4px 8px; border-radius: 5px; }
        .admin-gate-hint { font-size: 11px; color: var(--text3); }
        /* Form styles */
        .admin-form { padding: 24px; display: flex; flex-direction: column; gap: 20px; }
        .af-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--text3); padding-bottom: 8px; border-bottom: 1px solid var(--border); }
        .af-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .af-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
        .af-field { display: flex; flex-direction: column; gap: 5px; }
        .af-field label { font-size: 11px; font-weight: 600; color: var(--text2); }
        .af-field input, .af-field select { background: var(--bg3); border: 1px solid var(--border2); color: var(--text); border-radius: 7px; padding: 9px 12px; font-size: 13px; font-family: inherit; transition: border-color .15s; }
        .af-field input:focus, .af-field select:focus { outline: none; border-color: var(--green); }
        .af-field select { appearance: none; }
        .af-hint { font-size: 10px; color: var(--text3); }
        .af-hint a { color: var(--purple); }
        .af-dropzone { position: relative; border: 2px dashed var(--border2); border-radius: 8px; padding: 24px; text-align: center; cursor: pointer; transition: border-color .15s; }
        .af-dropzone:hover { border-color: var(--text3); }
        .af-dropzone-filled { border-color: var(--green); border-style: solid; background: rgba(20,241,149,0.04); }
        .af-dropzone-hint { font-size: 12px; color: var(--text3); }
        .af-file-name { font-size: 12px; color: var(--green); }
        .af-file-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
        .af-hash-preview { display: flex; align-items: center; gap: 8px; background: var(--bg3); border-radius: 6px; padding: 8px 10px; }
        .af-hash-label { font-size: 10px; font-weight: 700; color: var(--text3); flex-shrink: 0; }
        .af-hash-preview code { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text2); word-break: break-all; }
        .af-summary { background: var(--bg3); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 7px; }
        .af-sum-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--text2); }
        .af-sum-row-accent { border-top: 1px solid var(--border); padding-top: 7px; margin-top: 3px; color: var(--text); font-weight: 600; }
        .af-submit { background: var(--green); color: #000; font-weight: 700; font-size: 14px; border: none; border-radius: 8px; padding: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: opacity .15s; }
        .af-submit:hover:not(:disabled) { opacity: .88; }
        .af-submit:disabled { opacity: .5; cursor: not-allowed; }
        .btn-spinner { width: 14px; height: 14px; border: 2px solid rgba(0,0,0,0.2); border-top-color: #000; border-radius: 50%; animation: spin .7s linear infinite; }
        @media (max-width: 900px) {
          .admin-list-header, .admin-row { grid-template-columns: 30px 1fr 90px 80px; }
          .admin-list-header span:nth-child(5), .admin-row > *:nth-child(5) { display: none; }
          .af-grid-2, .af-grid-3 { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
