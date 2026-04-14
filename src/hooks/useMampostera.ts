/**
 * hooks/useMampostera.ts — UNIFIED v0.4.0
 *
 * Fusión de:
 *   - hooks del ZIP (useToast, useProperties, usePortfolio, useBuyTokens,
 *     useClaimRent, useInitProperty, useToggleProperty, useSolBalance)
 *     → conectan con lib/program.ts (cliente Anchor real, testnet)
 *   - hook principal useMampostera (AppChain Fase 4)
 *     → lee PropertyState + Oracle + KYC + SmartAccount directamente del RPC
 *
 * Imports del ZIP usan lib/program.ts.
 * Imports de main usan RPC directo (sin IDL, compatible con devnet).
 */

// ─── Imports compartidos ──────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet, useConnection }                 from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL }              from "@solana/web3.js";
import { getAssociatedTokenAddress }                from "@solana/spl-token";

// ─── Imports de lib/program.ts (ZIP) ─────────────────────────────────────────
import {
  getProvider, getProgram,
  fetchAllProperties, fetchPortfolio,
  mintFractionalTokens as _mint,
  distributeRent       as _distribute,
  initializeProperty   as _init,
  toggleProperty       as _toggle,
  decodeAnchorError,
  PROGRAM_ID,
} from "../lib/program";

import type { PropertyUI, PortfolioPosition, NewPropertyForm } from "../types";

// ─── Imports de types propios (AppChain) ─────────────────────────────────────
import type { KycStatusUI } from "../types";

// =============================================================================
//  HOOKS DEL ZIP — conectados a lib/program.ts (Anchor client real)
// =============================================================================

// ── Toast ────────────────────────────────────────────────────────────────────
export type ToastType = "success" | "error" | "loading" | "info";
export interface Toast { msg: string; type: ToastType; id: number }

let toastId = 0;
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((msg: string, type: ToastType = "success", duration = 5000) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { msg, type, id }]);
    if (duration > 0) setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
    return id;
  }, []);

  const dismiss = useCallback((id: number) =>
    setToasts(prev => prev.filter(t => t.id !== id)), []);

  return { toasts, push, dismiss };
}

// ── Properties (on-chain via program.ts) ─────────────────────────────────────
export function useProperties() {
  const wallet         = useWallet();
  const { connection } = useConnection();
  const [properties, setProperties] = useState<PropertyUI[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      if (!wallet.publicKey) { setProperties([]); setLoading(false); return; }
      const provider = getProvider(wallet, connection);
      const program  = getProgram(provider);
      const props    = await fetchAllProperties(program);
      setProperties(props);
      setError(null);
    } catch (e: any) {
      setError(decodeAnchorError(e));
    } finally {
      setLoading(false);
    }
  }, [wallet, connection]);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 30_000);
    return () => clearInterval(intervalRef.current);
  }, [load]);

  return { properties, loading, error, reload: load };
}

// ── Portfolio ─────────────────────────────────────────────────────────────────
export function usePortfolio() {
  const wallet         = useWallet();
  const { connection } = useConnection();
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!wallet.publicKey || !wallet.connected) return;
    setLoading(true);
    try {
      const provider = getProvider(wallet, connection);
      const program  = getProgram(provider);
      const pos      = await fetchPortfolio(program, connection, wallet.publicKey);
      setPositions(pos);
      setError(null);
    } catch (e: any) {
      setError(decodeAnchorError(e));
    } finally { setLoading(false); }
  }, [wallet, connection]);

  useEffect(() => { load(); }, [load]);
  return { positions, loading, error, reload: load };
}

// ── Buy tokens ────────────────────────────────────────────────────────────────
export function useBuyTokens(push: (msg: string, type: ToastType, dur?: number) => number) {
  const wallet         = useWallet();
  const { connection } = useConnection();
  const [buying, setBuying] = useState(false);

  const buy = useCallback(async (property: PropertyUI, amount: number): Promise<boolean> => {
    if (!wallet.publicKey) { push("Conecta tu wallet primero", "error"); return false; }
    setBuying(true);
    push("Enviando transacción a Solana…", "loading", 0);
    try {
      const provider = getProvider(wallet, connection);
      const program  = getProgram(provider);
      const sig = await _mint(program, wallet, property, amount);
      push(`✅ ${amount.toLocaleString()} tokens comprados · ${sig.slice(0,8)}…`, "success");
      return true;
    } catch (e: any) {
      push(`❌ ${decodeAnchorError(e)}`, "error");
      return false;
    } finally { setBuying(false); }
  }, [wallet, connection, push]);

  return { buy, buying };
}

