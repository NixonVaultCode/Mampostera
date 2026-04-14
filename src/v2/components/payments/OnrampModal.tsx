"use client";
/**
 * v2/components/payments/OnrampModal.tsx
 *
 * R5 + R14: Modal de on-ramp — flujo completo PSE/Nequi/Stripe.
 *
 * UX objetivo: usuario retail colombiano sin experiencia Web3.
 * - Elige cuánto invertir en pesos
 * - Elige cómo pagar (PSE es el default)
 * - Confirma → redirige al banco → tokens llegan automáticamente
 * Sin mencionar wallets, USDC, ni blockchain en la interfaz principal.
 */

import { useState }   from "react";
import {
  Dialog, DialogContent, DialogTitle,
  Button, Input, Badge,
} from "../ui";
import { useOnramp, type OnrampMethod, QUICK_AMOUNTS_COP } from "../../hooks/use-onramp";
import { useWallet } from "@solana/wallet-adapter-react";

// ── Métodos de pago disponibles ───────────────────────────────────────────────

const PAYMENT_METHODS: { id: OnrampMethod; label: string; sub: string; icon: string }[] = [
  { id: "PSE",                   label: "PSE",               sub: "Débito bancario directo",   icon: "B" },
  { id: "NEQUI",                 label: "Nequi",             sub: "Wallet Bancolombia",        icon: "N" },
  { id: "BANCOLOMBIA_TRANSFER",  label: "Bancolombia",       sub: "Transferencia bancaria",    icon: "B" },
  { id: "STRIPE",                label: "Tarjeta",           sub: "Débito / crédito internacional", icon: "C" },
];

// ── Componente ────────────────────────────────────────────────────────────────

interface OnrampModalProps {
  open:       boolean;
  onClose:    () => void;
  propertyId?: string;
  propertyName?: string;
}

