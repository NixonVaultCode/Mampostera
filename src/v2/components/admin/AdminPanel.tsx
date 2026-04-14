"use client";
/**
 * v2/components/admin/AdminPanel.tsx
 * Panel admin v2 con shadcn/ui + Zod. Llama a lib/program.ts sin modificarlo.
 * El AdminPanel.tsx de v1 sigue intacto.
 *
 * R8 Fase 3: sección de Proof of Reserve añadida al final del panel.
 */
import { useState, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button, Card, CardContent, Input, Badge, Skeleton } from "../ui";
import { useProperties } from "../../hooks/use-properties";
import { QueryKeys } from "../../hooks/use-properties";
import { useToastPush } from "../../store/app.store";
import { initializeProperty, toggleProperty } from "../../../lib/program";
import { getProvider, getProgram } from "../../../lib/program";
import { useConnection } from "@solana/wallet-adapter-react";
import { useRegisterPoR } from "../../hooks/use-proof-of-reserve";

// ── Validación Zod ────────────────────────────────────────────────────────────

const NewPropertySchema = z.object({
  location:       z.string().min(5, "Mínimo 5 caracteres").max(128),
  city:           z.string().min(2).max(64),
  country:        z.string().length(2, "Código ISO de 2 letras"),
  totalValueUSD:  z.number().positive("Debe ser positivo").max(100_000_000),
  totalTokens:    z.number().int().positive().max(1_000_000_000),
  legalDocHash:   z.string().length(64, "Debe ser SHA-256 (64 hex)").regex(/^[a-f0-9]+$/i),
  ipfsCid:        z.string().min(10, "CID IPFS requerido").max(64),
  apy:            z.number().min(0).max(100),
});

type NewPropertyForm = z.infer<typeof NewPropertySchema>;

// ── Componente ────────────────────────────────────────────────────────────────