// ── Claim rent ────────────────────────────────────────────────────────────────
export function useClaimRent(push: (msg: string, type: ToastType, dur?: number) => number) {
  const wallet         = useWallet();
  const { connection } = useConnection();
  const [claiming, setClaiming] = useState(false);

  const claim = useCallback(async (property: PropertyUI): Promise<boolean> => {
    if (!wallet.publicKey) { push("Conecta tu wallet primero", "error"); return false; }
    setClaiming(true);
    push("Distribuyendo renta on-chain…", "loading", 0);
    try {
      const provider = getProvider(wallet, connection);
      const program  = getProgram(provider);
      const sig = await _distribute(program, wallet, property);
      push(`✅ Renta recibida · Tx ${sig.slice(0,8)}…`, "success");
      return true;
    } catch (e: any) {
      push(`❌ ${decodeAnchorError(e)}`, "error");
      return false;
    } finally { setClaiming(false); }
  }, [wallet, connection, push]);

  return { claim, claiming };
}

// ── Admin: init property ──────────────────────────────────────────────────────
export function useInitProperty(push: (msg: string, type: ToastType, dur?: number) => number) {
  const wallet         = useWallet();
  const { connection } = useConnection();
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async (form: NewPropertyForm): Promise<string | null> => {
    if (!wallet.publicKey) { push("Conecta tu wallet primero", "error"); return null; }
    setSubmitting(true);
    push("Inicializando propiedad on-chain…", "loading", 0);
    try {
      const provider = getProvider(wallet, connection);
      const program  = getProgram(provider);
      const sig = await _init(program, wallet, {
        location:        `${form.location}, ${form.city}, ${form.country}`,
        totalValueCents: Math.round(form.totalValueUSD * 100),
        totalTokens:     form.totalTokens,
        legalDocHash:    form.legalDocHash,
        ipfsCid:         form.ipfsCid,
      });
      push(`✅ Propiedad creada on-chain · Tx ${sig.slice(0,8)}…`, "success");
      return sig;
    } catch (e: any) {
      push(`❌ ${decodeAnchorError(e)}`, "error");
      return null;
    } finally { setSubmitting(false); }
  }, [wallet, connection, push]);

  return { submit, submitting };
}

// ── Admin: toggle property ────────────────────────────────────────────────────
export function useToggleProperty(push: (msg: string, type: ToastType, dur?: number) => number) {
  const wallet         = useWallet();
  const { connection } = useConnection();

  const toggle = useCallback(async (propertyPubkey: string, active: boolean): Promise<boolean> => {
    if (!wallet.publicKey) { push("Conecta tu wallet primero", "error"); return false; }
    try {
      const provider = getProvider(wallet, connection);
      const program  = getProgram(provider);
      await _toggle(program, wallet, new PublicKey(propertyPubkey), active);
      push(`✅ Propiedad ${active ? "activada" : "pausada"}`, "success");
      return true;
    } catch (e: any) {
      push(`❌ ${decodeAnchorError(e)}`, "error");
      return false;
    }
  }, [wallet, connection, push]);

  return { toggle };
}

// ── SOL balance (live subscription) ──────────────────────────────────────────
export function useSolBalance() {
  const { publicKey }  = useWallet();
  const { connection } = useConnection();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!publicKey) { setBalance(null); return; }
    const fetch = () => connection.getBalance(publicKey).then(b => setBalance(b / 1e9));
    fetch();
    const sub = connection.onAccountChange(publicKey, () => fetch());
    return () => { connection.removeAccountChangeListener(sub); };
  }, [publicKey, connection]);

  return balance;
}

// =============================================================================
//  HOOK PRINCIPAL — useMampostera (AppChain Fase 4)
//  Lee directamente del RPC sin IDL — compatible con devnet y testnet.
//  Usado por los componentes de Fase 3-4 (SmartAccount, Oracle, dNFT).
// =============================================================================

