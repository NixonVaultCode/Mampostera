/**
 * v2/components/ui/utils.ts
 * Utilidades para shadcn/ui — merge de clases Tailwind.
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
