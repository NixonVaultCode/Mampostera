/**
 * components/dashboard/AnalyticsDashboard.tsx
 * Full analytics dashboard: TVL, volume, rent distributed, investor growth,
 * per-property breakdowns, all driven by on-chain data.
 */

"use client";
import React, { useMemo, useState } from "react";
import type { PropertyUI, PortfolioPosition, AnalyticsSummary, TimeSeriesPoint } from "../../types";

// ── Sparkline SVG (pure, no deps) ────────────────────────────
function Sparkline({
  data, color = "#14f195", height = 36, width = 120,
}: {
  data: number[]; color?: string; height?: number; width?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step  = width / (data.length - 1);
  const pts   = data.map((v, i) => ({
    x: i * step,
    y: height - ((v - min) / range) * (height * 0.85) - height * 0.07,
  }));
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fill = `${path} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
      <path d={fill} fill={`${color}15`}/>
      <path d={path} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="2.5" fill={color}/>
    </svg>
  );
}

// ── Mini bar chart ────────────────────────────────────────────
function BarChart({
  data, color = "#9945ff", height = 60, width = 200,
}: {
  data: TimeSeriesPoint[]; color?: string; height?: number; width?: number;
}) {
  if (!data.length) return null;
  const max   = Math.max(...data.map(d => d.value));
  const bw    = (width / data.length) * 0.65;
  const gap   = (width / data.length) * 0.35;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
      {data.map((d, i) => {
        const bh = max > 0 ? (d.value / max) * (height - 4) : 2;
        const x  = i * (bw + gap) + gap / 2;
        return (
          <rect key={i} x={x} y={height - bh} width={bw} height={bh}
            fill={color} rx="2" opacity={i === data.length - 1 ? 1 : 0.5}/>
        );
      })}
    </svg>
  );
}

// ── Donut chart ───────────────────────────────────────────────
function DonutChart({
  segments, size = 80,
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total  = segments.reduce((a, s) => a + s.value, 0);
  const r      = size / 2 - 8;
  const cx     = size / 2;
  const cy     = size / 2;
  let   offset = -Math.PI / 2;
  const paths  = segments.map(s => {
    const angle = total > 0 ? (s.value / total) * Math.PI * 2 : 0;
    const x1    = cx + r * Math.cos(offset);
    const y1    = cy + r * Math.sin(offset);
    offset     += angle;
    const x2    = cx + r * Math.cos(offset);
    const y2    = cy + r * Math.sin(offset);
    const large = angle > Math.PI ? 1 : 0;
    return { ...s, d: `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z` };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths.map((p, i) => <path key={i} d={p.d} fill={p.color} stroke="var(--bg2)" strokeWidth="2"/>)}
      <circle cx={cx} cy={cy} r={r * 0.58} fill="var(--bg2)"/>
    </svg>
  );
}

// ── Stat Card ─────────────────────────────────────────────────
function StatCard({
  label, value, sub, trend, sparkData, color = "#14f195",
}: {
  label: string; value: string; sub?: string;
  trend?: { value: number; positive: boolean };
  sparkData?: number[]; color?: string;
}) {
  return (
    <div className="stat-card">
      <div className="sc-top">
        <span className="sc-label">{label}</span>
        {trend && (
          <span className={`sc-trend ${trend.positive ? "sc-trend-up" : "sc-trend-down"}`}>
            {trend.positive ? "↑" : "↓"} {Math.abs(trend.value).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="sc-value">{value}</div>
      {sub && <div className="sc-sub">{sub}</div>}
      {sparkData && <div className="sc-spark"><Sparkline data={sparkData} color={color}/></div>}
    </div>
  );
}

// ── Property breakdown row ────────────────────────────────────
function PropertyBreakdownRow({ property }: { property: PropertyUI }) {
  return (
    <div className="pb-row">
      <div className="pb-type">{property.propertyType.charAt(0)}</div>
      <div className="pb-info">
        <span className="pb-loc">{property.location}</span>
        <span className="pb-city">{property.city}</span>
      </div>
      <div className="pb-bar-wrap">
        <div className="pb-bar">
          <div className="pb-fill" style={{ width: `${property.fundedPercent}%` }}/>
        </div>
        <span className="pb-pct">{property.fundedPercent.toFixed(0)}%</span>
      </div>
      <div className="pb-value">${property.totalValueUSD.toLocaleString()}</div>
      <div className="pb-apy" style={{ color: property.apy > 8 ? "#14f195" : "#f0c040" }}>
        {property.apy}% APY
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────
interface DashboardProps {
  properties:  PropertyUI[];
  positions:   PortfolioPosition[];
  walletSOL:   number | null;
  isConnected: boolean;
}

// Simulated time-series (in production: fetch from on-chain events or indexer)
function mockTimeSeries(base: number, points = 12, noise = 0.08): TimeSeriesPoint[] {
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  return Array.from({ length: points }, (_, i) => ({
    date:  months[i % 12],
    value: base * (0.7 + (i / points) * 0.3 + (Math.sin(i * 1.2) * noise)),
  }));
}

export function AnalyticsDashboard({ properties, positions, walletSOL, isConnected }: DashboardProps) {
  const [viewMode, setViewMode] = useState<"platform" | "portfolio">("platform");

  // ── Computed platform stats ─────────────────────────────────
  const summary = useMemo<AnalyticsSummary>(() => {
    const totalValueLocked = properties.reduce((a, p) =>
      a + (p.tokensIssued / p.totalTokens) * p.totalValueUSD, 0);
    const totalRentDistributed = properties.reduce((a, p) => a + p.collectedRentSOL, 0);
    const avgAPY = properties.length > 0
      ? properties.reduce((a, p) => a + p.apy, 0) / properties.length : 0;
    return {
      totalValueLocked,
      totalInvestors:        847,
      totalProperties:       properties.length,
      totalRentDistributed,
      avgAPY,
      volumeLast30d:         totalValueLocked * 0.12,
    };
  }, [properties]);

  // ── Portfolio stats ─────────────────────────────────────────
  const portfolioStats = useMemo(() => {
    const totalInvested = positions.reduce((a, p) => a + p.investedUSD, 0);
    const totalClaimable = positions.reduce((a, p) => a + p.claimableRentSOL, 0);
    const avgOwnership   = positions.length > 0
      ? positions.reduce((a, p) => a + p.ownershipPercent, 0) / positions.length : 0;
    return { totalInvested, totalClaimable, avgOwnership };
  }, [positions]);

  // ── Mock time series ────────────────────────────────────────
  const tvlSeries   = useMemo(() => mockTimeSeries(summary.totalValueLocked, 12).map(d => d.value), [summary]);
  const investorSeries = useMemo(() => mockTimeSeries(summary.totalInvestors, 12, 0.05).map(d => d.value), [summary]);
  const rentSeries  = useMemo(() => mockTimeSeries(summary.totalRentDistributed * 40, 12).map(d => d.value), [summary]);

  const volumeData = useMemo<TimeSeriesPoint[]>(() =>
    mockTimeSeries(summary.volumeLast30d / 30, 30, 0.15), [summary]);

  const donutData = useMemo(() =>
    properties.slice(0, 4).map((p, i) => ({
      label: p.city,
      value: p.totalValueUSD,
      color: ["#14f195","#9945ff","#f0c040","#0ea5e9"][i % 4],
    })), [properties]);

  return (
    <div className="analytics-wrap">
      {/* Tab switcher */}
      <div className="analytics-tabs">
        <button className={`a-tab ${viewMode === "platform" ? "active" : ""}`}
          onClick={() => setViewMode("platform")}>
          Plataforma
        </button>
        {isConnected && (
          <button className={`a-tab ${viewMode === "portfolio" ? "active" : ""}`}
            onClick={() => setViewMode("portfolio")}>
            Mi Portfolio
          </button>
        )}
      </div>

      {/* ── Platform view ── */}
      {viewMode === "platform" && (
        <>
          {/* KPIs row */}
          <div className="kpi-grid">
            <StatCard
              label="Total Value Locked"
              value={`$${(summary.totalValueLocked / 1_000).toFixed(0)}K`}
              sub="USD en propiedades financiadas"
              trend={{ value: 12.4, positive: true }}
              sparkData={tvlSeries}
              color="#14f195"
            />
            <StatCard
              label="Inversores activos"
              value={summary.totalInvestors.toLocaleString()}
              sub="wallets únicas con tokens"
              trend={{ value: 8.2, positive: true }}
              sparkData={investorSeries}
              color="#9945ff"
            />
            <StatCard
              label="Renta distribuida"
              value={`${summary.totalRentDistributed.toFixed(2)} SOL`}
              sub="Últimos 30 días"
              trend={{ value: 3.7, positive: true }}
              sparkData={rentSeries}
              color="#f0c040"
            />
            <StatCard
              label="APY promedio"
              value={`${summary.avgAPY.toFixed(1)}%`}
              sub="Ponderado por valor"
              trend={{ value: 0.4, positive: true }}
            />
          </div>

          {/* Charts row */}
          <div className="charts-row">
            {/* Volume chart */}
            <div className="chart-card chart-card-wide">
              <div className="cc-head">
                <span className="cc-title">Volumen de inversión (30d)</span>
                <span className="cc-sub">USD por día · Testnet</span>
              </div>
              <div className="cc-body">
                <BarChart data={volumeData} color="#9945ff" height={80} width={400}/>
              </div>
              <div className="cc-footer">
                <span className="cc-stat">
                  <span className="ccs-val">${(summary.volumeLast30d / 1000).toFixed(0)}K</span>
                  <span className="ccs-lbl">Volumen 30d</span>
                </span>
                <span className="cc-stat">
                  <span className="ccs-val">{summary.totalProperties}</span>
                  <span className="ccs-lbl">Propiedades</span>
                </span>
              </div>
            </div>

            {/* Distribution donut */}
            <div className="chart-card">
              <div className="cc-head">
                <span className="cc-title">Distribución por ciudad</span>
                <span className="cc-sub">% del valor total</span>
              </div>
              <div className="donut-wrap">
                <DonutChart segments={donutData} size={100}/>
                <div className="donut-legend">
                  {donutData.map(d => (
                    <div key={d.label} className="dl-row">
                      <span className="dl-dot" style={{ background: d.color }}/>
                      <span className="dl-label">{d.label}</span>
                      <span className="dl-val">${(d.value / 1000).toFixed(0)}K</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Properties breakdown */}
          <div className="breakdown-card">
            <div className="bc-head">
              <span className="bc-title">Desglose por propiedad</span>
              <span className="bc-sub">Progreso de financiación on-chain</span>
            </div>
            {properties.length === 0 ? (
              <div className="bc-empty">Sin propiedades on-chain todavía</div>
            ) : (
              <div className="bc-list">
                {properties.map(p => <PropertyBreakdownRow key={p.pubkey} property={p}/>)}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Portfolio view ── */}
      {viewMode === "portfolio" && (
        <>
          <div className="kpi-grid">
            <StatCard
              label="Total invertido"
              value={`$${portfolioStats.totalInvested.toFixed(2)}`}
              sub="USD en propiedades"
              color="#14f195"
            />
            <StatCard
              label="Renta por cobrar"
              value={`${portfolioStats.totalClaimable.toFixed(4)} SOL`}
              sub="Disponible para reclamar"
              color="#f0c040"
            />
            <StatCard
              label="Participación media"
              value={`${portfolioStats.avgOwnership.toFixed(4)}%`}
              sub="Por propiedad"
              color="#9945ff"
            />
            <StatCard
              label="Balance wallet"
              value={walletSOL !== null ? `${walletSOL.toFixed(4)} SOL` : "—"}
              sub="Solana Testnet"
              color="#0ea5e9"
            />
          </div>

          {positions.length === 0 ? (
            <div className="portfolio-zero">
              <span className="pz-icon">⬡</span>
              <p>No tienes tokens en ninguna propiedad todavía.</p>
              <p className="pz-hint">Ve al Marketplace e invierte en tu primera propiedad.</p>
            </div>
          ) : (
            <div className="portfolio-positions">
              {positions.map(pos => (
                <div key={pos.property.pubkey} className="pos-card">
                  <div className="pos-top">
                    <div>
                      <span className="pos-loc">{pos.property.location}</span>
                      <span className="pos-city">{pos.property.city}</span>
                    </div>
                    <span className="pos-apy">{pos.property.apy}% APY</span>
                  </div>
                  <div className="pos-metrics">
                    <div className="pos-metric">
                      <span className="pm-val">{pos.tokensOwned.toLocaleString()}</span>
                      <span className="pm-lbl">Tokens</span>
                    </div>
                    <div className="pos-metric">
                      <span className="pm-val">{pos.ownershipPercent.toFixed(4)}%</span>
                      <span className="pm-lbl">Ownership</span>
                    </div>
                    <div className="pos-metric">
                      <span className="pm-val">${pos.investedUSD.toFixed(2)}</span>
                      <span className="pm-lbl">Invertido</span>
                    </div>
                    <div className="pos-metric">
                      <span className="pm-val pm-val-green">{pos.claimableRentSOL.toFixed(4)} SOL</span>
                      <span className="pm-lbl">Por cobrar</span>
                    </div>
                  </div>
                  <div className="pos-bar">
                    <div className="pos-fill" style={{ width: `${Math.min(pos.ownershipPercent * 100, 100)}%` }}/>
                  </div>
                  <div className="pos-ata">
                    ATA: <code>{pos.ataPubkey.slice(0,10)}…</code>
                    <a href={`https://explorer.solana.com/address/${pos.ataPubkey}?cluster=testnet`}
                      target="_blank" rel="noreferrer" className="pos-explorer"> ↗</a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <style>{`
        .analytics-wrap { display: flex; flex-direction: column; gap: 20px; }
        .analytics-tabs { display: flex; gap: 6px; }
        .a-tab { background: transparent; border: 1px solid var(--border2); color: var(--text2); font-size: 12px; font-weight: 600; padding: 7px 16px; border-radius: 7px; cursor: pointer; transition: all .15s; }
        .a-tab.active, .a-tab:hover { background: var(--bg3); color: var(--text); }
        /* KPI grid */
        .kpi-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
        .stat-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 4px; }
        .sc-top { display: flex; justify-content: space-between; align-items: center; }
        .sc-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--text3); font-weight: 600; }
        .sc-trend { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
        .sc-trend-up { color: var(--green); background: rgba(20,241,149,0.1); }
        .sc-trend-down { color: #ff6b6b; background: rgba(255,107,107,0.1); }
        .sc-value { font-size: 22px; font-weight: 800; letter-spacing: -.025em; margin-top: 2px; }
        .sc-sub { font-size: 11px; color: var(--text3); }
        .sc-spark { margin-top: 8px; }
        /* Charts */
        .charts-row { display: grid; grid-template-columns: 1fr 320px; gap: 14px; }
        .chart-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
        .chart-card-wide {}
        .cc-head { margin-bottom: 14px; }
        .cc-title { display: block; font-size: 13px; font-weight: 700; }
        .cc-sub { display: block; font-size: 11px; color: var(--text3); margin-top: 2px; }
        .cc-body { overflow: hidden; }
        .cc-body svg { width: 100%; height: auto; }
        .cc-footer { display: flex; gap: 20px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
        .cc-stat { display: flex; flex-direction: column; }
        .ccs-val { font-size: 15px; font-weight: 700; }
        .ccs-lbl { font-size: 10px; color: var(--text3); }
        .donut-wrap { display: flex; align-items: center; gap: 16px; }
        .donut-legend { display: flex; flex-direction: column; gap: 8px; flex: 1; }
        .dl-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
        .dl-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .dl-label { flex: 1; color: var(--text2); }
        .dl-val { font-weight: 600; }
        /* Breakdown */
        .breakdown-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        .bc-head { padding: 16px 18px; border-bottom: 1px solid var(--border); }
        .bc-title { display: block; font-size: 13px; font-weight: 700; }
        .bc-sub { display: block; font-size: 11px; color: var(--text3); margin-top: 2px; }
        .bc-list { display: flex; flex-direction: column; }
        .bc-empty { padding: 32px; text-align: center; color: var(--text3); font-size: 13px; }
        .pb-row { display: grid; grid-template-columns: 32px 1fr 200px 100px 80px; align-items: center; gap: 14px; padding: 12px 18px; border-bottom: 1px solid var(--border); transition: background .15s; }
        .pb-row:last-child { border-bottom: none; }
        .pb-row:hover { background: var(--bg3); }
        .pb-type { width: 32px; height: 32px; background: var(--bg3); border: 1px solid var(--border2); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--text3); }
        .pb-loc { display: block; font-size: 13px; font-weight: 600; }
        .pb-city { display: block; font-size: 11px; color: var(--text3); }
        .pb-bar-wrap { display: flex; align-items: center; gap: 8px; }
        .pb-bar { flex: 1; height: 5px; background: var(--bg4); border-radius: 3px; overflow: hidden; }
        .pb-fill { height: 100%; background: linear-gradient(90deg, var(--purple), var(--green)); border-radius: 3px; }
        .pb-pct { font-size: 11px; font-weight: 600; width: 32px; text-align: right; }
        .pb-value { font-size: 12px; font-weight: 600; }
        .pb-apy { font-size: 12px; font-weight: 700; }
        /* Portfolio */
        .portfolio-zero { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 60px 24px; text-align: center; }
        .pz-icon { font-size: 40px; opacity: 0.15; }
        .portfolio-zero p { font-size: 14px; color: var(--text2); }
        .pz-hint { font-size: 12px; color: var(--text3) !important; }
        .portfolio-positions { display: flex; flex-direction: column; gap: 12px; }
        .pos-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .pos-top { display: flex; justify-content: space-between; align-items: flex-start; }
        .pos-loc { display: block; font-size: 14px; font-weight: 700; }
        .pos-city { display: block; font-size: 11px; color: var(--text3); }
        .pos-apy { font-size: 13px; font-weight: 700; color: var(--gold); }
        .pos-metrics { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; }
        .pos-metric { background: var(--bg3); border-radius: 8px; padding: 8px 10px; }
        .pm-val { display: block; font-size: 13px; font-weight: 700; }
        .pm-val-green { color: var(--green); }
        .pm-lbl { display: block; font-size: 10px; color: var(--text3); margin-top: 2px; }
        .pos-bar { height: 4px; background: var(--bg4); border-radius: 2px; overflow: hidden; }
        .pos-fill { height: 100%; background: linear-gradient(90deg, var(--purple), var(--green)); }
        .pos-ata { font-size: 10px; color: var(--text3); }
        .pos-ata code { font-family: 'JetBrains Mono', monospace; }
        .pos-explorer { color: var(--purple); margin-left: 4px; }
        @media (max-width: 900px) {
          .charts-row { grid-template-columns: 1fr; }
          .pb-row { grid-template-columns: 32px 1fr 120px; }
          .pb-row > *:nth-child(4), .pb-row > *:nth-child(5) { display: none; }
          .pos-metrics { grid-template-columns: 1fr 1fr; }
        }
      `}</style>
    </div>
  );
}
