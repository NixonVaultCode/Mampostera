"use client";
/**
 * v2/hooks/use-virtual-account.ts
 *
 * R13: Hook para gestionar la cuenta virtual COP del inversor.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWallet }                              from "@solana/wallet-adapter-react";
import { useToastPush }                           from "../store/app.store";

export function useVirtualAccount() {
  const { publicKey } = useWallet();
  const push          = useToastPush();
  const qc            = useQueryClient();

  const link = useMutation({
    mutationFn: async ({ phone }: { phone: string }) => {
      if (!publicKey) throw new Error("Wallet no conectado");
      const res = await fetch("/api/payments/virtual-account", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:        "link",
          walletAddress: publicKey.toBase58(),
          phone,
        }),
      });
      if (!res.ok) {
        const e = await res.json() as { error?: string };
        throw new Error(e.error ?? "Error vinculando cuenta");
      }
      return res.json();
    },
    onSuccess: () => {
      push("Cuenta Nequi vinculada — la renta llegará en COP automáticamente", "success");
      qc.invalidateQueries({ queryKey: ["virtual_account"] });
    },
    onError: (e) => push(e instanceof Error ? e.message : "Error", "error"),
  });

  const unlink = useMutation({
    mutationFn: async () => {
      if (!publicKey) throw new Error("Wallet no conectado");
      const res = await fetch("/api/payments/virtual-account", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:        "unlink",
          walletAddress: publicKey.toBase58(),
        }),
      });
      if (!res.ok) throw new Error("Error desvinculando");
      return res.json();
    },
    onSuccess: () => push("Cuenta desvinculada", "info"),
  });

  return { link, unlink };
}
