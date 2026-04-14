# Mampostera v4 — Módulos Periféricos
## Gobernanza + Vault de Garantía

> Estos módulos son **100% periféricos**: no modifican `programs/mampostera/src/lib.rs`.
> Se integran como un segundo programa Anchor (`mampostera_vault`) y componentes React adicionales.

---

## Arquitectura

```
mampostera_complete/
├── programs/
│   ├── mampostera/          ← INTACTO — lib.rs original sin modificar
│   │   └── src/lib.rs
│   └── mampostera_vault/    ← NUEVO programa periférico
│       ├── Cargo.toml
│       └── src/lib.rs
└── frontend/
    └── components/
        ├── kyc/             ← INTACTO — CivicKYC.tsx original
        ├── governance/      ← NUEVO módulo de gobernanza
        │   └── GovernanceVoting.tsx
        └── vault/           ← NUEVO módulo de vault
            └── VaultDeposit.tsx
```

---

## 1. Programa: `mampostera_vault`

### Deploy

```bash
# Añadir al Cargo.toml raíz:
# members = ["programs/mampostera", "programs/mampostera_vault"]

# Añadir al Anchor.toml:
# [programs.localnet]
# mampostera_vault = "VAULTMAMP11111111111111111111111111111111111"

anchor build
anchor deploy --program-name mampostera_vault
```

### Instrucciones

| Instrucción | Prerequisito KYC | Prerequisito SAS | Descripción |
|---|---|---|---|
| `init_vault_config` | ❌ (solo admin) | ✅ legal_entity_hash | Configura el vault |
| `lock_tokens` | ✅ Civic activo | ✅ en VaultConfig | Bloquea MAMP, emite recibo |
| `unlock_tokens` | ✅ Civic activo | ✅ en VaultConfig | Reclama MAMP + interés |
| `set_vault_active` | ❌ (solo admin) | — | Pausa/activa el vault |

### PDAs

```typescript
// VaultConfig
const [vaultConfigPDA] = await PublicKey.findProgramAddress(
  [Buffer.from("vault_config"), adminPublicKey.toBuffer()],
  VAULT_PROGRAM_ID
);

// DepositReceipt (único por holder + timestamp)
const tsBytes = Buffer.alloc(8);
tsBytes.writeBigInt64LE(BigInt(lockedAtUnixTs), 0);
const [receiptPDA] = await PublicKey.findProgramAddress(
  [Buffer.from("receipt"), holderPublicKey.toBuffer(), tsBytes],
  VAULT_PROGRAM_ID
);
```

### Uso con Anchor SDK

```typescript
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { MamposteraVault } from "./idl/mampostera_vault"; // generado por anchor build
import IDL from "./idl/mampostera_vault.json";

const program = new Program<MamposteraVault>(IDL, VAULT_PROGRAM_ID, provider);

// 1. Inicializar vault (admin)
await program.methods
  .initVaultConfig({
    legalEntityHash: SHA256_DEL_ACTA_SAS,  // 64 chars hex
    annualYieldBps:  500,                   // 5% APY
  })
  .accounts({
    vaultConfig:   vaultConfigPDA,
    mampMint:      MAMP_MINT,
    admin:         wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

// 2. Bloquear tokens
await program.methods
  .lockTokens(new BN(amount), new BN(lockDurationSecs))
  .accounts({
    vaultConfig:          vaultConfigPDA,
    vaultEscrow:          vaultEscrowATA,       // ATA del vault para MAMP
    mampMint:             MAMP_MINT,
    holderTokenAccount:   holderATA,
    depositReceipt:       receiptPDA,
    civicGatewayToken:    civicGatewayPDA,      // derivado del holder
    holder:               wallet.publicKey,
    tokenProgram:         TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram:        SystemProgram.programId,
    rent:                 SYSVAR_RENT_PUBKEY,
  })
  .rpc();

// 3. Desbloquear tokens
await program.methods
  .unlockTokens()
  .accounts({
    vaultConfig:          vaultConfigPDA,
    vaultEscrow:          vaultEscrowATA,
    mampMint:             MAMP_MINT,
    depositReceipt:       receiptPDA,
    holderTokenAccount:   holderATA,
    civicGatewayToken:    civicGatewayPDA,
    holder:               wallet.publicKey,
    tokenProgram:         TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  })
  .rpc();
```

---

## 2. Componente: `GovernanceVoting`

### Uso básico

