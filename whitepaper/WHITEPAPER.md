# MAMPOSTERA — Whitepaper Técnico v1.0
## PropTech AppChain Soberana en Solana
### Superando PRYPCO y Binance P2P con ZK-RWA Infrastructure

**Versión:** 1.0.0 | **Fecha:** 2026-03 | **Estado:** Draft técnico

---

## RESUMEN EJECUTIVO

Mampostera es una AppChain soberana construida sobre el Solana Virtual Machine (SVM) que tokeniza bienes raíces reales en fracciones dinámicas (dNFTs) con soporte completo para pagos cross-chain, préstamos DeFi colateralizados, gobernanza on-chain y abstracción total de wallet para el usuario final.

**Diferenciadores frente a PRYPCO y Binance P2P:**

| Dimensión | PRYPCO | Binance P2P | Mampostera |
|---|---|---|---|
| Custody de activos | Centralizado | Centralizado | Programa Anchor (no-custodial) |
| KYC | Off-chain, base de datos | Off-chain | ZK-proof on-chain (Light Protocol) |
| Liquidez | Manual | Manual | AMM + préstamos DeFi colateralizados |
| Cross-chain | No | No | Hyperlane ISM (3/5 multisig) + Circle CCTP |
| Gobernanza | Ninguna | Ninguna | DAO on-chain por propiedad |
| Abstracción wallet | Parcial | Parcial | Total (WebAuthn P256 + Paymaster) |
| Privacidad | Ninguna | Ninguna | Confidential Transfer (Token-2022) |
| Metadata | Estática | No aplica | Dinámica — Oracle Notarial trimestral |

---

## PARTE 1: ARQUITECTURA POR FASES

### Fase 1 — Core RWA

Tokenización básica de propiedades en SPL Token. `PropertyState` PDA con semillas fijas (`property_id: u64` en lugar de `location: String` para evitar colisiones y vectores de ataque). Distribución de renta con `InvestorClaim` PDA y `distribution_epoch` como guardia anti re-entrancy. Aritmética 100% con `checked_*().ok_or(err)?` — cero `unwrap()`.

### Fase 2 — KYC + Mercado Secundario

**KYC on-chain:** `InvestorProfile` PDA con tres estados: `Pending → Approved → Revoked`. La función `require_kyc_approved()` se llama en `mint_fractional_tokens` — es imposible recibir tokens sin pasar KYC. La revocación incluye razón (cumplimiento OFAC/UIAF).

**Mercado P2P:** `Offer` PDA con escrow atómico. El swap SOL ↔ tokens ocurre en una sola transacción — no hay estado intermedio posible. Fee del 0.5% al `ProtocolTreasury`. Anti-frontrunning: el comprador debe tener KYC aprobado.

### Fase 3 — Gobernanza + Oracle Notarial

**DAO por propiedad:** `Proposal` PDA con `VoteRecord` anti double-vote (seeds `[voter, proposal]`). Peso de voto proporcional a tokens SPL poseídos. Quórum mínimo 10%. Supermayoría del 66% para vender la propiedad.

**Presupuesto de mantenimiento:** Propuestas con opciones fijas Aprobar/Rechazar. Si gana Aprobar, el pago sale directamente del `RentVault` PDA al contratista — decisión on-chain con consecuencias financieras reales.

**Oracle Notarial:** Actualización trimestral con circuit-breaker ±50%. `NotarialRecord` PDA almacena hash SHA-256 de la escritura pública — evidencia digital válida bajo Ley 527/1999.

### Fase 4 — AppChain Soberana

---

## PARTE 2: FASE 4 — APPCHAIN SOBERANA

### 2.1 dNFT Atómico — Token-2022 con 5 extensiones

`initialize_dnft_atomic` ejecuta 5 CPIs al Token-2022 program en una sola transacción atómica:

1. `initialize_transfer_fee_config` — 1% (100 bps) de regalía automática en cada transferencia secundaria. Sin cap absoluto. El `withdraw_authority` es el `ProtocolTreasury` PDA.
2. `initialize_confidential_transfer` — Cifra montos con ElGamal. `auto_approve = true` para simplificar onboarding en MVP.
3. `initialize_metadata_pointer` — Apunta al `DnftState` PDA. Cuando el Oracle Notarial actualiza el valor, los metadatos del NFT cambian sin re-mintear.
4. `initialize_transfer_hook` — Registra este programa como ejecutor del hook. Antes de cada transferencia, `zk_transfer_hook` verifica el ZK proof.
5. `initialize_mint2` — Finaliza el mint con `decimals = 0` (NFT) y `mint_authority = DnftState PDA`.

