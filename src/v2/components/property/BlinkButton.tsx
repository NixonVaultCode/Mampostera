"use client";
/**
 * v2/components/property/BlinkButton.tsx
 *
 * R7: Botón que copia el link de Solana Actions (blink) de una propiedad.
 * El link es compartible en Twitter/Discord/WhatsApp y permite invertir
 * directamente desde cualquier app compatible con Solana Actions.
 */
import { useState } from "react";
import { Button, Badge } from "../ui";
import type { PropertyUI } from "../../../types";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://mampostera.co";

interface BlinkButtonProps {
  property: PropertyUI;
  className?: string;
}

export function BlinkButton({ property, className }: BlinkButtonProps) {
  const [copied, setCopied] = useState(false);

  const blinkUrl = `${APP_URL}/api/actions/property/${property.pubkey}`;
  // Solana blinks se comparten con el prefijo https://dial.to/?action=solana-action:
  const shareUrl = `https://dial.to/?action=solana-action:${encodeURIComponent(blinkUrl)}`;

  async function handleCopy() {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      onClick={handleCopy}
      title="Copiar link de inversión compartible"
    >
      {copied ? (
        <span className="text-[#14f195] text-xs">¡Copiado!</span>
      ) : (
        <span className="text-xs">Compartir</span>
      )}
    </Button>
  );
}
