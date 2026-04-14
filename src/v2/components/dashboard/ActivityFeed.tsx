"use client";
/**
 * v2/components/dashboard/ActivityFeed.tsx
 *
 * R6: Feed de actividad on-chain en tiempo real — powered by Helius webhooks.
 * Muestra los últimos eventos del protocolo: mints, renta, ofertas, etc.
 * Se actualiza automáticamente cuando llega un evento vía Helius.
 */
import { Card, CardContent, Skeleton, Badge } from "../ui";
import { useRecentEvents, getEventLabel, formatEventAmount } from "../../hooks/use-events";
import type { OnchainEvent } from "../../../v2/db/schema";

// ── Badge de color por tipo de evento ────────────────────────────────────────

type BadgeVariant = "success" | "info" | "warning" | "danger" | "solana" | "default";

function eventVariant(type: string): BadgeVariant {
  if (type === "RentClaimed" || type === "RentDeposited") return "success";
  if (type === "TokensMinted")      return "solana";
  if (type === "LoanInitiated")     return "warning";
  if (type === "LiquidationExecuted") return "danger";
  if (type === "KycApproved")       return "info";
  return "default";
}

// ── Componente de un evento individual ───────────────────────────────────────

function EventRow({ event }: { event: OnchainEvent }) {
  const ago = _timeAgo(new Date(event.indexedAt));

  return (
    <div className="flex items-start gap-3 py-3 border-b border-white/5 last:border-0">
      {/* Indicador de tipo */}
      <div className="mt-0.5 flex-shrink-0">
        <Badge variant={eventVariant(event.eventType)} className="text-[10px]">
          {getEventLabel(event.eventType)}
        </Badge>
      </div>

      {/* Detalles */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {event.walletAddr && (
            <span className="text-xs font-mono text-white/60">
              {event.walletAddr.slice(0, 4)}…{event.walletAddr.slice(-4)}
            </span>
          )}
          {event.amountLamports && (
            <span className="text-xs font-semibold text-[#14f195]">
              {formatEventAmount(event)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <a
            href={`https://solscan.io/tx/${event.signature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-mono text-white/30 hover:text-white/60 transition-colors"
          >
            {event.signature.slice(0, 8)}…
          </a>
          <span className="text-[10px] text-white/20">{ago}</span>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

interface ActivityFeedProps {
  limit?: number;
  title?: string;
}

export function ActivityFeed({ limit = 15, title = "Actividad reciente" }: ActivityFeedProps) {
  const { data: events = [], isLoading } = useRecentEvents(limit);

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-white">{title}</p>
          <div className="flex items-center gap-1.5">
            {/* Indicador en vivo */}
            <span className="h-1.5 w-1.5 rounded-full bg-[#14f195] animate-pulse" />
            <span className="text-xs text-white/30">en vivo</span>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-3 py-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-white/30 text-center py-6">
            Sin actividad aún — los eventos aparecen aquí en tiempo real
          </p>
        ) : (
          <div>
            {events.map(e => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Helper ────────────────────────────────────────────────────────────────────

function _timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}
