"use client";
/**
 * v2/components/property/ProofOfReserveBadge.tsx
 *
 * R8: Badge que muestra el estado del Proof of Reserve de una propiedad.
 * Se usa dentro de PropertyCard — ocupa poco espacio pero da confianza al inversor.
 *
 * Estados posibles:
 *   verified   — PoR válido y vigente (< 6 meses)
 *   expiring   — PoR válido pero próximo a expirar (> 4 meses)
 *   expired    — PoR vencido (> 6 meses)
 *   missing    — Sin PoR registrado (propiedad no verificada)
 *   loading    — Consultando on-chain
 */
import { useState }           from "react";
import { Badge }              from "../ui";
import { useProofOfReserve, useVerifyPoR } from "../../hooks/use-proof-of-reserve";

interface ProofOfReserveBadgeProps {
  propertyPubkey: string;
  showDetails?:   boolean;   // Expandir al hacer click
}

export function ProofOfReserveBadge({ propertyPubkey, showDetails = true }: ProofOfReserveBadgeProps) {
  const { data: por, isLoading } = useProofOfReserve(propertyPubkey);
  const { mutate: verify, data: verifyResult, isPending: verifying } = useVerifyPoR();
  const [expanded, setExpanded] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-white/30">
        <span className="h-1.5 w-1.5 rounded-full bg-white/20 animate-pulse" />
        verificando...
      </span>
    );
  }

  if (!por) {
    return (
      <Badge variant="warning" className="text-[10px] cursor-default" title="Sin Proof of Reserve — propiedad no verificada notarialmente">
        Sin PoR
      </Badge>
    );
  }

  const status = !por.isValid      ? "invalid"
               : por.isExpired     ? "expired"
               : por.ageMonths > 4 ? "expiring"
               : "verified";

  const config = {
    verified: { label: "PoR verificado",  variant: "success" as const, dot: "#14f195" },
    expiring: { label: "PoR por renovar", variant: "warning" as const, dot: "#EF9F27" },
    expired:  { label: "PoR vencido",     variant: "danger"  as const, dot: "#E24B4A" },
    invalid:  { label: "PoR inválido",    variant: "danger"  as const, dot: "#E24B4A" },
  }[status];

  async function handleFileVerify(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !por) return;
    setFileError(null);
    verify({ file, storedHash: por.certificateHash });
  }

  return (
    <div>
      <button
        onClick={() => showDetails && setExpanded(x => !x)}
        className="inline-flex items-center gap-1 cursor-pointer"
        title="Proof of Reserve — haz click para ver detalles"
      >
        <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: config.dot }} />
        <Badge variant={config.variant} className="text-[10px]">{config.label}</Badge>
      </button>

      {expanded && (
        <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-3 text-xs space-y-1.5">
          <Row label="Escritura"   value={por.escrituraRef} />
          <Row label="Matrícula"   value={por.matriculaRef} />
          <Row label="Notaría"     value={por.notariaRef} />
          <Row label="NIT S.A.S."  value={por.sasNit} />
          <Row label="Registrado"  value={por.registeredAt.toLocaleDateString("es-CO")} />
          <Row label="Renovaciones" value={String(por.renewalCount)} />

          {/* Link al certificado en Arweave */}
          {por.arweaveCid && (
            <div className="flex justify-between">
              <span className="text-white/40">Certificado</span>
              <a
                href={`https://arweave.net/${por.arweaveCid.replace("ar://", "")}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[#14f195] underline hover:no-underline"
              >
                Ver en Arweave
              </a>
            </div>
          )}

          {/* Verificador de PDF */}
          <div className="pt-1.5 border-t border-white/10">
            <p className="text-white/40 mb-1">Verificar PDF:</p>
            <label className="cursor-pointer">
              <input
                type="file" accept=".pdf" className="sr-only"
                onChange={handleFileVerify}
              />
              <span className={[
                "inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] border transition-colors",
                verifying
                  ? "border-white/10 text-white/30 cursor-wait"
                  : "border-white/20 text-white/60 hover:border-white/40 cursor-pointer",
              ].join(" ")}>
                {verifying ? "Verificando..." : "Subir PDF para verificar"}
              </span>
            </label>

            {verifyResult && (
              <div className={[
                "mt-1.5 rounded px-2 py-1.5 text-[10px]",
                verifyResult.hashMatch ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400",
              ].join(" ")}>
                {verifyResult.message}
              </div>
            )}
            {fileError && (
              <p className="mt-1 text-[10px] text-red-400">{fileError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-white/40 flex-shrink-0">{label}</span>
      <span className="text-white/80 text-right truncate">{value || "—"}</span>
    </div>
  );
}
