import type { Metadata } from "next";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Mampostera — Real Estate RWA on Solana",
  description: "Inversión fraccionada en propiedades colombianas tokenizadas en Solana.",
  icons: { icon: "/favicon.ico" },
  openGraph: { title: "Mampostera", description: "Real Estate RWA — Solana · Colombia 🇨🇴", type: "website" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
