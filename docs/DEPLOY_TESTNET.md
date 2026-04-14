# 🚀 Guía de Despliegue en Testnet — Mampostera v3

## Nuevos módulos en v3

| Módulo | Archivo | Descripción |
|---|---|---|
| **On-chain client** | `lib/program.ts` | Reemplaza todos los mocks, lee/escribe en Testnet |
| **React hooks** | `hooks/useMampostera.ts` | `useProperties`, `usePortfolio`, `useBuyTokens`, `useClaimRent` |
| **Civic KYC** | `components/kyc/CivicKYC.tsx` | Gateway Token on-chain, verificación real |
| **Admin panel** | `components/admin/AdminPanel.tsx` | Listar propiedades, toggle, SHA-256 auto |
| **Analytics** | `components/dashboard/AnalyticsDashboard.tsx` | TVL, volumen, donut chart, sparklines |
| **Main page v3** | `page.tsx` | Orquesta todos los módulos |

---

## 1. Obtener SOL en Testnet

```bash
# Configurar red
solana config set --url testnet

# Verificar
solana config get
# RPC URL: https://api.testnet.solana.com ✓

# Airdrops (testnet permite más que devnet)
solana airdrop 5
solana airdrop 5  # puedes pedir varias veces
solana balance
```

---

## 2. Desplegar el programa Anchor en Testnet

```bash
cd mampostera/

# Compilar (genera el Program ID)
anchor build

# Obtener Program ID real
PROGRAM_ID=$(solana address -k target/deploy/mampostera-keypair.json)
echo "Program ID: $PROGRAM_ID"

# Actualizar lib.rs
sed -i "s/MAMPoSTERA11111111111111111111111111111111/$PROGRAM_ID/" programs/mampostera/src/lib.rs

# Actualizar Anchor.toml
sed -i "s/MAMPoSTERA11111111111111111111111111111111/$PROGRAM_ID/" Anchor.toml

# Rebuild con Program ID correcto
anchor build

# Desplegar en testnet
anchor deploy --provider.cluster testnet

# Verificar en explorer
echo "https://explorer.solana.com/address/$PROGRAM_ID?cluster=testnet"
```

---

## 3. Configurar frontend

```bash
cd frontend/

# Instalar dependencias (incluye @civic/solana-gateway-react)
yarn add @civic/solana-gateway-react
yarn install

# Configurar variables de entorno
cp ../.env.example .env.local
# Editar .env.local:
#   NEXT_PUBLIC_PROGRAM_ID=<TU_PROGRAM_ID>
#   NEXT_PUBLIC_AUTHORITY_PUBKEY=<TU_WALLET_PUBKEY>

# Correr en desarrollo
yarn dev
# → http://localhost:3000
```

---

## 4. Inicializar la primera propiedad

### Opción A: desde el Admin Panel (UI)
1. Abre http://localhost:3000
2. Conecta la wallet authority (la misma que usaste para `anchor deploy`)
3. Ve a la tab **Admin**
4. Click en **+ Nueva propiedad**
5. Sube el PDF de la LLC → hash calculado automáticamente
6. Pega el IPFS CID del documento
7. Click **Inicializar propiedad on-chain**

### Opción B: desde CLI con script

```typescript
// scripts/init-property.ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Mampostera;

  const mintKP = anchor.web3.Keypair.generate();
  const LOCATION = "Cra 7 #45-12, Bogota, Colombia";

  const [propertyPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("property"), provider.wallet.publicKey.toBuffer(), Buffer.from(LOCATION)],
    program.programId
  );

  const tx = await program.methods
    .initializeProperty({
      location: LOCATION,
      totalValue: new anchor.BN(12_000_000), // $120,000 USD
      totalTokens: new anchor.BN(1_000_000),
      legalDocHash: "a3f8e12d4b9c6071e5a2d8f3b4c9e0a7d2f5b8c1e4a7d0f3b6c9e2a5d8f1b4c7",
      ipfsCid: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
    })
    .accounts({
      propertyState: propertyPDA,
      propertyMint: mintKP.publicKey,
      authority: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([mintKP])
    .rpc();

  console.log("✅ Propiedad inicializada:", propertyPDA.toBase58());
  console.log("   Mint:", mintKP.publicKey.toBase58());
  console.log("   Tx:", tx);
}

main().catch(console.error);
```

```bash
# Correr script
ANCHOR_PROVIDER_URL=https://api.testnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node scripts/init-property.ts
```

---

## 5. Verificar KYC con Civic (Testnet)

```bash
# Instalar Civic gateway SDK
yarn add @civic/solana-gateway-react

# En el frontend, el componente CivicKYCPanel maneja todo automáticamente.
# Para testnet, usa la gatekeeper network:
# ignREusXmGrscGNUesoU9mxfds9AiYTezUKex2PsZV6
```

Flujo KYC:
1. Usuario conecta wallet → click "Iniciar verificación Civic"
2. Completa verificación en getpass.civic.com
3. Civic emite Gateway Token on-chain (~2 minutos)
4. `useCivicKYC` hook detecta el token automáticamente
5. Usuario puede invertir en propiedades

---

## 6. Variables de entorno completas

```bash
# .env.local
NEXT_PUBLIC_SOLANA_NETWORK=testnet
NEXT_PUBLIC_RPC_ENDPOINT=https://api.testnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=<OUTPUT_DE_anchor_deploy>
NEXT_PUBLIC_AUTHORITY_PUBKEY=<TU_WALLET_PUBKEY>
NEXT_PUBLIC_CIVIC_GATEKEEPER=ignREusXmGrscGNUesoU9mxfds9AiYTezUKex2PsZV6
```

---

## 7. Deploy en producción (Vercel)

```bash
# Instalar Vercel CLI
npm i -g vercel

# Desde la carpeta frontend/
vercel --prod

# Configurar env vars en Vercel dashboard:
# → Settings > Environment Variables
# Agregar todas las variables de .env.local
```

---

## Arquitectura de datos v3

```
Solana Testnet
    │
    ├── PropertyState PDA [property, authority, location]
    │       ├── authority: Pubkey
    │       ├── mint: Pubkey (SPL Token)
    │       ├── location: String
    │       ├── total_value: u64 (USD cents)
    │       ├── total_tokens: u64
    │       ├── tokens_issued: u64
    │       ├── collected_rent: u64 (lamports)
    │       ├── legal_doc_hash: String (SHA-256)
    │       ├── ipfs_cid: String
    │       └── is_active: bool
    │
    ├── RentVault PDA [rent_vault, property_state]
    │       └── Holds SOL rent deposits
    │
    ├── PropertyMint (SPL Token)
    │       └── ATA per investor wallet
    │
    └── Civic Gateway Token PDA [gateway, wallet, gatekeeper_network]
            └── KYC verification on-chain
```

---

*Mampostera v3 — Hackathon Solana 2025 · Built in Colombia 🇨🇴*
