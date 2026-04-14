/**
 * v2/store/app.store.ts
 * Zustand — estado global de la aplicación.
 * Reemplaza: useState(tab), useState(modal), useToast() distribuido.
 * El código v1 sigue usando sus propios useState; este store es para /v2.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { PropertyUI, PortfolioPosition } from "../../types";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type AppTab = "marketplace" | "portfolio" | "analytics" | "governance" | "admin";
export type ToastType = "success" | "error" | "loading" | "info";

export interface Toast {
  id:       string;
  msg:      string;
  type:     ToastType;
  duration: number;
}

export interface AppState {
  // ── UI ────────────────────────────────────────────────────────────────────
  activeTab:     AppTab;
  buyModalProp:  PropertyUI | null;
  sidebarOpen:   boolean;

  // ── Toasts ────────────────────────────────────────────────────────────────
  toasts: Toast[];

  // ── Cache local (React Query es la fuente, esto es optimista) ────────────
  selectedPropertyId: string | null;

  // ── Actions ──────────────────────────────────────────────────────────────
  setTab:            (tab: AppTab) => void;
  openBuyModal:      (prop: PropertyUI) => void;
  closeBuyModal:     () => void;
  toggleSidebar:     () => void;
  pushToast:         (msg: string, type?: ToastType, duration?: number) => string;
  dismissToast:      (id: string) => void;
  selectProperty:    (id: string | null) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

let _toastCounter = 0;

export const useAppStore = create<AppState>()(
  devtools(
    (set) => ({
      activeTab:          "marketplace",
      buyModalProp:       null,
      sidebarOpen:        false,
      toasts:             [],
      selectedPropertyId: null,

      setTab: (tab) => set({ activeTab: tab }, false, "setTab"),

      openBuyModal: (prop) => set({ buyModalProp: prop }, false, "openBuyModal"),

      closeBuyModal: () => set({ buyModalProp: null }, false, "closeBuyModal"),

      toggleSidebar: () =>
        set((s) => ({ sidebarOpen: !s.sidebarOpen }), false, "toggleSidebar"),

      pushToast: (msg, type = "success", duration = 5000) => {
        const id = `toast-${++_toastCounter}`;
        set(
          (s) => ({ toasts: [...s.toasts, { id, msg, type, duration }] }),
          false,
          "pushToast"
        );
        if (duration > 0) {
          setTimeout(() => {
            useAppStore.getState().dismissToast(id);
          }, duration);
        }
        return id;
      },

      dismissToast: (id) =>
        set(
          (s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }),
          false,
          "dismissToast"
        ),

      selectProperty: (id) =>
        set({ selectedPropertyId: id }, false, "selectProperty"),
    }),
    { name: "mampostera-store" }
  )
);

// ── Selectores tipados (evitan re-renders innecesarios) ───────────────────────

export const useActiveTab  = () => useAppStore((s) => s.activeTab);
export const useBuyModal   = () => useAppStore((s) => s.buyModalProp);
export const useToasts     = () => useAppStore((s) => s.toasts);
export const useToastPush  = () => useAppStore((s) => s.pushToast);
export const useToastDismiss = () => useAppStore((s) => s.dismissToast);
