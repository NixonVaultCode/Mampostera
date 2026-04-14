"use client";
/**
 * v2/trpc/client.ts
 * Cliente tRPC — usa el QueryClient del V2Providers, no crea uno nuevo.
 * BUG-03 fix: eliminar el cast "undefined as unknown as QueryClient".
 */
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter }  from "./router";

export const trpc = createTRPCReact<AppRouter>();

// El TRPCProvider se configura en v2/app/providers.tsx junto con QueryClientProvider.
// Exportar solo el cliente tRPC — el Provider está en providers.tsx.
