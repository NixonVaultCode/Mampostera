"use client";
/**
 * page.tsx — Mampostera v3
 * Integrates: real Anchor on-chain data, Civic KYC, Admin panel, Analytics dashboard.
 * Network: Solana Testnet
 */
import React, { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import "@solana/wallet-adapter-react-ui/styles.css";

import { RPC_ENDPOINT } from "../lib/program";
import {
  useProperties, usePortfolio, useBuyTokens, useClaimRent,
  useSolBalance, useToast,
} from "../hooks/useMampostera";
import { CivicKYCPanel, KYCBadge, useCivicKYC } from "../components/kyc/CivicKYC";
import { AdminPanel } from "../components/admin/AdminPanel";
import { AnalyticsDashboard } from "../components/dashboard/AnalyticsDashboard";
import type { PropertyUI } from "../types";

// ─── Logo ─────────────────────────────────────────────────────
function MamposteraLogo({ size = 38 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
      <polygon points="60,8 104,32 104,80 60,104 16,80 16,32"
        fill="url(#hg)" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5"/>
      <path d="M60 28L85 48L60 56Z" fill="url(#g1)" opacity=".92"/>
      <path d="M85 48L85 72L60 56Z" fill="url(#g2)" opacity=".85"/>
      <path d="M60 56L85 72L60 92Z" fill="url(#g1)" opacity=".8"/>
      <path d="M35 72L60 56L60 92Z" fill="url(#g2)" opacity=".85"/>
      <path d="M35 48L60 56L35 72Z" fill="url(#g1)" opacity=".8"/>
      <path d="M60 28L60 56L35 48Z" fill="url(#g2)" opacity=".92"/>
      <rect x="28" y="80" width="64" height="20" rx="2" fill="url(#bg)" opacity=".9"/>
      <line x1="55" y1="80" x2="55" y2="100" stroke="rgba(255,255,255,0.1)" strokeWidth=".8"/>
      <line x1="75" y1="80" x2="75" y2="100" stroke="rgba(255,255,255,0.1)" strokeWidth=".8"/>
      <line x1="28" y1="90" x2="92" y2="90" stroke="rgba(255,255,255,0.1)" strokeWidth=".8"/>
      <path d="M42 32L60 16L78 32" stroke="url(#rg)" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <circle cx="60" cy="56" r="3" fill="#14f195" opacity=".9"/>
      {[["60","28"],["85","48"],["85","72"],["35","48"],["35","72"]].map(([cx,cy],i) => (
        <circle key={i} cx={cx} cy={cy} r="2" fill="#14f195" opacity=".65"/>
      ))}
      <defs>
        <linearGradient id="hg" x1="16" y1="8" x2="104" y2="104" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1a3a5c"/><stop offset="100%" stopColor="#0d2238"/>
        </linearGradient>
        <linearGradient id="g1" x1="35" y1="28" x2="85" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1de9b6"/><stop offset="100%" stopColor="#0b9e7c"/>
        </linearGradient>
        <linearGradient id="g2" x1="85" y1="28" x2="35" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00bfa5"/><stop offset="100%" stopColor="#006654"/>
        </linearGradient>
        <linearGradient id="bg" x1="28" y1="80" x2="92" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1e3a5f"/><stop offset="100%" stopColor="#0d2040"/>
        </linearGradient>
        <linearGradient id="rg" x1="42" y1="32" x2="78" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1a73e8"/><stop offset="100%" stopColor="#4fc3f7"/>
        </linearGradient>
      </defs>
    </svg>
  );
}

// ─── Buy Modal ────────────────────────────────────────────────
function BuyModal({ property, kycVerified, onClose, onConfirm }: {
  property: PropertyUI;
  kycVerified: boolean;
  onClose: () => void;
  onConfirm: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(100);
  const available = property.availableTokens;
  const total     = property.pricePerTokenUSD * amount;
  const rent_est  = (total * (property.apy / 100) / 12).toFixed(2);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <div>
            <h2 className="modal-title">Comprar tokens</h2>
            <p className="modal-loc">⬡ {property.location}, {property.city}</p>
          </div>
          <button className="modal-x" onClick={onClose}>✕</button>
        </div>

        {!kycVerified && (
          <div className="modal-kyc-warn">
            ⚠️ Para invertir necesitas verificar tu identidad con Civic KYC.
          </div>
        )}

        <div className="modal-field">
          <label>Tokens a comprar</label>
          <div className="slider-row">
            <input type="range" min={1} max={Math.min(available, 10000)} value={amount}
              onChange={e => setAmount(Number(e.target.value))} className="slider"/>
            <input type="number" min={1} max={available} value={amount}
              onChange={e => setAmount(Math.max(1, Math.min(available, Number(e.target.value)||1)))}
              className="num-input"/>
          </div>
          <div className="quick-row">
            {[10,100,500,1000].map(n=>(
              <button key={n} className={`q-btn ${amount===n?"active":""}`} onClick={()=>setAmount(n)}>
                {n.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-summary">
          {[
            ["Precio/token", `$${property.pricePerTokenUSD.toFixed(4)} USD`],
            ["Total inversión", `$${total.toFixed(2)} USD`],
            ["Participación", `${((amount/property.totalTokens)*100).toFixed(4)}%`],
            ["Renta/mes est.", `$${rent_est} USD`],
          ].map(([k,v])=>(
            <div key={k as string} className="sum-row">
              <span>{k}</span><span className="sum-val">{v}</span>
            </div>
          ))}
        </div>

        <button
          className="btn-confirm"
          disabled={!kycVerified}
          onClick={() => onConfirm(amount)}
        >
          {kycVerified ? `Confirmar · $${total.toFixed(2)} USD` : "KYC requerido"}
        </button>
        <button className="btn-cancel" onClick={onClose}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── Property Card ────────────────────────────────────────────
function PropertyCard({ property, onBuy, onClaim, kycStatus }: {
  property: PropertyUI;
  onBuy: (p: PropertyUI) => void;
  onClaim: (p: PropertyUI) => void;
  kycStatus: string;
}) {
  const pct = property.fundedPercent;
  return (
    <div className="prop-card">
      <div className="pc-img" style={{ background: property.imageGradient }}>
        <div className="pc-badges">
          <span className="pc-type">{property.propertyType}</span>
          {property.isActive && <span className="pc-live">● Live</span>}
        </div>
        <div className="pc-apy">
          <span className="apy-v">{property.apy}%</span>
          <span className="apy-l">APY</span>
        </div>
      </div>
      <div className="pc-body">
        <div className="pc-loc">⬡ {property.location}, {property.city}</div>
        <div className="pc-val-row">
          <div>
            <span className="pcv-label">Valor total</span>
            <span className="pcv-amount">${property.totalValueUSD.toLocaleString()}</span>
          </div>
          <div className="pcv-right">
            <span className="pcv-label">$/token</span>
            <span className="pcv-price">${property.pricePerTokenUSD.toFixed(3)}</span>
          </div>
        </div>
        <div className="pc-progress">
          <div className="pp-top"><span>Financiado</span><span className="pp-pct">{pct.toFixed(1)}%</span></div>
          <div className="pp-track"><div className="pp-fill" style={{ width:`${pct}%` }}/></div>
          <div className="pp-sub">
            <span>{property.tokensIssued.toLocaleString()} vendidos</span>
            <span>{property.availableTokens.toLocaleString()} libres</span>
          </div>
        </div>
        <div className="pc-metrics">
          <div className="pcm"><span className="pcm-v">{property.collectedRentSOL.toFixed(3)} SOL</span><span className="pcm-l">Renta</span></div>
          <div className="pcm"><span className="pcm-v">{(property.tokensIssued/1000).toFixed(0)}K</span><span className="pcm-l">Tokens</span></div>
        </div>
        <div className="pc-actions">
          <button className="btn-buy" onClick={()=>onBuy(property)}>Invertir</button>
          <button className="btn-rent" onClick={()=>onClaim(property)}
            disabled={property.collectedRentSOL===0}>
            {property.collectedRentSOL>0?`${property.collectedRentSOL.toFixed(3)} SOL`:"Sin renta"}
          </button>
        </div>
        <div className="pc-footer">
          <a href={`https://ipfs.io/ipfs/${property.ipfsCid}`} target="_blank" rel="noreferrer" className="pc-link">📄 Docs</a>
          <a href={`https://explorer.solana.com/address/${property.pubkey}?cluster=testnet`} target="_blank" rel="noreferrer" className="pc-link pc-link-purple">
            {property.pubkey.slice(0,6)}… ↗
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Toast stack ──────────────────────────────────────────────
function ToastStack({ toasts, dismiss }: {
  toasts: Array<{id:number;msg:string;type:string}>;
  dismiss: (id:number)=>void;
}) {
  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={()=>dismiss(t.id)}>
          {t.type==="loading" && <span className="t-spin"/>}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Nav Tabs ─────────────────────────────────────────────────
type Tab = "marketplace" | "dashboard" | "admin" | "kyc";

// ─── Inner App ────────────────────────────────────────────────
function MamposteApp() {
  const { connected, publicKey } = useWallet();
  const balance     = useSolBalance();
  const { toasts, push, dismiss } = useToast();
  const { buy, buying }   = useBuyTokens(push);
  const { claim, claiming } = useClaimRent(push);
  const { properties, loading: propsLoading, reload: reloadProps } = useProperties();
  const { positions, loading: portLoading } = usePortfolio();
  const { status: kycStatus, requestVerification } = useCivicKYC();

  const [tab, setTab]       = useState<Tab>("marketplace");
  const [buyProp, setBuyProp] = useState<PropertyUI | null>(null);

  const handleBuy = useCallback((p: PropertyUI) => {
    if (!connected) { push("Conecta tu wallet", "error"); return; }
    setBuyProp(p);
  }, [connected, push]);

  const handleConfirmBuy = useCallback(async (amount: number) => {
    if (!buyProp) return;
    setBuyProp(null);
    const ok = await buy(buyProp, amount);
    if (ok) reloadProps();
  }, [buyProp, buy, reloadProps]);

  const handleClaim = useCallback(async (p: PropertyUI) => {
    if (!connected) { push("Conecta tu wallet", "error"); return; }
    const ok = await claim(p);
    if (ok) reloadProps();
  }, [connected, claim, push, reloadProps]);

  const navItems: Array<{ id: Tab; label: string; badge?: string }> = [
    { id: "marketplace", label: "Marketplace" },
    { id: "dashboard",   label: "Analytics" },
    { id: "kyc",         label: "KYC",   badge: kycStatus === "verified" ? "✓" : undefined },
    { id: "admin",       label: "Admin" },
  ];

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="hdr-inner">
          <a href="#" className="logo-row">
            <MamposteraLogo size={34}/>
            <div className="logo-text">
              <span className="ltn"><span className="lt-mamp">MAMP</span><span className="lt-ostera">OSTERA</span></span>
              <span className="lts">Solana Real Estate RWA · Testnet</span>
            </div>
          </a>
          <nav className="nav">
            {navItems.map(n => (
              <button key={n.id} className={`nav-btn ${tab===n.id?"active":""}`} onClick={()=>setTab(n.id)}>
                {n.label}
                {n.badge && <span className="nav-badge">{n.badge}</span>}
              </button>
            ))}
          </nav>
          <div className="hdr-right">
            {kycStatus === "verified" && <KYCBadge status="verified"/>}
            {connected && balance !== null && (
              <div className="bal-chip">
                <span className="bal-dot"/>
                {balance.toFixed(3)} SOL
              </div>
            )}
            <WalletMultiButton/>
          </div>
        </div>
        {/* Testnet banner */}
        <div className="testnet-bar">
          ⚡ Solana <strong>Testnet</strong> · Program: <code>MAMPoSTERA111…1111</code> ·{" "}
          <a href="https://solfaucet.com" target="_blank" rel="noreferrer">Faucet SOL →</a>
        </div>
      </header>

      <main className="main">
        {/* ── MARKETPLACE ── */}
        {tab === "marketplace" && (
          <div className="section">
            <div className="section-head">
              <div>
                <h1 className="page-title">Marketplace de propiedades</h1>
                <p className="page-sub">
                  Datos en tiempo real desde Solana Testnet ·{" "}
                  {propsLoading ? "Cargando…" : `${properties.length} propiedades`}
                </p>
              </div>
              {!connected && (
                <div className="connect-cta">
                  <WalletMultiButton/>
                  <span className="cta-hint">Conecta para invertir</span>
                </div>
              )}
            </div>

            {/* KYC inline prompt */}
            {connected && kycStatus !== "verified" && (
              <div className="kyc-inline-prompt">
                <span>🔐 Verificación KYC requerida para invertir</span>
                <button className="kyc-inline-btn" onClick={() => setTab("kyc")}>
                  Verificar identidad →
                </button>
              </div>
            )}

            {propsLoading ? (
              <div className="loading-grid">
                {[1,2,3].map(i => <div key={i} className="skeleton-card"/>)}
              </div>
            ) : properties.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">⬡</span>
                <p>No hay propiedades on-chain en Testnet todavía.</p>
                <button className="cta-pill" onClick={() => setTab("admin")}>
                  Crear primera propiedad (Admin) →
                </button>
              </div>
            ) : (
              <div className="props-grid">
                {properties.map(p => (
                  <PropertyCard key={p.pubkey} property={p}
                    onBuy={handleBuy} onClaim={handleClaim}
                    kycStatus={kycStatus}/>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ANALYTICS ── */}
        {tab === "dashboard" && (
          <div className="section">
            <div className="section-head">
              <div>
                <h1 className="page-title">Analytics</h1>
                <p className="page-sub">Métricas on-chain en tiempo real · Solana Testnet</p>
              </div>
            </div>
            <AnalyticsDashboard
              properties={properties}
              positions={positions}
              walletSOL={balance}
              isConnected={connected}
            />
          </div>
        )}

        {/* ── KYC ── */}
        {tab === "kyc" && (
          <div className="section">
            <div className="section-head">
              <div>
                <h1 className="page-title">Verificación KYC</h1>
                <p className="page-sub">Civic Pass on-chain · Requerido para invertir</p>
              </div>
            </div>
            <div className="kyc-page-layout">
              <div className="kyc-main-col">
                <CivicKYCPanel/>
              </div>
              <div className="kyc-info-col">
                <div className="kyc-info-card">
                  <h3>¿Por qué KYC on-chain?</h3>
                  <p>Mampostera usa <strong>Civic Pass</strong> — el estándar de identidad en Solana. Tu Gateway Token vive en la blockchain, no en una base de datos centralizada.</p>
                  <ul className="kyc-benefits">
                    {[
                      "Cumplimiento regulatorio colombiano (UIAF)",
                      "Prevención de lavado de activos",
                      "Un token por wallet — verificación única",
                      "Privacidad: solo el hash de verificación on-chain",
                      "Portable: funciona en toda la red Solana",
                    ].map(b => (
                      <li key={b}><span className="kb-check">✓</span>{b}</li>
                    ))}
                  </ul>
                </div>
                <div className="kyc-info-card kyc-info-card-sm">
                  <h4>Gatekeeper Network</h4>
                  <code className="kyc-code">ignREusXmGrscGNUesoU9mxfds9AiYTez…</code>
                  <p>Testnet network para desarrollo. En mainnet se usa la red de producción de Civic.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── ADMIN ── */}
        {tab === "admin" && (
          <div className="section">
            <div className="section-head">
              <div>
                <h1 className="page-title">Admin</h1>
                <p className="page-sub">Solo accesible al authority del programa</p>
              </div>
            </div>
            <div className="admin-wrap">
              <AdminPanel properties={properties} push={push} onRefresh={reloadProps}/>
            </div>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="footer">
        <div className="ft-inner">
          <div className="ft-brand">
            <MamposteraLogo size={24}/>
            <span className="ft-name">MAMPOSTERA</span>
            <span className="ft-tag">Solana Real Estate RWA · Testnet</span>
          </div>
          <div className="ft-links">
            <a href="https://github.com/mampostera" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://docs.civic.com" target="_blank" rel="noreferrer">Civic Docs</a>
            <a href="https://www.anchor-lang.com" target="_blank" rel="noreferrer">Anchor</a>
            <a href="https://explorer.solana.com/?cluster=testnet" target="_blank" rel="noreferrer">Explorer</a>
          </div>
        </div>
      </footer>

      {/* ── Modals & overlays ── */}
      {buyProp && (
        <BuyModal property={buyProp}
          kycVerified={kycStatus === "verified"}
          onClose={() => setBuyProp(null)}
          onConfirm={handleConfirmBuy}/>
      )}
      <ToastStack toasts={toasts} dismiss={dismiss}/>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────
// BUG-09 fix: ConnectionProvider y WalletProvider ya están en app/providers.tsx.
// Envolverlos aquí de nuevo crea dos contextos anidados — useWallet() y
// useConnection() en componentes hijos leen del contexto incorrecto (el inner).
// Solución: eliminar los providers duplicados y renderizar directamente.
export default function App() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }}/>
      <MamposteApp/>
    </>
  );
}

// ─── CSS ──────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;600&display=swap');

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#07090e;--bg2:#0c0f18;--bg3:#111622;--bg4:#1a2035;
  --border:rgba(255,255,255,0.07);--border2:rgba(255,255,255,0.13);
  --text:#dde4f0;--text2:#7080a0;--text3:#394560;
  --green:#14f195;--purple:#9945ff;--blue:#0ea5e9;--gold:#f0c040;
  --r:10px;--r2:16px;
}
body{background:var(--bg);color:var(--text);font-family:'Syne',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{text-decoration:none;color:inherit;transition:color .15s}
button{font-family:inherit;cursor:pointer}
code,code *{font-family:'IBM Plex Mono',monospace}

/* Header */
.header{position:sticky;top:0;z-index:100;background:rgba(7,9,14,.92);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
.hdr-inner{max-width:1360px;margin:0 auto;padding:0 24px;height:60px;display:flex;align-items:center;gap:20px}
.logo-row{display:flex;align-items:center;gap:10px;flex-shrink:0}
.logo-text{display:flex;flex-direction:column;line-height:1}
.ltn{font-size:17px;font-weight:800;letter-spacing:-.02em}
.lt-mamp{color:#1e4a7a}.lt-ostera{background:linear-gradient(90deg,var(--green),var(--blue));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.lts{font-size:9px;color:var(--text3);letter-spacing:.06em;text-transform:uppercase;margin-top:1px}
.nav{display:flex;gap:2px;margin:0 auto}
.nav-btn{background:transparent;border:none;color:var(--text2);font-size:13px;font-weight:600;padding:6px 14px;border-radius:7px;transition:all .15s;display:flex;align-items:center;gap:5px;font-family:inherit}
.nav-btn:hover{color:var(--text);background:var(--bg3)}
.nav-btn.active{color:var(--text);background:var(--bg3);border:1px solid var(--border2)}
.nav-badge{font-size:9px;background:var(--green);color:#000;border-radius:10px;padding:1px 5px;font-weight:800}
.hdr-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
.bal-chip{display:flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--green);background:rgba(20,241,149,0.08);border:1px solid rgba(20,241,149,0.2);padding:5px 11px;border-radius:20px}
.bal-dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.wallet-adapter-button{background:var(--purple)!important;border-radius:8px!important;font-size:12px!important;font-weight:700!important;height:34px!important;padding:0 14px!important;font-family:'Syne',sans-serif!important}
.wallet-adapter-modal-wrapper{background:var(--bg2)!important;border:1px solid var(--border2)!important;border-radius:16px!important}
.testnet-bar{background:rgba(153,69,255,0.06);border-top:1px solid rgba(153,69,255,0.15);text-align:center;font-size:11px;color:var(--text3);padding:5px 24px}
.testnet-bar strong{color:var(--purple)}
.testnet-bar code{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text2)}
.testnet-bar a{color:var(--purple)}

/* Main layout */
.main{min-height:calc(100vh - 130px)}
.section{max-width:1360px;margin:0 auto;padding:36px 24px 60px}
.section-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px}
.page-title{font-size:24px;font-weight:800;letter-spacing:-.03em;margin-bottom:5px}
.page-sub{font-size:13px;color:var(--text2)}
.connect-cta{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.cta-hint{font-size:11px;color:var(--text3)}

/* KYC prompt */
.kyc-inline-prompt{display:flex;align-items:center;justify-content:space-between;background:rgba(153,69,255,0.07);border:1px solid rgba(153,69,255,0.2);border-radius:10px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:var(--text2);gap:12px;flex-wrap:wrap}
.kyc-inline-btn{background:var(--purple);color:#fff;font-size:12px;font-weight:700;border:none;border-radius:7px;padding:7px 14px;cursor:pointer;white-space:nowrap;transition:opacity .15s}
.kyc-inline-btn:hover{opacity:.85}

/* Loading skeletons */
.loading-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px}
.skeleton-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r2);height:380px;animation:shimmer 1.4s infinite alternate}
@keyframes shimmer{0%{opacity:.5}100%{opacity:1}}

/* Empty state */
.empty-state{display:flex;flex-direction:column;align-items:center;gap:14px;padding:80px 0;text-align:center}
.empty-icon{font-size:48px;opacity:.15}
.empty-state p{font-size:14px;color:var(--text2)}
.cta-pill{background:var(--green);color:#000;font-weight:700;font-size:13px;border:none;border-radius:8px;padding:10px 20px;cursor:pointer;transition:opacity .15s}
.cta-pill:hover{opacity:.85}

/* Property grid & cards */
.props-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px}
.prop-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden;transition:transform .2s,border-color .2s}
.prop-card:hover{transform:translateY(-3px);border-color:var(--border2)}
.pc-img{position:relative;height:120px;overflow:hidden}
.pc-badges{position:absolute;top:10px;left:10px;display:flex;gap:7px}
.pc-type{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:2px 7px;backdrop-filter:blur(6px)}
.pc-live{font-size:9px;font-weight:700;color:var(--green);background:rgba(20,241,149,.15);border:1px solid rgba(20,241,149,.3);border-radius:4px;padding:2px 7px}
.pc-apy{position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,.7);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.1);border-radius:7px;padding:5px 9px;display:flex;flex-direction:column;align-items:center}
.apy-v{font-size:15px;font-weight:800;color:var(--gold);line-height:1}
.apy-l{font-size:8px;color:var(--text3);margin-top:1px}
.pc-body{padding:16px}
.pc-loc{font-size:12px;color:var(--text2);margin-bottom:12px}
.pc-val-row{display:flex;justify-content:space-between;margin-bottom:14px}
.pcv-label{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:2px}
.pcv-amount{font-size:20px;font-weight:800;letter-spacing:-.025em}
.pcv-right{text-align:right}
.pcv-price{font-size:14px;font-weight:700}
.pc-progress{margin-bottom:14px}
.pp-top{display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-bottom:5px}
.pp-pct{color:var(--text);font-weight:700}
.pp-track{height:4px;background:var(--bg4);border-radius:2px;overflow:hidden;margin-bottom:4px}
.pp-fill{height:100%;background:linear-gradient(90deg,var(--purple),var(--green));border-radius:2px;transition:width .5s}
.pp-sub{display:flex;justify-content:space-between;font-size:10px;color:var(--text3)}
.pc-metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:13px}
.pcm{background:var(--bg3);border-radius:7px;padding:8px 10px}
.pcm-v{display:block;font-size:12px;font-weight:700}
.pcm-l{display:block;font-size:9px;color:var(--text3);margin-top:1px}
.pc-actions{display:flex;gap:7px;margin-bottom:11px}
.btn-buy{flex:1;background:var(--green);color:#000;font-weight:700;font-size:12px;border:none;border-radius:7px;padding:9px;transition:opacity .15s}
.btn-buy:hover{opacity:.85}
.btn-rent{flex:1;background:transparent;border:1px solid var(--border2);color:var(--text2);font-size:11px;font-weight:600;border-radius:7px;padding:9px;transition:all .15s;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.btn-rent:hover:not(:disabled){border-color:var(--gold);color:var(--gold)}
.btn-rent:disabled{opacity:.35;cursor:not-allowed}
.pc-footer{display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:10px}
.pc-link{font-size:10px;color:var(--text3);transition:color .15s}
.pc-link:hover{color:var(--text2)}
.pc-link-purple{color:var(--purple)}

/* KYC page */
.kyc-page-layout{display:grid;grid-template-columns:1fr 340px;gap:20px;align-items:start}
.kyc-info-card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:14px}
.kyc-info-card h3{font-size:15px;font-weight:700;margin-bottom:10px}
.kyc-info-card h4{font-size:13px;font-weight:700;margin-bottom:8px}
.kyc-info-card p{font-size:12px;color:var(--text2);line-height:1.6}
.kyc-info-card-sm{margin-top:0}
.kyc-benefits{list-style:none;display:flex;flex-direction:column;gap:7px;margin-top:12px}
.kyc-benefits li{display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--text2)}
.kb-check{color:var(--green);flex-shrink:0;font-weight:700}
.kyc-code{display:block;font-size:9px;color:var(--purple);background:rgba(153,69,255,.08);border-radius:5px;padding:5px 8px;margin:8px 0;word-break:break-all}

/* Admin wrap */
.admin-wrap{background:var(--bg2);border:1px solid var(--border);border-radius:16px;overflow:hidden}

/* Modal */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px}
.modal-box{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r2);padding:26px;width:100%;max-width:440px;display:flex;flex-direction:column;gap:16px}
.modal-hdr{display:flex;justify-content:space-between;align-items:flex-start}
.modal-title{font-size:17px;font-weight:800;margin-bottom:3px}
.modal-loc{font-size:11px;color:var(--text2)}
.modal-x{background:transparent;border:none;color:var(--text3);font-size:16px;cursor:pointer;padding:2px}
.modal-x:hover{color:var(--text)}
.modal-kyc-warn{background:rgba(255,159,67,.08);border:1px solid rgba(255,159,67,.25);border-radius:8px;padding:10px 12px;font-size:12px;color:#ff9f43}
.modal-field label{display:block;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px}
.slider-row{display:flex;gap:10px;align-items:center}
.slider{flex:1;accent-color:var(--green)}
.num-input{width:75px;background:var(--bg3);border:1px solid var(--border2);color:var(--text);border-radius:6px;padding:7px 9px;font-size:13px;font-weight:700;text-align:center;font-family:inherit}
.num-input:focus{outline:none;border-color:var(--green)}
.quick-row{display:flex;gap:5px;margin-top:8px}
.q-btn{font-size:11px;font-weight:600;padding:3px 9px;border-radius:5px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);transition:all .15s}
.q-btn:hover,.q-btn.active{border-color:var(--green);color:var(--green);background:rgba(20,241,149,.06)}
.modal-summary{background:var(--bg3);border-radius:9px;padding:13px;display:flex;flex-direction:column;gap:7px}
.sum-row{display:flex;justify-content:space-between;font-size:12px;color:var(--text2)}
.sum-val{color:var(--text);font-weight:600}
.btn-confirm{background:var(--green);color:#000;font-weight:700;font-size:13px;border:none;border-radius:8px;padding:12px;cursor:pointer;transition:opacity .15s}
.btn-confirm:hover:not(:disabled){opacity:.88}
.btn-confirm:disabled{opacity:.4;cursor:not-allowed}
.btn-cancel{background:transparent;color:var(--text2);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:12px;cursor:pointer;transition:all .15s}
.btn-cancel:hover{color:var(--text);border-color:var(--border2)}

/* Toast */
.toast-stack{position:fixed;bottom:24px;right:24px;z-index:400;display:flex;flex-direction:column;gap:8px;max-width:360px}
.toast{display:flex;align-items:center;gap:10px;background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:13px 18px;font-size:13px;font-weight:500;box-shadow:0 8px 32px rgba(0,0,0,.6);cursor:pointer;animation:slide-in .2s ease}
@keyframes slide-in{from{transform:translateX(100%);opacity:0}to{transform:none;opacity:1}}
.toast-success{border-color:rgba(20,241,149,.3)}
.toast-error{border-color:rgba(255,107,107,.3);color:#ff8080}
.toast-loading{border-color:var(--border2)}
.toast-info{border-color:rgba(14,165,233,.3);color:var(--blue)}
.t-spin{width:13px;height:13px;border:2px solid rgba(255,255,255,.15);border-top-color:var(--green);border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}

/* Footer */
.footer{border-top:1px solid var(--border);padding:22px 24px}
.ft-inner{max-width:1360px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.ft-brand{display:flex;align-items:center;gap:8px}
.ft-name{font-size:13px;font-weight:800;letter-spacing:.02em}
.ft-tag{font-size:9px;color:var(--text3);letter-spacing:.05em;text-transform:uppercase}
.ft-links{display:flex;gap:18px;font-size:11px;color:var(--text3)}
.ft-links a:hover{color:var(--text2)}

@media(max-width:1024px){
  .nav{display:none}
  .kyc-page-layout{grid-template-columns:1fr}
}
@media(max-width:640px){
  .props-grid,.loading-grid{grid-template-columns:1fr}
  .hdr-right .bal-chip{display:none}
}
`;
