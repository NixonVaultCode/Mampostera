"use client";
/**
 * v2/components/property/LiquidityPoolCard.tsx
 *
 * R9: Card que muestra el estado del pool de liquidez Orca de una propiedad.
 * Permite al inversor salir de su posición vendiendo al pool en < 30 segundos
 * sin depender de un comprador P2P.
 */
import { useQuery }          from "@tanstack/react-query";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey }         from "@solana/web3.js";
import { Card, CardContent, Badge, Button, Skeleton } from "../ui";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface PoolData {
  propertyPubkey:      string;
  whirlpoolPubkey:     string;
  tickLowerIndex:      number;
  tickUpperIndex:      number;
  priceLowerCents:     number;
  priceUpperCents:     number;
  protocolLiquidity:   string;   // bigint como string
  initialOraclePrice:  number;
  isActive:            boolean;
}

// ── Hook: leer LiquidityPool PDA ─────────────────────────────────────────────

function useLiquidityPool(propertyPubkey: string | null) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ["liquidity_pool", propertyPubkey],
    queryFn:  async (): Promise<PoolData | null> => {
      if (!propertyPubkey) return null;

      const PROGRAM_ID = new PublicKey(
        process.env.NEXT_PUBLIC_PROGRAM_ID ?? "MAMPoSTERAv2222222222222222222222222222222"
      );

      const [poolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("liquidity_pool"), new PublicKey(propertyPubkey).toBuffer()],
        PROGRAM_ID
      );

      const accountInfo = await connection.getAccountInfo(poolPda);
      if (!accountInfo) return null;

      const data = accountInfo.data;
      // Layout: 8 (disc) + 32 (property) + 32 (whirlpool) + 32 (usdc_mint)
      //       + 4 (tick_lower) + 4 (tick_upper) + 16 (liquidity u128)
      //       + 8 (initial_oracle_price) + 8 (fees) + 1 (is_active) + 1 (bump)
      if (data.length < 148) return null;

      let offset = 8 + 32; // skip discriminator + property

      const whirlpoolPubkey = new PublicKey(data.slice(offset, offset + 32)).toBase58();
      offset += 32 + 32; // skip whirlpool + usdc_mint

      const tickLowerIndex  = data.readInt32LE(offset); offset += 4;
      const tickUpperIndex  = data.readInt32LE(offset); offset += 4;

      // u128 as two u64s (little-endian)
      const liqLow  = data.readBigUInt64LE(offset); offset += 8;
      const liqHigh = data.readBigUInt64LE(offset); offset += 8;
      const protocolLiquidity = (liqHigh * BigInt("18446744073709551616") + liqLow).toString();

      const initialOraclePrice = Number(data.readBigUInt64LE(offset)); offset += 8;
      offset += 8; // skip total_fees_collected

      const isActive = data[offset] === 1;

      // Convertir tick indices a precios aproximados (inverso de la función Rust)
      const priceLowerCents = tickLowerIndex * 10;
      const priceUpperCents = tickUpperIndex * 10;

      return {
        propertyPubkey,
        whirlpoolPubkey,
        tickLowerIndex,
        tickUpperIndex,
        priceLowerCents,
        priceUpperCents,
        protocolLiquidity,
        initialOraclePrice,
        isActive,
      };
    },
    enabled:         !!propertyPubkey,
    staleTime:       0,
    refetchInterval: 30_000,
    retry:           1,
  });
}

// ── Componente ────────────────────────────────────────────────────────────────

interface LiquidityPoolCardProps {
  propertyPubkey: string;
  oraclePrice?:   number;    // USD cents actuales del oracle
  userTokens?:    number;    // tokens del inversor en esta propiedad
}

