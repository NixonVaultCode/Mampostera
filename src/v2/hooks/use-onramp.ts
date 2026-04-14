"use client";
/**
 * v2/hooks/use-onramp.ts
 *
 * R5 + R14: Hook para el flujo completo de on-ramp.
 * Maneja: Wompi (PSE/Nequi) → fallback Stripe → polling de confirmación.
 *
 * El flujo de 1 paso:
 *   1. Usuario elige monto + método de pago
 *   2. useMutation llama POST /api/payments/wompi
 *   3. Si Wompi: redirect a checkout Wompi (o deep link Nequi)
 *   4. Si Stripe fallback: abrir Stripe Crypto On-Ramp embeddable
 *   5. Wompi webhook confirma → React Query invalida cache de properties
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet }                    from "@solana/wallet-adapter-react";
import { useToastPush }                 from "../store/app.store";
import { QueryKeys }                    from "./use-properties";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type OnrampMethod = "PSE" | "NEQUI" | "BANCOLOMBIA_TRANSFER" | "STRIPE";

export interface OnrampParams {
  amountCOP:      number;
  paymentMethod:  OnrampMethod;
  propertyId?:    string;
  customerEmail?: string;
  customerPhone?: string;
}

export interface OnrampResult {
  ok:           boolean;
  provider:     "wompi" | "stripe";
  fallback?:    boolean;
  redirectUrl?: string;
  reference:    string;
  amountCOP:    number;
  amountUsdc:   number;
  error?:       string;
}

// ── Montos rápidos en COP ─────────────────────────────────────────────────────

export const QUICK_AMOUNTS_COP = [
  { label: "$50.000",   value: 50_000  },
  { label: "$100.000",  value: 100_000 },
  { label: "$200.000",  value: 200_000 },
  { label: "$500.000",  value: 500_000 },
] as const;

// ── Hook principal ────────────────────────────────────────────────────────────

export function useOnramp() {
  const { publicKey }  = useWallet();
  const queryClient    = useQueryClient();
  const push           = useToastPush();

  const mutation = useMutation({
    mutationFn: async (params: OnrampParams): Promise<OnrampResult> => {
      if (!publicKey) throw new Error("Conecta tu wallet primero");

      const body: Record<string, unknown> = {
        amountCOP:     params.amountCOP,
        walletAddress: publicKey.toBase58(),
        propertyId:    params.propertyId,
        customerEmail: params.customerEmail,
        customerPhone: params.customerPhone,
      };

      // PSE y BANCOLOMBIA van a Wompi; Nequi también
      // STRIPE va directamente al endpoint de Stripe
      const endpoint = params.paymentMethod === "STRIPE"
        ? "/api/payments/stripe"
        : "/api/payments/wompi";

      if (params.paymentMethod !== "STRIPE") {
        body.paymentMethod = params.paymentMethod;
      } else {
        // Stripe recibe amountUsdc en cents — convertir desde COP
        body.amountUsdc = Math.round(params.amountCOP * 0.00024 * 100);
      }

      const res = await fetch(endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? `Error ${res.status}`);
      }

      return res.json() as Promise<OnrampResult>;
    },

    onSuccess: (result) => {
      if (result.fallback) {
        push("Pagando con tarjeta internacional (Wompi no disponible)", "info");
      } else {
        push(`Redirigiendo a ${result.provider === "wompi" ? "PSE/Nequi" : "Stripe"}...`, "success");
      }

      // Abrir la URL de pago en una nueva pestaña
      if (result.redirectUrl) {
        window.open(result.redirectUrl, "_blank", "noopener,noreferrer");
      }

      // Invalidar el portfolio del inversor cuando vuelva
      // (el webhook de Wompi lo actualiza en el backend; esto es para la UI)
      queryClient.invalidateQueries({
        queryKey: QueryKeys.portfolio(publicKey?.toBase58() ?? ""),
      });
    },

    onError: (err) => {
      push(err instanceof Error ? err.message : "Error en el pago", "error");
    },
  });

  // Formatear COP en pesos colombianos
  function formatCOP(amount: number): string {
    return new Intl.NumberFormat("es-CO", {
      style:    "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(amount);
  }

  // Calcular USDC aproximado desde COP (solo para mostrar en UI)
  function copToUsdc(amountCOP: number): number {
    return Math.round(amountCOP * 0.00024 * 100) / 100;
  }

  return {
    initiate:   mutation.mutate,
    isPending:  mutation.isPending,
    isSuccess:  mutation.isSuccess,
    result:     mutation.data,
    error:      mutation.error,
    formatCOP,
    copToUsdc,
    QUICK_AMOUNTS_COP,
  };
}