Si cualquier CPI falla, toda la transacción se revierte — el mint no puede quedar en estado inconsistente sin extensiones.

### 2.2 Cross-Chain — Hyperlane ISM CPI Real

Flujo desde Base (EVM) hasta Solana (SVM):

```
[Comprador en Base]
  → USDC.transfer(HyperlaneMailbox, amount)
  → Hyperlane emite mensaje con payload {buyer, property_id, token_amount, zk_proof}

[Hyperlane Relayer]
  → 3/5 validadores firman el mensaje (ISM Multisig)
  → Llama al Mailbox en Solana

[process_cross_chain_buy en Mampostera]
  1. CPI al ISM program con discriminador [117,87,82,166,102,68,109,225]
  2. Verifica 3/5 firmas → falla con HyperlaneVerificationFailed si no
  3. CrossChainNonce PDA (seeds: source_chain + message_id) → anti-replay
  4. verify_and_cache_zk_proof() → Light Protocol Groth16
  5. Verifica precio contra oracle (tolerancia 2%)
  6. token_2022::mint_to() → tokens al buyer en Solana
```

### 2.3 Liquidador Permisivo — DeFi RWA

Cualquier wallet puede liquidar una posición si se cumple una de dos condiciones:

- **Condición A:** LTV actual > 75% (el oracle cayó, la deuda es insostenible)
- **Condición B:** `now > loan.due_date` (préstamo vencido)

El liquidador paga `principal + interés_acumulado + 5% de penalización` en USDC y recibe el dNFT. El excedente va al `ProtocolTreasury`. Sin este mecanismo permisivo, los préstamos en mora se acumularían drenando el pool de liquidez.

Tasas de interés según LTV:
- LTV ≤ 40%: 4.5% anual
- LTV 40-55%: 7.2% anual
- LTV 55-60%: 9.8% anual
- LTV > 60%: rechazado (solo 60% máximo al iniciar)

### 2.4 ZK Transfer Hook — 1.4M CU con Cache Atómico

**El problema:** Una verificación Groth16 completa consume ~1.2M CU. Sin solicitar el budget explícitamente, la transacción falla en mainnet con `exceeded CU meter at BPF instruction`.

**La solución:**
```rust
// El cliente DEBE enviar esta ix ANTES del transfer_hook en la misma tx:
ComputeBudgetInstruction::set_compute_unit_limit(1_400_000)
```

**Cache atómico anti-race-condition:**

```rust
pub struct ZkVerificationRecord {
    pub is_being_written: bool,  // ← spinlock
    pub expires_at: i64,         // 24h TTL
    pub is_valid: bool,
}

// Antes de verificar:
record.is_being_written = true;
// ... verificación Groth16 (~1.2M CU) ...
record.is_valid = true;
record.is_being_written = false;  // liberar spinlock
```

Si dos transacciones entran simultáneamente, la segunda ve `is_being_written = true` y usa el cache anterior si es válido, o rechaza si no hay cache. Esto previene doble verificación y doble escritura.

### 2.5 SmartAccount P256 — Sin Seed Phrases

```
[Usuario final]
  → Crea cuenta con FaceID/TouchID (WebAuthn)
  → El dispositivo genera par de claves Ed25519/P256 en el Secure Enclave
  → La clave privada NUNCA sale del dispositivo
  → La clave pública P256 comprimida (33 bytes, prefijo 0x02/0x03) se registra on-chain

[SmartAccount PDA]
  → seeds = [b"smart_account", webauthn_pubkey_owner]
  → Almacena: webauthn_pubkey [u8; 33], nonce, rent_balance, fees_sponsored

[Paymaster]
  → El usuario firma instrucciones con biometría
  → El Paymaster PDA paga las fees en SOL
  → El costo se deduce de rent_balance (la renta ganada paga el gas)
  → Condición: rent_balance ≥ 5_000_000 lamports (0.005 SOL)
```

### 2.6 Protocol Treasury — Transfer Fees → Liquidez

