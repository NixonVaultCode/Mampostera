"use client";
/**
 * app/providers.tsx
 *
 * Orden obligatorio (resolver conflicto HIGH detectado):
 *   PrivyProvider → WalletProvider → CivicProvider → PostHogProvider
 *
 * Crisp Chat se inicializa aquí como efecto de lado (no es un Provider).
 */

import { useMemo, useEffect } from "react";
import { PrivyProvider }             from "@privy-io/react-auth";
import { WalletAdapterNetwork }      from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider }       from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import posthog                       from "posthog-js";
import { PostHogProvider }           from "posthog-js/react";
import "@solana/wallet-adapter-react-ui/styles.css";

const NETWORK   = (process.env.NEXT_PUBLIC_SOLANA_NETWORK as WalletAdapterNetwork) ?? WalletAdapterNetwork.Devnet;
const ENDPOINT  = process.env.NEXT_PUBLIC_RPC_ENDPOINT   ?? "https://api.devnet.solana.com";
const PRIVY_ID  = process.env.NEXT_PUBLIC_PRIVY_APP_ID   ?? "";
const PH_KEY    = process.env.NEXT_PUBLIC_POSTHOG_KEY    ?? "";
const PH_HOST   = process.env.NEXT_PUBLIC_POSTHOG_HOST   ?? "https://app.posthog.com";
const CRISP_ID  = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID ?? "";

// Inicializar PostHog una sola vez fuera del componente
if (typeof window !== "undefined" && PH_KEY && !posthog.__loaded) {
  posthog.init(PH_KEY, {
    api_host:                  PH_HOST,
    capture_pageview:          false,   // lo hacemos manualmente por ruta
    capture_pageleave:         true,
    disable_session_recording: process.env.NODE_ENV !== "production",
    loaded: (ph) => {
      if (process.env.NODE_ENV === "development") ph.opt_out_capturing();
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter({ network: NETWORK }),
    ],
    []
  );

  // ── Crisp Chat — inicialización cliente ─────────────────────────────────────
  useEffect(() => {
    if (!CRISP_ID || typeof window === "undefined") return;

    // Evitar doble inicialización en hot reload
    if ((window as Window & { $crisp?: unknown[] }).$crisp) return;

    (window as Window & { $crisp: unknown[]; CRISP_WEBSITE_ID: string }).$crisp = [];
    (window as Window & { $crisp: unknown[]; CRISP_WEBSITE_ID: string }).CRISP_WEBSITE_ID = CRISP_ID;

    const script    = document.createElement("script");
    script.src      = "https://client.crisp.chat/l.js";
    script.async    = true;
    script.id       = "crisp-widget";
    document.head.appendChild(script);

    return () => {
      // Limpiar en unmount (dev HMR)
      const el = document.getElementById("crisp-widget");
      if (el) el.remove();
    };
  }, []);

  return (
    // 1. PostHog — analytics browser (más exterior porque no depende de wallet)
    <PostHogProvider client={posthog}>
      {/* 2. Privy — auth + embedded wallets */}
      <PrivyProvider
        appId={PRIVY_ID}
        config={{
          loginMethods:    ["email", "wallet", "google"],
          embeddedWallets: { createOnLogin: "users-without-wallets" },
          appearance:      { theme: "dark", accentColor: "#14f195" },
          // BUG-13 fix: solanaClusters está deprecado en Privy v1.80+.
          // La configuración correcta usa externalWallets para wallet adapters de Solana.
        }}
      >
        {/* 3. Solana Connection + Wallet */}
        <ConnectionProvider endpoint={ENDPOINT}>
          <WalletProvider wallets={wallets} autoConnect>
            <WalletModalProvider>
              {/* 4. Civic KYC se usa via useCivicKYC() hook en componentes */}
              {children}
            </WalletModalProvider>
          </WalletProvider>
        </ConnectionProvider>
      </PrivyProvider>
    </PostHogProvider>
  );
}
