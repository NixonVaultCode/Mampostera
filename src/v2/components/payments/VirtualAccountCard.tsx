"use client";
/**
 * v2/components/payments/VirtualAccountCard.tsx
 *
 * R13: Card para vincular cuenta Nequi/banco y recibir renta en COP.
 * La renta se convierte automáticamente cuando llega el evento RentClaimed.
 */
import { useState }            from "react";
import { Card, CardContent, Badge, Button, Input } from "../ui";
import { useVirtualAccount }   from "../../hooks/use-virtual-account";
import { useWallet }           from "@solana/wallet-adapter-react";

const SOL_TO_COP = 850_000; // Actualizar con API en producción

export function VirtualAccountCard() {
  const { connected }         = useWallet();
  const { link, unlink }      = useVirtualAccount();
  const [phone, setPhone]     = useState("");
  const [linked, setLinked]   = useState(false);
  const [linkedPhone, setLinkedPhone] = useState("");

  if (!connected) {
    return (
      <Card>
        <CardContent className="pt-4 text-center py-6">
          <p className="text-sm text-white/40">Conecta tu wallet para vincular tu cuenta</p>
        </CardContent>
      </Card>
    );
  }

  async function handleLink() {
    if (!phone.match(/^\+57\d{10}$/)) return;
    link.mutate(
      { phone },
      {
        onSuccess: () => {
          setLinked(true);
          setLinkedPhone(phone);
        },
      }
    );
  }

  return (
    <Card>
      <CardContent className="pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Cuenta virtual COP</p>
            <p className="text-xs text-white/40 mt-0.5">
              Recibe la renta automáticamente en pesos colombianos
            </p>
          </div>
          <Badge variant={linked ? "success" : "warning"} className="text-[10px]">
            {linked ? "Vinculada" : "Sin vincular"}
          </Badge>
        </div>

        {linked ? (
          /* Estado: cuenta vinculada */
          <div className="space-y-3">
            <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3">
              <p className="text-xs text-green-400 mb-1">Nequi vinculado</p>
              <p className="text-sm font-semibold text-white">{linkedPhone}</p>
              <p className="text-xs text-white/40 mt-1">
                La renta se convertirá a COP automáticamente al reclamar
              </p>
            </div>

            {/* Estimación */}
            <div className="rounded-lg bg-white/5 p-3 space-y-1.5">
              <p className="text-[10px] text-white/40 uppercase tracking-wide">
                Ejemplo de conversión
              </p>
              {[
                ["0.01 SOL de renta", `≈ $${(0.01 * SOL_TO_COP).toLocaleString("es-CO")} COP`],
                ["0.05 SOL de renta", `≈ $${(0.05 * SOL_TO_COP).toLocaleString("es-CO")} COP`],
                ["0.10 SOL de renta", `≈ $${(0.10 * SOL_TO_COP).toLocaleString("es-CO")} COP`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-white/40">{k}</span>
                  <span className="text-[#14f195] font-medium">{v}</span>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-white/20 text-center">
              Tasa actualizada · Powered by Bold + Bitso Colombia
            </p>

            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-white/40"
              loading={unlink.isPending}
              onClick={() => { unlink.mutate(); setLinked(false); setLinkedPhone(""); }}
            >
              Desvincular cuenta
            </Button>
          </div>
        ) : (
          /* Estado: sin vincular */
          <div className="space-y-3">
            <div>
              <label className="text-xs text-white/40 mb-1.5 block">
                Número Nequi (Colombia)
              </label>
              <Input
                type="tel"
                placeholder="+573001234567"
                value={phone}
                onChange={e => setPhone(e.target.value)}
              />
              {phone && !phone.match(/^\+57\d{10}$/) && (
                <p className="text-[10px] text-red-400 mt-1">
                  Formato: +57 seguido de 10 dígitos (ej: +573001234567)
                </p>
              )}
            </div>

            <div className="rounded-lg bg-white/5 p-3 text-xs text-white/40 space-y-1">
              <p className="font-medium text-white/60">¿Cómo funciona?</p>
              <p>1. Vinculas tu Nequi una sola vez</p>
              <p>2. Cuando reclamas renta, se convierte a COP automáticamente</p>
              <p>3. El dinero llega a tu Nequi en 2-5 minutos</p>
            </div>

            <Button
              className="w-full"
              disabled={!phone.match(/^\+57\d{10}$/) || link.isPending}
              loading={link.isPending}
              onClick={handleLink}
            >
              Vincular Nequi
            </Button>

            <p className="text-[10px] text-white/20 text-center">
              También disponible: transferencia bancaria PSE · Próximamente Bold Pay
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
