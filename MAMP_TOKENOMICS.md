# MAMP Token — Especificación de Tokenómica
## Mampostera Protocol Governance Token
**Versión:** 1.0 | **Estado:** Draft para revisión legal

---

## Resumen

MAMP es el token de gobernanza y captura de valor del protocolo Mampostera.
NO es un token de seguridad ni un instrumento de inversión — es un token de
utilidad que habilita la participación en la gobernanza del protocolo y el
acceso a funciones premium.

**Network:** Solana · **Standard:** SPL Token · **Decimals:** 6

---

## Distribución del Supply

**Supply total máximo:** 100,000,000 MAMP (100M)

| Asignación | % | MAMP | Vesting |
|---|---|---|---|
| Comunidad y early investors | 35% | 35,000,000 | 4 años, cliff 1 año |
| Equipo fundador | 20% | 20,000,000 | 4 años, cliff 1 año |
| Ecosistema y partnerships | 15% | 15,000,000 | 3 años lineal |
| Reserva del protocolo | 15% | 15,000,000 | Gobernanza DAO |
| Liquidity mining rewards | 10% | 10,000,000 | 2 años, emitido semanalmente |
| Advisors y legal | 5%  | 5,000,000  | 2 años, cliff 6 meses |

---

## Mecanismos de Emisión

### Liquidity Mining (10M MAMP en 2 años)
Los inversores que proveen liquidez al CLMM de Orca (TOKEN_RWA/USDC)
reciben MAMP como recompensa adicional. Tasa de emisión: decreciente
semanalmente (50% reducción cada 6 meses).

### Early Investor Rewards (parte de los 35M comunitarios)
Los primeros 1,000 inversores en cada propiedad reciben un bonus en MAMP:
- Inversor 1-100: 500 MAMP/propiedad
- Inversor 101-500: 200 MAMP/propiedad
- Inversor 501-1000: 50 MAMP/propiedad

---

## Ve-Tokenomics (Vote-Escrowed MAMP)

Inspirado en Curve Finance veCRV, adaptado para RWA.

### Cómo funciona
1. El holder bloquea MAMP por un período (máx 4 años)
2. Recibe veMAMP proporcional: 1 MAMP × 4 años = 4 veMAMP
3. veMAMP decae linealmente con el tiempo restante de bloqueo
4. veMAMP no es transferible — solo del holder original

### Beneficios de veMAMP

**Fee revenue sharing (20% de todos los fees del protocolo):**
- 0.5% de cada trade P2P → 20% va al pool de veMAMP holders
- 1% TransferFee de dNFT → 20% va al pool de veMAMP holders
- Repartido proporcionalmente al veMAMP de cada holder semanalmente
- Pagado en USDC (no en tokens inflacionarios)

**Boost de liquidity mining:**
- Los LPs con veMAMP reciben hasta 2.5× más recompensas en el CLMM
- Incentiva a los holders de MAMP a ser también proveedores de liquidez

**Gobernanza:**
- 1 veMAMP = 1 voto en propuestas del protocolo
- Propuestas: asignar liquidez a nuevas propiedades, cambiar fee parameters,
  aprobar expansión a nuevas ciudades, actualizar parámetros de LTV

---

## Flujos de Fee del Protocolo

### Distribución actual (sin MAMP)
```
Fee de mercado (0.5%): 100% → Protocol Treasury
TransferFee (1%):      80% → Protocol Treasury, 20% → Rent Vault
Liquidation bonus (5%): → Liquidador externo
```

### Distribución con MAMP
```
Fee de mercado (0.5%):
  → 60% Protocol Treasury (operaciones, desarrollo)
  → 20% veMAMP holders    (revenue sharing)
  → 20% Liquidity Reserve (para CLMM pools)

TransferFee (1%):
  → 60% Rent Vault de la propiedad (a los inversores)
  → 20% veMAMP holders
  → 20% Protocol Treasury

Liquidation penalty (5%):
  → 4% Liquidador externo (incentivo)
  → 1% veMAMP holders
```

---

## Hoja de Ruta de Emisión

**Q2 2026 — Testnet:**
- Sin emisión pública de MAMP todavía
- Whitelist para early investors (OTC, sin liquidez pública)

**Q3 2026 — Mainnet beta:**
- Inicio de liquidity mining (primeros 10M de 10M presupuestados)
- Early investor rewards activados
- Sin DEX pública todavía (prevenir especulación prematura)

**Q4 2026 — Expansión LATAM:**
- Lanzamiento DEX pública (par MAMP/USDC en Orca)
- Activación de ve-tokenomics
- Primera distribución de fee revenue a veMAMP holders

**2027 — Protocolo maduro:**
- Gobernanza completamente on-chain via veMAMP
- MAMP listado en exchanges centralizados tier-2

---

## Consideraciones Regulatorias Colombia

MAMP está diseñado para no clasificar como valor bajo la Ley 964 de 2005:
- No representa participación en utilidades de ninguna empresa específica
- No otorga derechos sobre activos subyacentes
- Su valor depende del uso del protocolo, no de esfuerzos de terceros
- Es un token de utilidad pura: gobernanza + fee discount + boost

**Recomendación:** Consultar con la Superintendencia Financiera antes del
lanzamiento público para obtener una no-action letter o concepto formal.
La SFC ha mostrado apertura a modelos de utility tokens en DeFi (Circular 029).

---

*Mampostera Technologies S.A.S. · Bogotá, Colombia · 2026*
*Este documento es un borrador interno — no constituye una oferta de valores.*