```
Flujo de fees:
  Transferencia secundaria dNFT
    → Token-2022 retiene 1% automáticamente en el Mint
    → collect_transfer_fees_to_treasury() los recoge
    → 80% → liquidity_reserve (cubre descalces de préstamos)
    → 20% → operations_fund (desarrollo + auditorías)

Con $1M/mes de volumen secundario:
    → $10K/mes en fees totales
    → $8K/mes en reserva de liquidez
    → $2K/mes en operaciones
```

---

## PARTE 3: ARQUITECTURA DE PDAs

```
PropertyState PDA      [property, authority, property_id:u64]
RentVault PDA          [rent_vault, property_state]
InvestorClaim PDA      [claim, investor, property_state]
InvestorProfile PDA    [investor_kyc, investor]
ProgramConfig PDA      [program_config]
Offer PDA              [offer, seller, mint, slot:u64]
OfferEscrow PDA        [escrow, offer]
Proposal PDA           [proposal, property, epoch:u64]
VoteRecord PDA         [vote, voter, proposal]
MaintenanceBudget PDA  [maintenance, proposal]
PropertyOracle PDA     [oracle, property_state]
NotarialRecord PDA     [notarial, property, appraisal_count:u64]
DnftState PDA          [dnft_state, property_state]
LoanState PDA          [loan, borrower, dnft_mint]
LoanEscrow PDA         [loan_escrow, loan_state]
CrossChainNonce PDA    [xchain_nonce, source_chain:u32, message_id:[u8;32]]
ZkVerificationRecord   [zk_record, wallet]
SmartAccount PDA       [smart_account, owner]
Paymaster PDA          [paymaster]
ProtocolTreasury PDA   [protocol_treasury]
```

---

## PARTE 4: FIDEICOMISO LEGAL — VINCULACIÓN OFF-CHAIN / ON-CHAIN

### Legal Wrapper (Colombia)

Para que una liquidación digital sea ejecutable ante un juez colombiano:

1. **NotarialRecord PDA** almacena:
   - `doc_hash`: SHA-256 del avalúo comercial (PDF)
   - `ipfs_doc_cid`: CID del documento en IPFS (permanente)
   - `escritura_publica`: Número de escritura pública (ej: "Escritura 4821/2026 Notaría 12 Bogotá")
   - `recorded_at`: Timestamp Unix inmutable en Solana

2. **Evidencia digital** bajo Ley 527/1999:
   - El hash on-chain es verificable: cualquier juez puede comparar el PDF con el hash
   - La blockchain de Solana provee timestamp certificado, inmutable
   - La firma del notario (wallet autorizada) equivale a firma electrónica calificada

3. **Estructura S.A.S.** (Ley 1258/2008):
   - Una S.A.S. por propiedad — "MAMPOSTERA PROPIEDAD BOGOTA CR7 SAS"
   - Los tokens SPL representan participación económica en utilidades
   - El pacto de accionistas incluye cláusula de tokenización
   - La transferencia de tokens = transferencia de derechos económicos

4. **Ejecución en mora**:
   ```
   Juez recibe:
   ├── LoanState PDA (deuda, tasa, vencimiento) — exportado del RPC
   ├── NotarialRecord PDA (valor del colateral) — exportado del RPC
   ├── Hash del avalúo verificado contra IPFS
   └── Bloque Solana con timestamp de la liquidación
   → Ejecuta embargo sobre la S.A.S. propietaria del inmueble físico
   ```

---

## COMPARATIVO TÉCNICO FINAL

**PRYPCO** (Dubai): Tokens no transferibles P2P, sin mercado secundario, KYC centralizado, riesgo de base de datos comprometida, cero gobernanza on-chain.

**Binance P2P**: Libro de órdenes off-chain con custodia centralizada en Binance, riesgo de contraparte, sin RWA reales, sin gobernanza, sin cross-chain.

**Mampostera**: Custodia no-custodial mediante PDAs de Anchor. KYC verificable on-chain sin exponer datos personales (ZK-proofs). Mercado P2P atómico con escrow on-chain. Cross-chain nativo (Hyperlane + CCTP). Gobernanza DAO con consecuencias financieras reales. El código es la ley.

---

*Mampostera Technologies S.A.S. · Bogotá, Colombia · 2026*
