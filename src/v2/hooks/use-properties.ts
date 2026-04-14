/**
 * v2/hooks/use-properties.ts
 * React Query — reemplaza el polling manual con setInterval de 30s.
 *
 * Ventajas sobre el hook v1:
 *   - Cache automático: segunda visita es instantánea
 *   - Background refetch: actualiza sin bloquear el UI
 *   - Deduplicación: múltiples componentes comparten la misma query
 *   - Optimistic updates: el buy se refleja antes de confirmar on-chain
 *   - Error retry con backoff exponencial automático
 *
 * Interoperabilidad: sigue llamando a fetchAllProperties() de lib/program.ts
 * sin modificar nada del core.
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useMemo } from "react";
import {
  getProvider,
  getProgram,
  fetchAllProperties,
  fetchPortfolio,
  mintFractionalTokens,
  distributeRent,
} from "../../lib/program";
import type { PropertyUI, PortfolioPosition } from "../../types";
import { useToastPush } from "../store/app.store";

// ── Query keys — centralizados para invalidación consistente ─────────────────

export const QueryKeys = {
  properties:    ["properties"]                    as const,
  portfolio:     (wallet: string) => ["portfolio", wallet] as const,
  property:      (id: string)     => ["property",  id]     as const,
  oracle:        (id: string)     => ["oracle",    id]     as const,
} as const;

// ── Hook: todas las propiedades ───────────────────────────────────────────────

export function useProperties() {
  const wallet         = useWallet();
  const { connection } = useConnection();

  const program = useMemo(() => {
    if (!wallet.publicKey) return null;
    return getProgram(getProvider(wallet, connection));
  }, [wallet, connection]);

  return useQuery({
    queryKey:  QueryKeys.properties,
    queryFn:   async () => {
      if (!program) return [] as PropertyUI[];
      return fetchAllProperties(program);
    },
    enabled:        !!wallet.connected,
    staleTime:       0,           // R6: Helius invalida el cache por Redis
    refetchInterval: 10_000,      // Fallback si Helius webhook no está activo
    refetchOnWindowFocus: true,   // actualizar al volver a la pestaña
    retry:          2,
  });
}

// ── Hook: portfolio del wallet conectado ──────────────────────────────────────

export function usePortfolio() {
  const wallet         = useWallet();
  const { connection } = useConnection();

  const program = useMemo(() => {
    if (!wallet.publicKey) return null;
    return getProgram(getProvider(wallet, connection));
  }, [wallet, connection]);

  return useQuery({
    queryKey: QueryKeys.portfolio(wallet.publicKey?.toBase58() ?? ""),
    queryFn: async () => {
      if (!program || !wallet.publicKey) return [] as PortfolioPosition[];
      return fetchPortfolio(program, connection, wallet.publicKey);
    },
    enabled:    !!wallet.publicKey,
    staleTime:   0,           // R6: invalidado por Helius en cada evento
    retry: 2,
  });
}

// ── Mutation: comprar tokens ──────────────────────────────────────────────────

export function useBuyTokens() {
  const wallet         = useWallet();
  const { connection } = useConnection();
  const queryClient    = useQueryClient();
  const push           = useToastPush();

  const program = useMemo(() => {
    if (!wallet.publicKey) return null;
    return getProgram(getProvider(wallet, connection));
  }, [wallet, connection]);

  return useMutation({
    mutationFn: async ({ property, amount }: { property: PropertyUI; amount: number }) => {
      if (!program) throw new Error("Wallet no conectado");
      return mintFractionalTokens(program, wallet, property, amount);
    },

    onMutate: async ({ property, amount }) => {
      // Optimistic update — actualizar la UI antes de confirmar on-chain
      await queryClient.cancelQueries({ queryKey: QueryKeys.properties });

      const snapshot = queryClient.getQueryData<PropertyUI[]>(QueryKeys.properties);

      queryClient.setQueryData<PropertyUI[]>(QueryKeys.properties, (old = []) =>
        old.map((p) =>
          p.pubkey === property.pubkey
            ? { ...p, tokensIssued: p.tokensIssued + amount, availableTokens: p.availableTokens - amount }
            : p
        )
      );

      return { snapshot };
    },

    onError: (err, _vars, context) => {
      // Revertir el optimistic update si falla
      if (context?.snapshot) {
        queryClient.setQueryData(QueryKeys.properties, context.snapshot);
      }
      push(`Error: ${err instanceof Error ? err.message : "Transacción fallida"}`, "error");
    },

    onSuccess: (_sig, { amount, property }) => {
      push(`${amount.toLocaleString()} tokens comprados en ${property.location.split(",")[0]}`, "success");
      // Invalidar para refrescar datos reales on-chain
      queryClient.invalidateQueries({ queryKey: QueryKeys.properties });
      queryClient.invalidateQueries({
        queryKey: QueryKeys.portfolio(wallet.publicKey?.toBase58() ?? ""),
      });
    },
  });
}

// ── Mutation: claim rent ──────────────────────────────────────────────────────

export function useClaimRent() {
  const wallet         = useWallet();
  const { connection } = useConnection();
  const queryClient    = useQueryClient();
  const push           = useToastPush();

  const program = useMemo(() => {
    if (!wallet.publicKey) return null;
    return getProgram(getProvider(wallet, connection));
  }, [wallet, connection]);

  return useMutation({
    mutationFn: async (property: PropertyUI) => {
      if (!program) throw new Error("Wallet no conectado");
      return distributeRent(program, wallet, property);
    },
    onSuccess: (_sig, property) => {
      push(`Renta reclamada de ${property.location.split(",")[0]}`, "success");
      queryClient.invalidateQueries({
        queryKey: QueryKeys.portfolio(wallet.publicKey?.toBase58() ?? ""),
      });
    },
    onError: (err) => {
      push(`Error reclamando renta: ${err instanceof Error ? err.message : "Error"}`, "error");
    },
  });
}
