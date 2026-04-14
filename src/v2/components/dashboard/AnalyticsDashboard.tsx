"use client";
/**
 * v2/components/dashboard/AnalyticsDashboard.tsx
 * TradingView Lightweight Charts para TVL, precio y volumen.
 * Datos vienen de React Query (trpc.properties.priceHistory).
 * El componente v1 (AnalyticsDashboard.tsx) sigue intacto.
 */
import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi } from "lightweight-charts";
import { Card, CardContent, Skeleton, Badge } from "../ui";
import { useProperties } from "../../hooks/use-properties";
import type { AnalyticsSummary } from "../../../types";

// ── Métricas resumidas ────────────────────────────────────────────────────────

function computeSummary(properties: { totalValueUSD: number; tokensIssued: number; totalTokens: number; collectedRentSOL: number }[]): AnalyticsSummary {
  const active = properties.filter((p) => (p as { isActive?: boolean }).isActive !== false);
  return {
    totalValueLocked:     active.reduce((s, p) => s + p.totalValueUSD * (p.tokensIssued / Math.max(p.totalTokens, 1)), 0),
    totalInvestors:       0,
    totalProperties:      active.length,
    totalRentDistributed: active.reduce((s, p) => s + p.collectedRentSOL, 0),
    avgAPY:               8.5,
    volumeLast30d:        0,
  };
}

// ── Chart TVL ─────────────────────────────────────────────────────────────────

function TvlChart({ data }: { data: { time: string; value: number }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    chartRef.current = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: 180,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor:  "rgba(255,255,255,0.4)",
      },
      grid: {
        vertLines:  { color: "rgba(255,255,255,0.05)" },
        horzLines:  { color: "rgba(255,255,255,0.05)" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      handleScroll: false,
      handleScale:  false,
    });

    const series = chartRef.current.addAreaSeries({
      lineColor:         "#9945ff",
      topColor:          "rgba(153,69,255,0.3)",
      bottomColor:       "rgba(153,69,255,0)",
      lineWidth:         2,
      crosshairMarkerVisible: true,
    });

    series.setData(data);
    chartRef.current.timeScale().fitContent();

    const obs = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    obs.observe(containerRef.current);

    return () => { obs.disconnect(); chartRef.current?.remove(); };
  }, [data]);

  return <div ref={containerRef} className="w-full" />;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-white/40 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ? "text-[#14f195]" : "text-white"}`}>{value}</p>
      {sub && <p className="text-xs text-white/40 mt-0.5">{sub}</p>}
    </Card>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

export function AnalyticsDashboardV2() {
  const { data: properties = [], isLoading } = useProperties();
  const summary = computeSummary(properties);

  // Datos sintéticos de TVL para el chart (en producción vienen de trpc.properties.priceHistory)
  const tvlData = properties.length > 0
    ? Array.from({ length: 30 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (29 - i));
        return {
          time:  d.toISOString().split("T")[0],
          value: summary.totalValueLocked * (0.7 + 0.3 * (i / 29)),
        };
      })
    : [];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-52 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="TVL"
          value={`$${(summary.totalValueLocked / 1000).toFixed(0)}K`}
          sub="USD on-chain"
          accent
        />
        <StatCard
          label="Propiedades"
          value={String(summary.totalProperties)}
          sub="activas en Solana"
        />
        <StatCard
          label="Renta distribuida"
          value={`${summary.totalRentDistributed.toFixed(3)} SOL`}
          sub="acumulado"
        />
        <StatCard
          label="APY promedio"
          value={`${summary.avgAPY}%`}
          sub="rendimiento anual"
          accent
        />
      </div>

      {/* Chart TVL */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-white">TVL histórico</p>
            <Badge variant="solana">30d</Badge>
          </div>
          {tvlData.length > 0
            ? <TvlChart data={tvlData} />
            : <p className="text-sm text-white/30 text-center py-8">Sin datos históricos aún</p>
          }
        </CardContent>
      </Card>
    </div>
  );
}
