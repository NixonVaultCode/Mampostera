# 🏗️ MAMPOSTERA — PropTech AppChain Soberana en Solana

> Inversión fraccionada en propiedades colombianas tokenizadas — Hackathon Solana 2026 🇨🇴

[![CI](https://github.com/NixonVaultCode/mampostera/actions/workflows/ci.yml/badge.svg)](https://github.com/NixonVaultCode/mampostera/actions)
[![Solana](https://img.shields.io/badge/Solana-Devnet%2FTestnet-9945ff?logo=solana)](https://explorer.solana.com)
[![Anchor](https://img.shields.io/badge/Anchor-0.30.1-14f195)](https://anchor-lang.com)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![Civic](https://img.shields.io/badge/KYC-Civic_Pass-blue)](https://civic.com)
[![Token-2022](https://img.shields.io/badge/Token--2022-TransferFee%2BZK-green)](https://spl.solana.com/token-2022)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## 📁 Estructura del Proyecto

```
mampostera/
├── programs/mampostera/src/
│   ├── lib.rs              ← 32 instrucciones — programa Anchor principal
│   ├── errors.rs           ← 66 errores tipados centralizados
│   ├── kyc.rs              ← Fase 2a: KYC on-chain (InvestorProfile PDA)
│   ├── market.rs           ← Fase 2b: Mercado P2P con escrow atómico
│   ├── governance.rs       ← Fase 3a: DAO + presupuesto mantenimiento
│   ├── oracle.rs           ← Fase 3b: Oracle notarial de valuación
│   └── appchain.rs         ← Fase 4: dNFT Token-2022 · Hyperlane · ZK · Loans
│
├── tests/
│   ├── mampostera.ts       ← 23 tests — Fase 1 (Core SPL)
│   ├── kyc.test.ts         ← 16 tests — Fase 2a (KYC)
│   ├── market.test.ts      ← 11 tests — Fase 2b (Mercado)
│   ├── governance.test.ts  ← 15 tests — Fase 3 (DAO)
│   └── appchain.test.ts    ← 18 tests — Fase 4 (AppChain)
│
├── scripts/
│   ├── deploy.ts           ← Deploy devnet con pre-flight
│   ├── init-property.ts    ← CLI: inicializar propiedad (con PDF hash)
│   └── deposit-rent.ts     ← CLI: depositar renta al vault
│
├── frontend/
│   ├── src/app/
│   │   ├── layout.tsx      ← Next.js root layout
│   │   └── page.tsx        ← App principal v3 (todos los módulos)
│   ├── src/lib/program.ts  ← Cliente Anchor real (sin mocks)
│   ├── src/hooks/useMampostera.ts  ← Hooks unificados on-chain
│   ├── src/types/index.ts  ← TypeScript types
│   ├── src/components/
│   │   ├── kyc/CivicKYC.tsx          ← KYC Civic Pass on-chain
│   │   ├── admin/AdminPanel.tsx       ← Panel admin propiedades
│   │   ├── dashboard/AnalyticsDashboard.tsx ← TVL, APY, analytics
│   │   ├── governance/GovernanceVoting.tsx  ← Votación DAO off-chain
│   │   └── vault/VaultDeposit.tsx    ← Vault periférico MAMP
│   ├── next.config.js      ← Webpack polyfills Solana
│   ├── package.json        ← Deps frontend
│   └── tsconfig.json
│
├── docs/
│   ├── DEPLOY_TESTNET.md   ← Guía completa de despliegue testnet
│   ├── LEGAL_TECH.md       ← Marco legal SAS + vinculación token
│   └── PERIPHERAL_MODULES.md ← Roadmap módulos periféricos
│
├── whitepaper/
│   ├── WHITEPAPER.md       ← Arquitectura ZK-AppChain completa
│   └── LEGAL_TERMS.md      ← T&C marketplace P2P (Cláusula 7)
│
├── .env.example            ← Variables de entorno (Civic, testnet, program ID)
├── Anchor.toml             ← Config localnet + devnet + testnet
├── Cargo.toml              ← Workspace Rust (lto=fat, codegen-units=1)
├── package.json            ← Scripts: test · deploy:devnet · deploy:testnet · idl
└── .github/workflows/ci.yml ← CI: audit → test → build → deploy (5 jobs)
```

---

## 🚀 Despliegue Rápido

### Prerrequisitos
```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Solana CLI 1.18.16
sh -c "$(curl -sSfL https://release.solana.com/v1.18.16/install)"

# Anchor 0.30.1
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 0.30.1 && avm use 0.30.1

# Node 20 + Yarn
node --version  # v20.x
npm install -g yarn
```

### Paso 1 — Wallet y red
```bash
solana-keygen new --outfile ~/.config/solana/id.json
solana config set --url devnet   # o testnet
solana airdrop 4
```

### Paso 2 — Build y tests
```bash
yarn install
anchor build
anchor test           # 83 tests (5 suites)
```

### Paso 3 — Deploy
```bash
yarn deploy:devnet    # → devnet (scripts/deploy.ts con pre-flight)
yarn deploy:testnet   # → testnet (anchor deploy directo)
```

### Paso 4 — IDL y scripts
```bash
yarn idl              # publica IDL en testnet
yarn init:property    # inicializa primera propiedad on-chain
yarn deposit:rent     # deposita renta al vault
```

### Paso 5 — Frontend
```bash
cd frontend
yarn install
cp ../.env.example .env.local
# editar .env.local con NEXT_PUBLIC_PROGRAM_ID real
yarn dev              # → http://localhost:3000
```

---

## 📋 Variables de Entorno

```bash
# frontend/.env.local (copiar de .env.example)
NEXT_PUBLIC_SOLANA_NETWORK=testnet
NEXT_PUBLIC_RPC_ENDPOINT=https://api.testnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=<output de anchor deploy>
NEXT_PUBLIC_AUTHORITY_PUBKEY=<tu wallet pubkey>
NEXT_PUBLIC_CIVIC_GATEKEEPER=ignREusXmGrscGNUesoU9mxfds9AiYTezUKex2PsZV6
```

---

## ⚡ Instrucciones del Programa (32 total)

| # | Instrucción | Fase | CU est. |
|---|---|---|---|
| 1 | `initialize_property` | 1 | 80K |
| 2 | `mint_fractional_tokens` | 1 | 90K |
| 3 | `deposit_rent` | 1 | 60K |
| 4 | `start_distribution` | 1 | 50K |
| 5 | `claim_rent` | 1 | 80K |
| 6 | `end_distribution` | 1 | 40K |
| 7 | `toggle_property` | 1 | 30K |
| 8 | `initialize_program_config` | 2 | 50K |
| 9 | `register_investor` | 2 | 60K |
| 10 | `approve_investor` | 2 | 50K |
| 11 | `revoke_investor` | 2 | 50K |
| 12 | `create_offer` | 2 | 100K |
| 13 | `accept_offer` | 2 | 120K |
| 14 | `cancel_offer` | 2 | 80K |
| 15 | `create_proposal` | 3 | 80K |
| 16 | `cast_vote` | 3 | 70K |
| 17 | `finalize_proposal` | 3 | 60K |
| 18 | `initialize_oracle` | 3 | 60K |
| 19 | `update_valuation` | 3 | 70K |
| 20 | `read_valuation` | 3 | 30K |
| 21 | `initialize_dnft_atomic` | 4 | **250K** |
| 22 | `process_cross_chain_buy` | 4 | **350K** |
| 23 | `liquidate_collateral` | 4 | 120K |
| 24 | `zk_transfer_hook` | 4 | **1.4M** |
| 25 | `update_notarial_metadata` | 4 | 80K |
| 26 | `initiate_loan` | 4 | 100K |
| 27 | `repay_loan` | 4 | 90K |
| 28 | `initialize_smart_account` | 4 | 60K |
| 29 | `paymaster_sponsor_fee` | 4 | 40K |
| 30 | `collect_transfer_fees_to_treasury` | 4 | 80K |
| 31 | `create_maintenance_budget_proposal` | 3+ | 80K |
| 32 | `execute_maintenance_budget` | 3+ | 90K |

---

## 🔐 Seguridad

| Vulnerabilidad | Fix aplicado |
|---|---|
| Overflow aritmético | `checked_*().ok_or(err)?` — sin `unwrap()` |
| Re-entrancy distribución | `InvestorClaim` PDA + `distribution_epoch` |
| Seeds con String variable | `property_id: u64` como seed fijo |
| Vault bump no almacenado | `vault_bump` en `PropertyState` |
| ISM stub Hyperlane | CPI real con discriminador Anchor |
| Race condition ZK cache | `is_being_written` spinlock |
| CU insuficiente ZK | `ComputeBudgetInstruction(1_400_000)` |
| dNFT sin extensiones | `initialize_dnft_atomic` — 5 CPIs atómicos |
| Liquidación sin condición | `LiquidationConditionNotMet` (LTV + deadline) |
| Replay attack cross-chain | `CrossChainNonce` PDA único por `message_id` |

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología |
|------|------------|
| Blockchain | Solana (Devnet → Testnet → Mainnet-Beta) |
| Smart contract | Anchor 0.30.1 · Rust 2021 |
| Token standard | SPL Token + Token-2022 (TransferFee + ConfidentialTransfer) |
| Cross-chain | Hyperlane ISM (3/5 multisig) + Circle CCTP |
| ZK | Light Protocol (Groth16) |
| KYC | Civic Pass on-chain |
| Metadata permanente | Arweave + IPFS |
| Frontend | Next.js 14 · TypeScript · wallet-adapter |
| RPC | Helius (producción) |
| CI/CD | GitHub Actions (5 jobs) + Vercel |

---

## 🏛️ Marco Legal (Colombia)

Cada propiedad se incorpora en una **S.A.S.** (Ley 1258/2008). El `NotarialRecord` PDA almacena el hash SHA-256 de la escritura pública — evidencia digital válida bajo **Ley 527/1999**. Ver [`whitepaper/LEGAL_TERMS.md`](whitepaper/LEGAL_TERMS.md) y [`docs/LEGAL_TECH.md`](docs/LEGAL_TECH.md).

---

*Mampostera Technologies S.A.S. · Bogotá, Colombia · Hackathon Solana 2026*
