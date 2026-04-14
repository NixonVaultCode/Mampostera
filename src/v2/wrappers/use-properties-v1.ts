/**
 * v2/wrappers/use-properties-v1.ts
 *
 * Wrapper de compatibilidad: expone el mismo contrato que el hook v1
 * (useProperties, usePortfolio, useBuyTokens, useClaimRent) pero
 * internamente usa React Query + Zustand.
 *
 * Uso: cualquier componente v1 puede importar desde aquí sin cambios.
 *
 * import { useProperties } from "@/v2/wrappers/use-properties-v1";
 *                                 ↑ drop-in replacement del hook v1
 */

"use client";

import {
  useProperties as _useProperties,
  usePortfolio  as _usePortfolio,
  useBuyTokens  as _useBuyTokens,
  useClaimRent  as _useClaimRent,
} from "../hooks/use-properties";
import { useToastPush, useToastDismiss, useToasts } from "../store/app.store";
import type { PropertyUI } from "../../types";
import type { ToastType } from "../../types";

// ── useProperties — mismo shape que v1 ───────────────────────────────────────

export function useProperties() {
  const { data, isLoading, error, refetch } = _useProperties();
  return {
    properties: data ?? [],
    loading:    isLoading,
    error:      error ? (error as Error).message : null,
    reload:     refetch,
  };
}

// ── usePortfolio — mismo shape que v1 ────────────────────────────────────────

export function usePortfolio() {
  const { data, isLoading, error, refetch } = _usePortfolio();
  return {
    positions: data ?? [],
    loading:   isLoading,
    error:     error ? (error as Error).message : null,
    reload:    refetch,
  };
}

// ── useBuyTokens(push) — acepta el argumento push de v1 (ignorado) ────────────

export function useBuyTokens(_push?: (msg: string, type: ToastType, dur?: number) => number) {
  const mutation = _useBuyTokens();

  const buy = async (property: PropertyUI, amount: number): Promise<boolean> => {
    try {
      await mutation.mutateAsync({ property, amount });
      return true;
    } catch {
      return false;
    }
  };

  return { buy, buying: mutation.isPending };
}

// ── useClaimRent(push) — acepta el argumento push de v1 (ignorado) ────────────

export function useClaimRent(_push?: (msg: string, type: ToastType, dur?: number) => number) {
  const mutation = _useClaimRent();

  const claim = async (property: PropertyUI): Promise<boolean> => {
    try {
      await mutation.mutateAsync(property);
      return true;
    } catch {
      return false;
    }
  };

  return { claim, claiming: mutation.isPending };
}

// ── useToast — compatible con v1 ─────────────────────────────────────────────

export function useToast() {
  const push    = useToastPush();
  const dismiss = useToastDismiss();
  const toasts  = useToasts();

  return { toasts, push, dismiss };
}
