"use client";
/**
 * v2/components/property/PropertyCard.tsx
 * Tailwind v4 + Framer Motion. Consume PropertyUI de lib/program.ts sin modificarlo.
 */
import { motion } from "framer-motion";
import { Card, CardContent, CardFooter, Badge, Button, Skeleton } from "../ui";
import { ProofOfReserveBadge } from "./ProofOfReserveBadge";
import type { PropertyUI } from "../../../types";

const cardAnim = {
  hidden:  { opacity: 0, y: 20 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.07, duration: 0.3 } }),
  hover:   { y: -4, transition: { duration: 0.15 } },
};

interface Props {
  property:    PropertyUI;
  onBuy?:      (p: PropertyUI) => void;
  onClaim?:    (p: PropertyUI) => void;
  userTokens?: number;
  index?:      number;
}

export function PropertyCard({ property, onBuy, onClaim, userTokens = 0, index = 0 }: Props) {
  const funded  = Math.min(property.fundedPercent, 100);
  const rentEst = ((property.totalValueUSD * property.apy) / 100 / 12).toFixed(0);

  return (
    <motion.div variants={cardAnim} initial="hidden" animate="visible" whileHover="hover" custom={index}>
      <Card className="overflow-hidden hover:border-[#9945ff]/40 transition-colors">

        {/* Header */}
        <div className="relative h-36" style={{ background: property.imageGradient || "linear-gradient(135deg,#1a3a5c,#0d2238)" }}>
          <div className="absolute top-3 left-3 flex gap-2">
            <Badge variant={property.isActive ? "success" : "danger"}>
              {property.isActive ? "Activa" : "Inactiva"}
            </Badge>
            <Badge variant="solana">{property.propertyType}</Badge>
          </div>
          <div className="absolute bottom-3 right-3 text-right">
            <p className="text-xs text-white/50">APY est.</p>
            <p className="text-xl font-bold text-[#14f195]">{property.apy}%</p>
          </div>
          {userTokens > 0 && (
            <div className="absolute top-3 right-3">
              <Badge variant="info">{userTokens.toLocaleString()} tokens</Badge>
            </div>
          )}
        </div>

        <CardContent className="pt-4 space-y-4">
          {/* Ubicación */}
          <div>
            <h3 className="font-semibold text-white truncate text-sm">
              {property.location.split(",")[0]}
            </h3>
            <p className="text-xs text-white/40 mt-0.5">{property.city}, {property.country}</p>
            {/* R8: Proof of Reserve badge — verificable on-chain */}
            {property.pubkey && (
              <div className="mt-1.5">
                <ProofOfReserveBadge propertyPubkey={property.pubkey} showDetails={false} />
              </div>
            )}
          </div>

          {/* Métricas */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Stat label="Valor total"     value={`$${(property.totalValueUSD / 1000).toFixed(0)}K`} />
            <Stat label="Precio/token"    value={`$${property.pricePerTokenUSD.toFixed(2)}`} />
            <Stat label="Renta/mes est."  value={`$${Number(rentEst).toLocaleString()}`} accent />
            <Stat label="Disponibles"     value={property.availableTokens.toLocaleString()} />
          </div>

          {/* Barra de financiamiento */}
          <div>
            <div className="flex justify-between mb-1.5">
              <span className="text-xs text-white/40">Financiado</span>
              <span className="text-xs font-medium text-white">{funded.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-[#9945ff] to-[#14f195]"
                initial={{ width: 0 }}
                animate={{ width: `${funded}%`, transition: { duration: 0.8, delay: 0.3 } }}
              />
            </div>
          </div>
        </CardContent>

        <CardFooter className="border-t border-white/5 pt-3 gap-2">
          {userTokens > 0 ? (
            <>
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => onClaim?.(property)}>
                Reclamar renta
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => onBuy?.(property)}>
                Comprar más
              </Button>
            </>
          ) : (
            <Button size="sm" className="w-full" onClick={() => onBuy?.(property)} disabled={!property.isActive}>
              {property.isActive ? "Invertir" : "No disponible"}
            </Button>
          )}
        </CardFooter>
      </Card>
    </motion.div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-white/40 uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-semibold ${accent ? "text-[#14f195]" : "text-white"}`}>{value}</p>
    </div>
  );
}

export function PropertyCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="h-36 rounded-none" />
      <CardContent className="pt-4 space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8" />)}
        </div>
        <Skeleton className="h-1.5 w-full" />
      </CardContent>
      <CardFooter className="border-t border-white/5 pt-3">
        <Skeleton className="h-9 w-full" />
      </CardFooter>
    </Card>
  );
}