```tsx
import GovernanceVoting from "@/components/governance/GovernanceVoting";

// Con propuestas personalizadas
<GovernanceVoting
  proposals={[
    {
      id:           "prop-001",
      title:        "Aprobación de arrendamiento",
      description:  "...",
      propertyMint: "MAMPoSTERA11111111111111111111111111111111",
      endsAt:       new Date("2025-04-01"),
      quorumTokens: 1000,
      createdBy:    adminWallet.toBase58(),
    }
  ]}
  onVoteCast={async (vote) => {
    // Persistir en tu backend / IPFS / Tableland
    await fetch("/api/votes", {
      method: "POST",
      body:   JSON.stringify(vote),
    });
  }}
/>
```

### Flujo de votación

```
1. Holder abre GovernanceVoting
2. Componente verifica:
   a) KYC Civic activo → useCivicKYC().status === "verified"
   b) Balance tokens del mint de la propuesta > 0
3. Holder selecciona propuesta → elige YES / NO / ABSTAIN
4. Click "Confirmar y firmar" → wallet.signMessage(voteMessage)
5. Firma Ed25519 se almacena + callback onVoteCast

Verificación off-chain:
  - Reconstruir el mensaje con los mismos parámetros
  - nacl.sign.detached.verify(message, signature, voterPublicKey)
  - Confirmar balance en la snapshot del bloque del voto
```

---

## 3. Componente: `VaultDeposit`

### Uso básico

```tsx
import VaultDeposit from "@/components/vault/VaultDeposit";

// Montarlo en cualquier página — se auto-configura con las constantes del programa
<VaultDeposit />
```

### Variables de entorno requeridas

```env
# .env.local
NEXT_PUBLIC_VAULT_PROGRAM_ID=VAULTMAMP11111111111111111111111111111111111
NEXT_PUBLIC_MAMP_MINT=MAMPoSTERA11111111111111111111111111111111
NEXT_PUBLIC_VAULT_ADMIN=<tu-admin-pubkey>
```

---

## 4. Prerequisitos comunes

Ambos módulos comparten los mismos prerequisitos de Mampostera v4:

### KYC Civic
```typescript
// Derivar Civic gateway token PDA
const [gatewayPDA] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("gateway"),
    holderPublicKey.toBuffer(),
    CIVIC_GATEKEEPER_NETWORK.toBuffer(),
  ],
  new PublicKey("gatem74V238djXdzWnJf94Wo1DcnuGkfijbf3AuBhfs")
);
// byte[0] === 0 → ACTIVE
```

### SAS (Entidad Jurídica)
```typescript
// El hash SHA-256 del acta SAS se almacena en:
// - PropertyState.legal_doc_hash  (programa principal)
// - VaultConfig.legal_entity_hash (programa vault)
// Ambos requieren 64 caracteres hex (SHA-256)

import { createHash } from "crypto";
const hash = createHash("sha256")
  .update(sasDocumentBuffer)
  .digest("hex"); // → 64 chars
```

---

## 5. Tests

```bash
# Test del vault periférico
anchor test --skip-local-validator  # Asegúrate de tener solana-test-validator corriendo

# Ejecutar tests específicos
yarn ts-mocha tests/mampostera_vault.ts
```

Test básico de integración:

```typescript
// tests/mampostera_vault.ts
import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";

describe("mampostera_vault", () => {
  it("init_vault_config — rejects invalid SAS hash", async () => {
    try {
      await program.methods
        .initVaultConfig({ legalEntityHash: "invalid", annualYieldBps: 500 })
        .accounts({ ... })
        .rpc();
      assert.fail("Should have thrown");
    } catch (e) {
      assert.include(e.message, "InvalidLegalHash");
    }
  });

  it("lock_tokens — rejects without valid Civic KYC", async () => {
    // ... test con gateway token inválido
  });

  it("unlock_tokens — rejects before lock period ends", async () => {
    // ... test de lock period enforcement
  });
});
```

---

## 6. Seguridad

| Riesgo | Mitigación |
|---|---|
| Doble reclamo del recibo | `is_claimed` flag + PDA única |
| Votación sin tokens | Verificación on-chain del ATA balance |
| KYC expirado durante el lock | Re-verificación en `unlock_tokens` |
| Overflow en cálculo de interés | `checked_mul` / `checked_div` en Rust |
| Replay de firma de voto | Timestamp único + proposalId en el mensaje |
| Vault drenado | `require!(vault_escrow.amount >= total_payout)` |
