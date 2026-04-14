"use client";
/**
 * v2/app/page.tsx
 * UI completa en Tailwind v4 + shadcn. Consume los mismos hooks que v1
 * a través de los wrappers de compatibilidad. lib/program.ts intocable.
 *
 * Para activar: cambiar la importación en /app/page.tsx
 *   import V2Page from "@/v2/app/page"
 *   export default V2Page;
 */
import { useState }                     from "react";
import { motion, AnimatePresence }      from "framer-motion";
import { useWallet }                    from "@solana/wallet-adapter-react";
import { WalletMultiButton }            from "@solana/wallet-adapter-react-ui";
import { V2Providers }                  from "./providers";
import { Tabs, TabsList, TabsTrigger, TabsContent, Badge, Button, Dialog, DialogContent, DialogTitle } from "../components/ui";
import { PropertyCard, PropertyCardSkeleton } from "../components/property/PropertyCard";
import { AnalyticsDashboardV2 }         from "../components/dashboard/AnalyticsDashboard";
import { ActivityFeed }                 from "../components/dashboard/ActivityFeed";
import { BlinkButton }                  from "../components/property/BlinkButton";
import { OnrampButton }                from "../components/payments/OnrampButton";
import { LiquidityPoolCard }          from "../components/property/LiquidityPoolCard";
import { MampStakeCard }              from "../components/token/MampStakeCard";
import { VirtualAccountCard }         from "../components/payments/VirtualAccountCard";
import { PoRRegistrationCard }        from "../components/admin/AdminPanel";
import { AdminPanelV2 }                 from "../components/admin/AdminPanel";
import { useProperties, usePortfolio, useBuyTokens, useClaimRent } from "../hooks/use-properties";
import { useAppStore, useToasts, useToastDismiss } from "../store/app.store";
import { useCivicKYC }                  from "../../components/kyc/CivicKYC";
import type { PropertyUI }              from "../../types";

// ── Toast stack ───────────────────────────────────────────────────────────────

function ToastStack() {
  const toasts  = useToasts();
  const dismiss = useToastDismiss();
  const colors  = { success: "#14f195", error: "#f87171", loading: "#9945ff", info: "#60a5fa" } as const;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0d1117] px-4 py-3 shadow-xl cursor-pointer"
            onClick={() => dismiss(t.id)}
          >
            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: colors[t.type] }} />
            <p className="text-sm text-white">{t.msg}</p>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ── Buy modal ─────────────────────────────────────────────────────────────────