export function LiquidityPoolCard({
  propertyPubkey,
  oraclePrice = 0,
  userTokens  = 0,
}: LiquidityPoolCardProps) {
  const { data: pool, isLoading } = useLiquidityPool(propertyPubkey);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-4 space-y-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!pool) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Pool de liquidez</p>
              <p className="text-xs text-white/40 mt-0.5">No inicializado — solo mercado P2P</p>
            </div>
            <Badge variant="warning" className="text-[10px]">Sin pool</Badge>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calcular si el precio actual está dentro del rango
  const inRange = oraclePrice > 0
    ? oraclePrice >= pool.priceLowerCents && oraclePrice <= pool.priceUpperCents
    : null;

  // Calcular valor aproximado de la posición del inversor
  const tokenValueCents = oraclePrice > 0 && userTokens > 0
    ? Math.round(userTokens * (oraclePrice / 1_000_000)) // tokens con 6 dec
    : 0;

  const orcaUrl = `https://www.orca.so/liquidity/browse?pool=${pool.whirlpoolPubkey}`;

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-white">Orca CLMM Pool</p>
            <Badge variant={pool.isActive ? "success" : "danger"} className="text-[10px]">
              {pool.isActive ? "activo" : "pausado"}
            </Badge>
          </div>
          {inRange !== null && (
            <Badge variant={inRange ? "success" : "warning"} className="text-[10px]">
              {inRange ? "En rango" : "Fuera de rango"}
            </Badge>
          )}
        </div>

        {/* Rango de precios */}
        <div className="rounded-lg bg-white/5 p-3 space-y-2">
          <p className="text-[10px] text-white/40 uppercase tracking-wide">Rango de liquidez (±15%)</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 text-center">
              <p className="text-xs text-white/40">Mínimo</p>
              <p className="text-sm font-semibold text-white">
                ${(pool.priceLowerCents / 100).toLocaleString("es-CO")}
              </p>
            </div>
            <div className="flex-1">
              {/* Barra de rango */}
              <div className="h-2 rounded-full bg-white/10 relative overflow-hidden">
                <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#9945ff] to-[#14f195] opacity-60" />
                {inRange && oraclePrice > 0 && (
                  <div
                    className="absolute top-0 h-full w-0.5 bg-white"
                    style={{
                      left: `${Math.round(
                        ((oraclePrice - pool.priceLowerCents) /
                        (pool.priceUpperCents - pool.priceLowerCents)) * 100
                      )}%`,
                    }}
                  />
                )}
              </div>
              <p className="text-[9px] text-white/20 text-center mt-0.5">precio actual</p>
            </div>
            <div className="flex-1 text-center">
              <p className="text-xs text-white/40">Máximo</p>
              <p className="text-sm font-semibold text-white">
                ${(pool.priceUpperCents / 100).toLocaleString("es-CO")}
              </p>
            </div>
          </div>
        </div>

        {/* Valor de la posición del usuario */}
        {userTokens > 0 && tokenValueCents > 0 && (
          <div className="rounded-lg bg-[#9945ff]/10 border border-[#9945ff]/20 p-3 flex justify-between items-center">
            <div>
              <p className="text-xs text-white/60">Tu posición</p>
              <p className="text-sm font-semibold text-[#c084fc]">
                {userTokens.toLocaleString()} tokens
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-white/40">Valor aprox.</p>
              <p className="text-sm font-semibold text-white">
                ${(tokenValueCents / 100).toLocaleString("es-CO")} USD
              </p>
            </div>
          </div>
        )}

        {/* Botón salir al pool */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
            onClick={() => window.open(orcaUrl, "_blank", "noopener,noreferrer")}
            disabled={!pool.isActive}
          >
            Vender en Orca
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 text-xs"
            onClick={() => window.open(orcaUrl, "_blank", "noopener,noreferrer")}
          >
            Ver pool
          </Button>
        </div>

        <p className="text-[10px] text-white/20 text-center">
          Salida en &lt; 30s · Fee 0.3% · Powered by Orca Whirlpools
        </p>
      </CardContent>
    </Card>
  );
}