export function AdminPanelV2() {
  const wallet         = useWallet();
  const { connection } = useConnection();
  const queryClient    = useQueryClient();
  const push           = useToastPush();

  const { data: properties = [], isLoading } = useProperties();

  const [form, setForm]     = useState<Partial<NewPropertyForm>>({ country: "CO", apy: 8.5 });
  const [errors, setErrors] = useState<Partial<Record<keyof NewPropertyForm, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  // ── SHA-256 del PDF ──────────────────────────────────────────────────────────
  async function handleFileHash(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf  = await file.arrayBuffer();
    const hash = await globalThis.crypto.subtle.digest("SHA-256", buf);
    const hex  = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
    setForm((f) => ({ ...f, legalDocHash: hex }));
    push("Hash SHA-256 calculado automáticamente", "success");
  }

  // ── Crear propiedad ──────────────────────────────────────────────────────────
  async function handleCreate() {
    const result = NewPropertySchema.safeParse(form);
    if (!result.success) {
      const errs: typeof errors = {};
      result.error.errors.forEach((e) => { if (e.path[0]) errs[e.path[0] as keyof NewPropertyForm] = e.message; });
      setErrors(errs);
      return;
    }

    if (!wallet.publicKey) { push("Conecta la wallet authority", "error"); return; }

    setSubmitting(true);
    try {
      const program = getProgram(getProvider(wallet, connection));
      await initializeProperty(program, wallet, {
        location:        `${result.data.location}, ${result.data.city}, ${result.data.country}`,
        totalValueCents: Math.round(result.data.totalValueUSD * 100),
        totalTokens:     result.data.totalTokens,
        legalDocHash:    result.data.legalDocHash,
        ipfsCid:         result.data.ipfsCid,
      });
      push("Propiedad creada on-chain", "success");
      queryClient.invalidateQueries({ queryKey: QueryKeys.properties });
      setForm({ country: "CO", apy: 8.5 });
      setErrors({});
    } catch (err) {
      push(err instanceof Error ? err.message : "Error al crear propiedad", "error");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Toggle propiedad ─────────────────────────────────────────────────────────
  async function handleToggle(pubkey: string, current: boolean) {
    if (!wallet.publicKey) return;
    try {
      const program = getProgram(getProvider(wallet, connection));
      const { PublicKey } = await import("@solana/web3.js");
      await toggleProperty(program, wallet, new PublicKey(pubkey), !current);
      push(`Propiedad ${!current ? "activada" : "pausada"}`, "success");
      queryClient.invalidateQueries({ queryKey: QueryKeys.properties });
    } catch (err) {
      push(err instanceof Error ? err.message : "Error", "error");
    }
  }

  return (
    <div className="space-y-6">

      {/* Lista de propiedades */}
      <Card>
        <CardContent className="pt-4">
          <h3 className="text-sm font-semibold text-white mb-3">
            Propiedades on-chain ({properties.length})
          </h3>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : properties.length === 0 ? (
            <p className="text-sm text-white/30 text-center py-4">Sin propiedades aún</p>
          ) : (
            <div className="space-y-2">
              {properties.map((p) => (
                <div key={p.pubkey} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{p.location.split(",")[0]}</p>
                    <p className="text-xs text-white/40">{p.pubkey.slice(0, 8)}…</p>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <Badge variant={p.isActive ? "success" : "danger"}>
                      {p.isActive ? "activa" : "pausada"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggle(p.pubkey, p.isActive)}
                    >
                      {p.isActive ? "Pausar" : "Activar"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Formulario nueva propiedad */}
      <Card>
        <CardContent className="pt-4">
          <h3 className="text-sm font-semibold text-white mb-4">Nueva propiedad</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Dirección" error={errors.location}>
              <Input placeholder="Cra 7 #45-12" value={form.location ?? ""} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            </Field>
            <Field label="Ciudad" error={errors.city}>
              <Input placeholder="Bogotá" value={form.city ?? ""} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
            </Field>
            <Field label="Valor USD" error={errors.totalValueUSD}>
              <Input type="number" placeholder="120000" value={form.totalValueUSD ?? ""} onChange={(e) => setForm((f) => ({ ...f, totalValueUSD: Number(e.target.value) }))} />
            </Field>
            <Field label="Total tokens" error={errors.totalTokens}>
              <Input type="number" placeholder="1000000" value={form.totalTokens ?? ""} onChange={(e) => setForm((f) => ({ ...f, totalTokens: Number(e.target.value) }))} />
            </Field>
            <Field label="APY %" error={errors.apy}>
              <Input type="number" step="0.1" placeholder="8.5" value={form.apy ?? ""} onChange={(e) => setForm((f) => ({ ...f, apy: Number(e.target.value) }))} />
            </Field>
            <Field label="IPFS CID" error={errors.ipfsCid}>
              <Input placeholder="QmXxx..." value={form.ipfsCid ?? ""} onChange={(e) => setForm((f) => ({ ...f, ipfsCid: e.target.value }))} />
            </Field>
            <Field label="PDF escritura (SHA-256 auto)" error={errors.legalDocHash} className="md:col-span-2">
              <input type="file" accept=".pdf" onChange={handleFileHash} className="w-full text-sm text-white/50 file:mr-3 file:rounded-lg file:border-0 file:bg-[#9945ff]/20 file:px-3 file:py-1.5 file:text-xs file:text-[#c084fc] hover:file:bg-[#9945ff]/30" />
              {form.legalDocHash && (
                <p className="text-xs text-white/30 mt-1 font-mono truncate">{form.legalDocHash}</p>
              )}
            </Field>
          </div>
          <Button className="mt-4 w-full" onClick={handleCreate} loading={submitting}>
            Crear propiedad on-chain
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, error, children, className }: {
  label: string; error?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs text-white/50 mb-1.5">{label}</label>
      {children}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}

// ── Sección Proof of Reserve (R8) ─────────────────────────────────────────────

export function PoRRegistrationCard({ properties }: {
  properties: Array<{ pubkey: string; location: string }>;
}) {
  const { mutate: register, isPending } = useRegisterPoR();
  const fileRef  = useRef<HTMLInputElement>(null);

  const [selectedProp, setSelectedProp] = useState("");
  const [pdfFile,      setPdfFile]      = useState<File | null>(null);
  const [hashPreview,  setHashPreview]  = useState("");
  const [form, setForm] = useState({
    arweaveCid:   "",
    escrituraRef: "",
    matriculaRef: "",
    notariaRef:   "",
    sasNit:       "",
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFile(file);
    const buf  = await file.arrayBuffer();
    const hash = await globalThis.crypto.subtle.digest("SHA-256", buf);
    setHashPreview(Buffer.from(hash).toString("hex"));
  }

  function handleSubmit() {
    if (!pdfFile || !selectedProp) return;
    register({
      propertyId: selectedProp, certificateFile: pdfFile,
      arweaveCid: form.arweaveCid, escrituraRef: form.escrituraRef,
      matriculaRef: form.matriculaRef, notariaRef: form.notariaRef,
      sasNit: form.sasNit,
    });
  }

  const isReady = selectedProp && pdfFile && form.escrituraRef && form.matriculaRef && form.notariaRef && form.sasNit;

  return (
    <Card>
      <CardContent className="pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-white">Registrar Proof of Reserve</p>
          <Badge variant="info" className="text-[10px]">R8 — Fase 3</Badge>
        </div>

        <select
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
          value={selectedProp} onChange={e => setSelectedProp(e.target.value)}
        >
          <option value="">Seleccionar propiedad...</option>
          {properties.map(p => (
            <option key={p.pubkey} value={p.pubkey}>{p.location}</option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-3">
          {([
            { key: "escrituraRef" as const, label: "N° Escritura",           placeholder: "Escritura 4821/2026" },
            { key: "matriculaRef" as const, label: "Matrícula inmobiliaria", placeholder: "50C-1234567" },
            { key: "notariaRef"   as const, label: "Notaría",                placeholder: "Notaría 20 de Bogotá" },
            { key: "sasNit"       as const, label: "NIT S.A.S.",             placeholder: "901.234.567-8" },
          ]).map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="text-xs text-white/40 mb-1 block">{label}</label>
              <Input placeholder={placeholder} value={form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
        </div>

        <div>
          <label className="text-xs text-white/40 mb-1.5 block">CID Arweave (subir PDF antes)</label>
          <Input placeholder="ar://xxxxx..."
            value={form.arweaveCid}
            onChange={e => setForm(f => ({ ...f, arweaveCid: e.target.value }))} />
        </div>

        <div
          className="border border-dashed border-white/20 rounded-lg p-4 text-center cursor-pointer hover:border-[#9945ff]/40 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".pdf" className="sr-only" onChange={handleFileChange} />
          {pdfFile ? (
            <div className="space-y-1">
              <p className="text-sm text-white">{pdfFile.name}</p>
              <p className="text-[10px] text-white/30 font-mono break-all">
                SHA-256: {hashPreview.slice(0, 16)}…{hashPreview.slice(-8)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-white/40">Seleccionar certificado PDF</p>
          )}
        </div>

        <Button className="w-full" disabled={!isReady || isPending} loading={isPending} onClick={handleSubmit}>
          {isPending ? "Registrando on-chain..." : "Registrar Proof of Reserve"}
        </Button>
        <p className="text-[10px] text-white/20 text-center">
          El SHA-256 del PDF quedará permanentemente en la blockchain — verificable por cualquier inversor.
        </p>
      </CardContent>
    </Card>
  );
}