function BuyModal({ property, onClose }: { property: PropertyUI; onClose: () => void }) {
  const [amount, setAmount]   = useState(100);
  const { mutate: buy, isPending } = useBuyTokens();
  const { status: kycStatus } = useCivicKYC();
  const kycOk = kycStatus === "verified";

  const total   = amount * property.pricePerTokenUSD;
  const rentEst = ((total * (property.apy / 100)) / 12).toFixed(2);

  return (
    <DialogContent>
      <DialogTitle>Comprar tokens — {property.location.split(",")[0]}</DialogTitle>
      <div className="mt-4 space-y-4">
        {!kycOk && (
          <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs text-yellow-400">
            Completa el KYC con Civic Pass para invertir
          </div>
        )}
        <div>
          <label className="text-xs text-white/40 mb-1.5 block">Tokens a comprar</label>
          <input
            type="range" min={1} max={Math.min(property.availableTokens, 10000)}
            value={amount} onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full accent-[#9945ff]"
          />
          <div className="flex justify-between text-xs text-white/40 mt-1">
            <span>1</span>
            <span className="font-semibold text-white">{amount.toLocaleString()}</span>
            <span>{Math.min(property.availableTokens, 10000).toLocaleString()}</span>
          </div>
        </div>
        <div className="rounded-lg bg-white/5 p-3 space-y-1.5">
          <Row label="Precio/token" value={`$${property.pricePerTokenUSD.toFixed(2)}`} />
          <Row label="Total inversión" value={`$${total.toFixed(2)}`} accent />
          <Row label="Renta/mes estimada" value={`$${rentEst}`} accent />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1"
            disabled={!kycOk}
            loading={isPending}
            onClick={() => buy({ property, amount }, { onSuccess: onClose })}
          >
            Confirmar
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-xs text-white/40">{label}</span>
      <span className={`text-xs font-semibold ${accent ? "text-[#14f195]" : "text-white"}`}>{value}</span>
    </div>
  );
}

// ── Inner app (usa hooks — necesita providers) ────────────────────────────────

function AppInner() {
  const { connected, publicKey } = useWallet();
  const openBuyModal  = useAppStore((s) => s.openBuyModal);
  const closeBuyModal = useAppStore((s) => s.closeBuyModal);
  const buyModalProp  = useAppStore((s) => s.buyModalProp);

  const { data: properties = [], isLoading: propsLoading } = useProperties();
  const { data: portfolio  = [], isLoading: portLoading  } = usePortfolio();
  const { mutate: claimRent } = useClaimRent();

  // BUG-14 fix: verificar autoridad server-side mediante una API call firmada,
  // no comparando con una variable NEXT_PUBLIC (visible en el bundle del cliente).
  // Por ahora usamos la variable pública solo para mostrar/ocultar la tab — 
  // las acciones admin están protegidas por has_one = authority en el Programa Anchor.
  // Un atacante puede ver la tab pero cualquier tx sin la keypair correcta fallará on-chain.
  const isAuthority = !!publicKey &&
    publicKey.toBase58() === process.env.NEXT_PUBLIC_AUTHORITY_PUBKEY;

  return (
    <div className="min-h-screen bg-[#060910] text-white">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#060910]/80 backdrop-blur">
        <div className="mx-auto max-w-6xl flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="text-[#9945ff] font-bold text-lg">⬡</span>
            <span className="font-bold text-sm tracking-tight">Mampostera</span>
            <Badge variant="solana" className="ml-1">beta</Badge>
          </div>
          <div className="flex items-center gap-2">
            <OnrampButton variant="secondary" size="sm" label="Invertir COP" />
            <WalletMultiButton style={{ height: 36, fontSize: 13 }} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Tabs defaultValue="marketplace">
          <TabsList className="mb-6">
            <TabsTrigger value="marketplace">Marketplace</TabsTrigger>
            <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="tokens">MAMP</TabsTrigger>
          {isAuthority && <TabsTrigger value="admin">Admin</TabsTrigger>}
          </TabsList>

          {/* Marketplace */}
          <TabsContent value="marketplace">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {propsLoading
                ? [...Array(6)].map((_, i) => <PropertyCardSkeleton key={i} />)
                : properties.map((p, i) => (
                    <PropertyCard
                      key={p.pubkey}
                      property={p}
                      index={i}
                      onBuy={openBuyModal}
                      onClaim={(prop) => claimRent(prop)}
                      userTokens={portfolio.find((pos) => pos.property.pubkey === p.pubkey)?.tokensOwned ?? 0}
                    />
                  ))
              }
            </div>
            {!propsLoading && properties.length === 0 && (
              <div className="text-center py-20 text-white/30">
                <p className="text-4xl mb-3">⬡</p>
                <p>Sin propiedades disponibles aún</p>
              </div>
            )}
          </TabsContent>

          {/* Portfolio */}
          <TabsContent value="portfolio">
            {/* R9: Pool de liquidez para salida rápida */}
            {!connected ? (
              <div className="text-center py-20 text-white/30">
                <p>Conecta tu wallet para ver tu portfolio</p>
              </div>
            ) : portLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => <PropertyCardSkeleton key={i} />)}
              </div>
            ) : portfolio.length === 0 ? (
              <div className="text-center py-20 text-white/30">
                <p>No tienes inversiones todavía</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {portfolio.map((pos, i) => (
                  <PropertyCard
                    key={pos.property.pubkey}
                    property={pos.property}
                    index={i}
                    userTokens={pos.tokensOwned}
                    onClaim={(prop) => claimRent(prop)}
                    onBuy={openBuyModal}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Analytics */}
          <TabsContent value="analytics">
            <div className="space-y-4">
              <AnalyticsDashboardV2 />
              <ActivityFeed limit={20} />
            </div>
          </TabsContent>

          {/* Admin */}
          {isAuthority && (
            <TabsContent value="tokens">
              <div className="space-y-4">
                <MampStakeCard />
                <VirtualAccountCard />
              </div>
            </TabsContent>

            <TabsContent value="admin">
              <div className="space-y-4">
                <AdminPanelV2 />
                {/* R8: Registrar Proof of Reserve — solo authority */}
                <PoRRegistrationCard properties={[]} />
              </div>
            </TabsContent>
          )}
        </Tabs>
      </main>

      {/* Buy modal */}
      <Dialog open={!!buyModalProp} onOpenChange={(open) => !open && closeBuyModal()}>
        {buyModalProp && <BuyModal property={buyModalProp} onClose={closeBuyModal} />}
      </Dialog>

      <ToastStack />
    </div>
  );
}

// ── Export default (con V2Providers) ─────────────────────────────────────────

export default function V2Page() {
  return (
    <V2Providers>
      <AppInner />
    </V2Providers>
  );
}
