"use client";
/**
 * v2/app/providers.tsx
 * React Query + tRPC correctamente integrados.
 * BUG-03 fix: trpc.Provider recibe el queryClient real, no undefined.
 */
import { useState }         from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools }               from "@tanstack/react-query-devtools";
import { trpc }                             from "../trpc/client";
import { httpBatchLink }                    from "@trpc/client";
import { useWallet }                        from "@solana/wallet-adapter-react";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime:            15_000,
        retry:                2,
        refetchOnWindowFocus: true,
      },
    },
  });
}

// Singleton en browser para evitar recrear el cliente en cada render
let browserQueryClient: QueryClient | undefined;
function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function V2Providers({ children }: { children: React.ReactNode }) {
  const { publicKey } = useWallet();
  const queryClient   = getQueryClient();

  // useState garantiza que el cliente tRPC no se recrea en cada render
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url:     "/v2/api/trpc",
          headers: () => ({
            "x-wallet-address": publicKey?.toBase58() ?? "",
          }),
        }),
      ],
    })
  );

  return (
    // BUG-03 fix: pasar queryClient real al trpc.Provider
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
        {process.env.NODE_ENV === "development" && (
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
        )}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
