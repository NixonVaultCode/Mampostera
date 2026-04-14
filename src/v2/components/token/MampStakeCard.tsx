"use client";
/**
 * v2/components/token/MampStakeCard.tsx
 *
 * R10: Card para hacer staking de MAMP y visualizar la posición veMAMP.
 * Muestra: veMAMP actual, APY, fees pendientes, tiempo restante de lock.
 */
import { useState }                              from "react";
import { Card, CardContent, Badge, Button, Input } from "../ui";
import {
  useVeStake, useFeePool,
  calcVeMamp, formatMamp, daysUntilUnlock,
  LOCK_OPTIONS,
} from "../../hooks/use-mamp";
import { useWallet } from "@solana/wallet-adapter-react";

export function MampStakeCard() {
  const { connected }         = useWallet();
  const { data: stake }       = useVeStake();
  const { data: pool }        = useFeePool();
  const [mampInput, setMamp]  = useState(1000);
  const [lockIdx,   setLock]  = useState(3); // default 1 año

  const selectedLock = LOCK_OPTIONS[lockIdx];
  const previewVe    = calcVeMamp(mampInput, selectedLock.secs);

  if (!connected) {
    return (
      <Card>
        <CardContent className="pt-4 text-center py-8">
          <p className="text-sm text-white/40">Conecta tu wallet para ver tu posición MAMP</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">

      {/* Estado del pool global */}
      {pool && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total veMAMP",    value: formatMamp(pool.totalVeMamp) },
            { label: "APY estimado",    value: `${pool.estimatedApy}%` },
            { label: "Distribuido",     value: `$${pool.totalDistributed.toLocaleString()} USDC` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg bg-white/5 p-3 text-center">
              <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1">{label}</p>
              <p className="text-sm font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Posición activa */}
      {stake && stake.mampAmount > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-white">Tu posición veMAMP</p>
              <Badge variant={stake.isExpired ? "danger" : "success"} className="text-[10px]">
                {stake.isExpired ? "Expirado" : `${stake.daysRemaining}d restantes`}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-white/5 p-3">
                <p className="text-[10px] text-white/40 mb-1">MAMP bloqueado</p>
                <p className="text-base font-semibold text-white">{formatMamp(stake.mampAmount)}</p>
              </div>
              <div className="rounded-lg bg-[#9945ff]/10 p-3">
                <p className="text-[10px] text-white/40 mb-1">veMAMP actual</p>
                <p className="text-base font-semibold text-[#c084fc]">{formatMamp(stake.veMampCurrent)}</p>
              </div>
            </div>

            {/* Barra de decay */}
            <div>
              <div className="flex justify-between text-[10px] text-white/40 mb-1">
                <span>Decay del veMAMP</span>
                <span>{Math.round(stake.veMampCurrent / stake.veMampInitial * 100)}% restante</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#9945ff] to-[#c084fc] transition-all"
                  style={{ width: `${Math.round(stake.veMampCurrent / stake.veMampInitial * 100)}%` }}
                />
              </div>
            </div>

            {stake.pendingUsdc > 0 && (
              <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3 flex justify-between items-center">
                <div>
                  <p className="text-xs text-green-400">Fees pendientes de reclamar</p>
                  <p className="text-base font-semibold text-[#14f195]">${stake.pendingUsdc.toFixed(4)} USDC</p>
                </div>
                <Button variant="secondary" size="sm" className="text-xs">
                  Reclamar fees
                </Button>
              </div>
            )}

            {stake.isExpired && (
              <Button variant="outline" className="w-full text-sm">
                Desbloquear {formatMamp(stake.mampAmount)} MAMP
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Formulario de nuevo stake */}
      {(!stake || stake.mampAmount === 0) && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <p className="text-sm font-medium text-white">Bloquear MAMP</p>

            <div>
              <label className="text-xs text-white/40 mb-1.5 block">Cantidad de MAMP</label>
              <Input
                type="number" min="1"
                value={mampInput}
                onChange={e => setMamp(Math.max(1, Number(e.target.value)))}
              />
            </div>

            <div>
              <label className="text-xs text-white/40 mb-1.5 block">Período de bloqueo</label>
              <div className="grid grid-cols-3 gap-2">
                {LOCK_OPTIONS.map((opt, i) => (
                  <button
                    key={opt.label}
                    onClick={() => setLock(i)}
                    className={[
                      "rounded-lg py-2 text-xs border transition-all",
                      lockIdx === i
                        ? "border-[#9945ff] bg-[#9945ff]/20 text-[#c084fc]"
                        : "border-white/10 text-white/50 hover:border-white/20",
                    ].join(" ")}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="rounded-lg bg-white/5 p-3 space-y-1.5">
              {[
                ["MAMP a bloquear",    `${formatMamp(mampInput)} MAMP`],
                ["veMAMP que recibes", `${formatMamp(previewVe)} veMAMP`],
                ["Multiplicador",      `${(selectedLock.multiplier * 100).toFixed(0)}% del máximo`],
                ["APY estimado",       pool ? `≈ ${pool.estimatedApy}%` : "cargando..."],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-white/40">{k}</span>
                  <span className="text-white font-medium">{v}</span>
                </div>
              ))}
            </div>

            <Button className="w-full" disabled={mampInput <= 0}>
              Bloquear MAMP → recibir {formatMamp(previewVe)} veMAMP
            </Button>

            <p className="text-[10px] text-white/20 text-center leading-relaxed">
              El veMAMP no es transferible. Decae linealmente hasta llegar a 0 al final del período.
              Los fees del protocolo se distribuyen semanalmente en USDC.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
