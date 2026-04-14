"use client";
/**
 * v2/components/payments/OnrampButton.tsx
 * Botón que abre el OnrampModal. Usado en el nav y en PropertyCard.
 */
import { useState }         from "react";
import { Button }           from "../ui";
import { OnrampModal }      from "./OnrampModal";
import type { PropertyUI }  from "../../../types";

interface OnrampButtonProps {
  property?: PropertyUI;
  variant?:  "default" | "secondary" | "outline" | "ghost";
  size?:     "sm" | "md" | "lg";
  label?:    string;
  className?: string;
}

export function OnrampButton({
  property,
  variant = "secondary",
  size    = "md",
  label   = "Invertir con COP",
  className,
}: OnrampButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>

      <OnrampModal
        open={open}
        onClose={() => setOpen(false)}
        propertyId={property?.pubkey}
        propertyName={property?.location?.split(",")[0]}
      />
    </>
  );
}