// ── PDA helpers ───────────────────────────────────────────────────────────────
export function derivePropertyPDA(authority: PublicKey, propertyId: number): PublicKey {
  const pidBytes = Buffer.alloc(8);
  pidBytes.writeBigUInt64LE(BigInt(propertyId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("property"), authority.toBuffer(), pidBytes],
    PROGRAM_ID
  )[0];
}
export function deriveKycPDA(investor: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("investor_kyc"), investor.toBuffer()],
    PROGRAM_ID
  )[0];
}
export function deriveOraclePDA(propertyState: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), propertyState.toBuffer()],
    PROGRAM_ID
  )[0];
}
export function deriveClaimPDA(investor: PublicKey, propertyState: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), investor.toBuffer(), propertyState.toBuffer()],
    PROGRAM_ID
  )[0];
}
export function deriveSmartAccountPDA(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("smart_account"), owner.toBuffer()],
    PROGRAM_ID
  )[0];
}

// ── KYC status (RPC directo) ──────────────────────────────────────────────────
export function useKycStatus(): KycStatusUI {
  const { publicKey }  = useWallet();
  const { connection } = useConnection();
  const [status, setStatus] = useState<KycStatusUI>({
    status: "unregistered", label: "Sin verificar", color: "var(--color-text-secondary)",
  });

  useEffect(() => {
    if (!publicKey) {
      setStatus({ status: "unregistered", label: "Sin registrar", color: "var(--color-text-secondary)" });
      return;
    }
    const kycPDA = deriveKycPDA(publicKey);
    connection.getAccountInfo(kycPDA).then(info => {
      if (!info) {
        setStatus({ status: "unregistered", label: "Sin registrar", color: "var(--color-text-secondary)" });
        return;
      }
      // byte 40 = status (0=Pending, 1=Approved, 2=Revoked)
      const s = info.data[40];
      const map: KycStatusUI[] = [
        { status: "pending",  label: "KYC pendiente", color: "var(--color-text-warning)" },
        { status: "approved", label: "KYC aprobado",  color: "var(--color-text-success)" },
        { status: "revoked",  label: "KYC revocado",  color: "var(--color-text-danger)"  },
      ];
      setStatus(map[s] ?? map[0]);
    }).catch(() => {
      setStatus({ status: "unregistered", label: "Sin registrar", color: "var(--color-text-secondary)" });
    });
  }, [publicKey, connection]);

  return status;
}

// ── Token balance por mint ─────────────────────────────────────────────────────
export function useTokenBalance(mintAddress: string | null): number {
  const { publicKey }  = useWallet();
  const { connection } = useConnection();
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    if (!publicKey || !mintAddress) { setBalance(0); return; }
    const mint = new PublicKey(mintAddress);
    getAssociatedTokenAddress(mint, publicKey)
      .then(ata => connection.getTokenAccountBalance(ata))
      .then(r   => setBalance(r.value.uiAmount ?? 0))
      .catch(()  => setBalance(0));
  }, [publicKey, mintAddress, connection]);

  return balance;
}

// ── Hook monolítico para AppChain (Fase 4) ────────────────────────────────────
export function useMampostera() {
  const { publicKey, connected, signTransaction, signAllTransactions } = useWallet();
  const { connection } = useConnection();

  const [solBalance, setSolBalance]  = useState(0);
  const [loading, setLoading]        = useState(false);
  const [error, setError]            = useState<string | null>(null);

  const loadBalance = useCallback(async () => {
    if (!publicKey) return;
    try {
      const b = await connection.getBalance(publicKey);
      setSolBalance(b / LAMPORTS_PER_SOL);
    } catch { /* silencioso */ }
  }, [publicKey, connection]);

  useEffect(() => {
    loadBalance();
    const id = setInterval(loadBalance, 30_000);
    return () => clearInterval(id);
  }, [loadBalance]);

  const getTokenBalance = useCallback(async (mintAddress: string): Promise<number> => {
    if (!publicKey) return 0;
    try {
      const mint = new PublicKey(mintAddress);
      const ata  = await getAssociatedTokenAddress(mint, publicKey);
      const info = await connection.getTokenAccountBalance(ata);
      return info.value.uiAmount ?? 0;
    } catch { return 0; }
  }, [publicKey, connection]);

  return {
    connected,
    publicKey,
    solBalance,
    loading,
    error,
    getTokenBalance,
    PROGRAM_ID,
    derivePropertyPDA,
    deriveKycPDA,
    deriveOraclePDA,
    deriveClaimPDA,
    deriveSmartAccountPDA,
  };
}
