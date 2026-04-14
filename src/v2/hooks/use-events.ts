/**
 * v2/hooks/use-events.ts
 *
 * R6: Hook React Query para eventos on-chain indexados por Helius.
 * Fuente: Neon DB (vía tRPC) + invalidación por Redis PubSub.
 *
 * Con Helius webhooks activos, staleTime = 0 porque los datos
 * se actualizan inmediatamente cuando llega el webhook.
 * Sin Helius, refetch cada 10s como fallback.
 */
"use client";

import { useQuery }        from "@tanstack/react-query";
import { useWallet }       from "@solana/wallet-adapter-react";
import type { OnchainEvent } from "../../v2/db/schema";

export const EventQueryKeys = {
  recent:     (limit: number)  => ["events", "recent", limit]  as const,
  byProperty: (propId: string) => ["events", "property", propId] as const,
  byWallet:   (wallet: string) => ["events", "wallet",   wallet] as const,
} as const;

// ── Hook: últimos N eventos globales ─────────────────────────────────────────

export function useRecentEvents(limit = 20) {
  return useQuery({
    queryKey: EventQueryKeys.recent(limit),
    queryFn:  async (): Promise<OnchainEvent[]> => {
      const res = await fetch(`/api/events/recent?limit=${limit}`);
      if (!res.ok) throw new Error(`events fetch ${res.status}`);
      return res.json() as Promise<OnchainEvent[]>;
    },
    staleTime:       0,       // Siempre refrescar — Helius invalida el cache
    refetchInterval: 10_000,  // Fallback si no hay webhook activo
    refetchOnWindowFocus: true,
  });
}

// ── Hook: eventos de una propiedad específica ────────────────────────────────

export function usePropertyEvents(propertyId: string | null) {
  return useQuery({
    queryKey: EventQueryKeys.byProperty(propertyId ?? ""),
    queryFn:  async (): Promise<OnchainEvent[]> => {
      if (!propertyId) return [];
      const res = await fetch(`/api/events/property/${propertyId}`);
      if (!res.ok) throw new Error(`property events fetch ${res.status}`);
      return res.json() as Promise<OnchainEvent[]>;
    },
    enabled:         !!propertyId,
    staleTime:       0,
    refetchInterval: 10_000,
  });
}

// ── Hook: actividad del wallet conectado ─────────────────────────────────────

export function useWalletActivity() {
  const { publicKey } = useWallet();

  return useQuery({
    queryKey: EventQueryKeys.byWallet(publicKey?.toBase58() ?? ""),
    queryFn:  async (): Promise<OnchainEvent[]> => {
      if (!publicKey) return [];
      const res = await fetch(`/api/events/wallet/${publicKey.toBase58()}`);
      if (!res.ok) throw new Error(`wallet events fetch ${res.status}`);
      return res.json() as Promise<OnchainEvent[]>;
    },
    enabled:         !!publicKey,
    staleTime:       0,
    refetchInterval: 15_000,
  });
}

// ── Utilidades ────────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  RentDeposited:        "Renta depositada",
  RentClaimed:          "Renta reclamada",
  TokensMinted:         "Tokens comprados",
  PropertyInitialized:  "Propiedad creada",
  PropertyToggled:      "Estado cambiado",
  OfferCreated:         "Oferta creada",
  OfferAccepted:        "Oferta aceptada",
  OfferCancelled:       "Oferta cancelada",
  ValuationUpdated:     "Valuación actualizada",
  KycApproved:          "KYC aprobado",
  LoanInitiated:        "Préstamo iniciado",
  LoanRepaid:           "Préstamo repagado",
  TimelockProposed:     "Operación propuesta",
};

export function getEventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

export function formatEventAmount(event: OnchainEvent): string {
  if (!event.amountLamports) return "";
  const sol = event.amountLamports / 1_000_000_000;
  return `${sol.toFixed(4)} SOL`;
}