export function OnrampModal({ open, onClose, propertyId, propertyName }: OnrampModalProps) {
  const { connected }   = useWallet();
  const { initiate, isPending, formatCOP, copToUsdc } = useOnramp();

  const [amount,  setAmount]  = useState(100_000);
  const [method,  setMethod]  = useState<OnrampMethod>("PSE");
  const [phone,   setPhone]   = useState("");
  const [email,   setEmail]   = useState("");
  const [step,    setStep]    = useState<"amount" | "method" | "confirm">("amount");

  const usdcAmount = copToUsdc(amount);

  function handleConfirm() {
    initiate({
      amountCOP:     amount,
      paymentMethod: method,
      propertyId,
      customerPhone: phone || undefined,
      customerEmail: email || undefined,
    });
    onClose();
  }

  function reset() {
    setStep("amount");
    setAmount(100_000);
    setMethod("PSE");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-sm">

        {/* Header */}
        <DialogTitle className="text-white">
          {step === "amount"  && "¿Cuánto quieres invertir?"}
          {step === "method"  && "¿Cómo quieres pagar?"}
          {step === "confirm" && "Confirmar inversión"}
        </DialogTitle>

        {propertyName && (
          <p className="text-xs text-white/40 -mt-2 mb-2">
            Propiedad: {propertyName}
          </p>
        )}

        {/* ─── Paso 1: Elegir monto ─────────────────────────── */}
        {step === "amount" && (
          <div className="space-y-4 mt-2">
            {/* Montos rápidos */}
            <div className="grid grid-cols-2 gap-2">
              {QUICK_AMOUNTS_COP.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => setAmount(value)}
                  className={[
                    "rounded-lg py-3 text-sm font-medium border transition-all",
                    amount === value
                      ? "border-[#9945ff] bg-[#9945ff]/20 text-[#c084fc]"
                      : "border-white/10 text-white/60 hover:border-white/30",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Monto personalizado */}
            <div>
              <label className="text-xs text-white/40 mb-1.5 block">
                Monto personalizado (COP)
              </label>
              <Input
                type="number"
                placeholder="Ej: 150000"
                value={amount === 50_000 || amount === 100_000 || amount === 200_000 || amount === 500_000
                  ? "" : String(amount)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0) setAmount(v);
                }}
              />
            </div>

            {/* Resumen */}
            <div className="rounded-lg bg-white/5 p-3 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-white/40">Inviertes</span>
                <span className="text-white font-semibold">{formatCOP(amount)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/40">Recibes aprox.</span>
                <span className="text-[#14f195] font-semibold">≈ {usdcAmount} USDC</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/40">Comisión</span>
                <span className="text-white/60">~1.5%</span>
              </div>
            </div>

            <Button
              className="w-full"
              disabled={amount < 10_000}
              onClick={() => setStep("method")}
            >
              Continuar
            </Button>
            <p className="text-[10px] text-white/20 text-center">
              Mínimo $10.000 COP
            </p>
          </div>
        )}

        {/* ─── Paso 2: Elegir método de pago ───────────────── */}
        {step === "method" && (
          <div className="space-y-3 mt-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className={[
                  "w-full flex items-center gap-3 rounded-lg p-3 border text-left transition-all",
                  method === m.id
                    ? "border-[#9945ff] bg-[#9945ff]/10"
                    : "border-white/10 hover:border-white/20",
                ].join(" ")}
              >
                {/* Ícono */}
                <div className={[
                  "w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0",
                  method === m.id ? "bg-[#9945ff] text-white" : "bg-white/10 text-white/60",
                ].join(" ")}>
                  {m.icon}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{m.label}</p>
                  <p className="text-xs text-white/40">{m.sub}</p>
                </div>
                {method === m.id && (
                  <span className="ml-auto text-[#14f195] text-lg">✓</span>
                )}
              </button>
            ))}

            {/* Teléfono para Nequi */}
            {method === "NEQUI" && (
              <div>
                <label className="text-xs text-white/40 mb-1 block">
                  Número Nequi (celular Colombia)
                </label>
                <Input
                  type="tel"
                  placeholder="+573001234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            )}

            {/* Email para recibo */}
            <div>
              <label className="text-xs text-white/40 mb-1 block">
                Email para recibo (opcional)
              </label>
              <Input
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setStep("amount")}>
                Volver
              </Button>
              <Button className="flex-1" onClick={() => setStep("confirm")}>
                Continuar
              </Button>
            </div>
          </div>
        )}

        {/* ─── Paso 3: Confirmar ────────────────────────────── */}
        {step === "confirm" && (
          <div className="space-y-4 mt-2">
            {/* Resumen final */}
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <div className="bg-white/5 px-4 py-3 border-b border-white/5">
                <p className="text-xs text-white/40 uppercase tracking-wide">Resumen</p>
              </div>
              <div className="px-4 py-3 space-y-2.5">
                {[
                  ["Monto",        formatCOP(amount)],
                  ["Método",       PAYMENT_METHODS.find(m => m.id === method)?.label ?? method],
                  ["Recibes",      `≈ ${usdcAmount} USDC`],
                  ["Comisión",     `≈ ${formatCOP(Math.round(amount * 0.015))}`],
                  ...(propertyName ? [["Propiedad", propertyName]] : []),
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-white/40">{k}</span>
                    <span className="text-white font-medium">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {!connected && (
              <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-xs text-yellow-400">
                Conecta tu wallet para recibir los tokens después del pago
              </div>
            )}

            <p className="text-[11px] text-white/30 text-center leading-relaxed">
              Serás redirigido a {method === "NEQUI" ? "Nequi" : method === "PSE" ? "tu banco" : "Stripe"}.
              Los tokens llegan automáticamente una vez confirmado el pago.
            </p>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep("method")}>
                Volver
              </Button>
              <Button
                className="flex-1"
                loading={isPending}
                onClick={handleConfirm}
              >
                Pagar ahora
              </Button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
