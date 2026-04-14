// =============================================================================
//  MAMPOSTERA — Errores centralizados v0.4.0
//  use crate::errors::MamposteError en todos los módulos
// =============================================================================

use anchor_lang::prelude::*;

#[error_code]
pub enum MamposteError {
    // ── Fase 1: Validación de parámetros ──────────────────────────────────
    #[msg("El valor de la propiedad está fuera del rango permitido ($100 - $100M USD)")]
    InvalidPropertyValue,
    #[msg("El suministro de tokens está fuera del rango permitido")]
    InvalidTokenSupply,
    #[msg("La ubicación no puede estar vacía ni superar 128 caracteres")]
    LocationTooLong,
    #[msg("El hash del documento debe ser un SHA-256 en hexadecimal (64 chars)")]
    InvalidDocHash,
    #[msg("El CID de IPFS debe tener entre 46 y 59 caracteres")]
    InvalidIpfsCid,

    // ── Fase 1: Seguridad aritmética ──────────────────────────────────────
    #[msg("Overflow aritmético detectado")]
    ArithmeticOverflow,

    // ── Fase 1: Control de acceso ─────────────────────────────────────────
    #[msg("No autorizado: la firma no corresponde a la authority")]
    Unauthorized,
    #[msg("El mint no corresponde a esta propiedad")]
    MintMismatch,

    // ── Fase 1: Estado de la propiedad ────────────────────────────────────
    #[msg("La propiedad está inactiva")]
    PropertyInactive,
    #[msg("El monto excede el suministro total de tokens")]
    ExceedsTokenSupply,
    #[msg("El monto mínimo de inversión es 1 token (1_000_000 con 6 decimales)")]
    BelowMinimumInvestment,

    // ── Fase 1: Distribución de renta ─────────────────────────────────────
    #[msg("No hay renta acumulada para distribuir")]
    NoRentToDistribute,
    #[msg("No se han emitido tokens aún")]
    NoTokensIssued,
    #[msg("El inversor no posee tokens de esta propiedad")]
    InvestorHasNoTokens,
    #[msg("La participación calculada es demasiado pequeña para transferir")]
    ShareTooSmall,
    #[msg("El depósito mínimo de renta es 0.001 SOL (1_000_000 lamports)")]
    RentDepositTooSmall,
    #[msg("Hay una distribución en progreso. Espere a que termine.")]
    RentDistributionInProgress,
    #[msg("No hay una distribución activa. Ejecute start_distribution primero.")]
    NoActiveDistribution,
    #[msg("Este inversor ya reclamó su renta en la época actual")]
    ClaimAlreadyProcessed,

    // ── Fase 2a: KYC ──────────────────────────────────────────────────────
    #[msg("El nombre del inversor no puede estar vacío ni superar 64 caracteres")]
    InvalidInvestorName,
    #[msg("La referencia de documento no puede superar 32 caracteres")]
    InvalidDocReference,
    #[msg("El código de país debe ser ISO 3166-1 alpha-2 en mayúsculas (ej: CO, US)")]
    InvalidCountryCode,
    #[msg("El inversor no está aprobado para operar en la plataforma")]
    InvestorNotApproved,
    #[msg("El inversor ya está aprobado")]
    InvestorAlreadyApproved,
    #[msg("La razón de revocación no puede superar 128 caracteres")]
    ReasonTooLong,

    // ── Fase 2b: Mercado secundario ───────────────────────────────────────
    #[msg("La cantidad mínima por oferta es 1 token completo (1_000_000 con 6 dec)")]
    OfferAmountTooSmall,
    #[msg("El precio por token debe ser mayor que cero")]
    OfferPriceTooLow,
    #[msg("Balance de tokens insuficiente para crear la oferta")]
    InsufficientTokenBalance,
    #[msg("La duración de la oferta debe ser entre 1 y 1_512_000 slots (~7 días)")]
    InvalidOfferExpiry,
    #[msg("La oferta no está activa")]
    OfferNotActive,
    #[msg("La oferta ha expirado")]
    OfferExpired,
    #[msg("El comprador no puede ser el mismo vendedor")]
    BuyerIsSeller,

    // ── Fase 3a: Gobernanza ───────────────────────────────────────────────
    #[msg("El título de la propuesta no puede estar vacío ni superar 64 caracteres")]
    InvalidProposalTitle,
    #[msg("La descripción no puede superar 256 caracteres")]
    InvalidProposalDescription,
    #[msg("Se requieren entre 2 y 4 opciones de respuesta")]
    InvalidProposalOptions,
    #[msg("La duración de votación debe ser entre 1 hora y 30 días")]
    InvalidVotingDuration,
    #[msg("La propuesta no está activa")]
    ProposalNotActive,
    #[msg("El período de votación ha terminado")]
    VotingPeriodEnded,
    #[msg("El período de votación aún no ha terminado")]
    VotingPeriodNotEnded,
    #[msg("Opción de voto inválida")]
    InvalidVoteOption,

    // ── Fase 3b: Oracle ───────────────────────────────────────────────────
    #[msg("El valor del oracle está fuera del rango permitido ($1K - $500M USD)")]
    InvalidOracleValue,
    #[msg("Debes esperar al menos 24 horas entre actualizaciones del oracle")]
    OracleUpdateTooFrequent,
    #[msg("El cambio de precio supera el límite del 50% por actualización")]
    OracleValueChangeTooBig,

    // ── Fase 4: AppChain / Cross-chain ────────────────────────────────────
    #[msg("Verificación del ISM de Hyperlane fallida — mensaje no validado por 3/5 validadores")]
    HyperlaneVerificationFailed,
    #[msg("Replay attack detectado: este mensaje cross-chain ya fue procesado")]
    CrossChainReplay,
    #[msg("El nonce del mensaje cross-chain ha expirado (>300 slots)")]
    NonceExpired,
    #[msg("El pago en USDC es insuficiente para la cantidad de tokens solicitada")]
    InsufficientPayment,
    #[msg("El proof ZK es inválido o tiene formato incorrecto")]
    InvalidZkProof,
    #[msg("El cache ZK está siendo escrito por otra transacción — reintentar")]
    ZkCacheLocked,

    // ── Fase 4: dNFT Token-2022 ───────────────────────────────────────────
    #[msg("El dNFT está colateralizado en un préstamo activo — no puede transferirse")]
    DnftIsCollateralized,
    #[msg("Falló la inicialización de una extensión Token-2022 del dNFT")]
    DnftExtensionInitFailed,

    // ── Fase 4: Préstamos DeFi ────────────────────────────────────────────
    #[msg("El monto del préstamo es inferior al mínimo de $100 USDC")]
    LoanAmountTooSmall,
    #[msg("La duración del préstamo debe ser entre 7 y 365 días")]
    InvalidLoanDuration,
    #[msg("El monto solicitado excede el LTV máximo del 60% del valor del oracle")]
    ExceedsMaxLtv,
    #[msg("Este préstamo ya fue repagado")]
    LoanAlreadyRepaid,
    #[msg("Este préstamo está en mora — usar liquidate_collateral")]
    LoanDefaulted,

    // ── Fase 4: Liquidación ───────────────────────────────────────────────
    #[msg("Condición de liquidación no cumplida: LTV < 75% y préstamo vigente")]
    LiquidationConditionNotMet,

    // ── Fase 4: SmartAccount / WebAuthn ──────────────────────────────────
    #[msg("La clave pública P256 debe comenzar con 0x02 o 0x03 (comprimida)")]
    InvalidP256Pubkey,
    #[msg("La SmartAccount está inactiva")]
    SmartAccountInactive,
    #[msg("Saldo de renta insuficiente para que el Paymaster pague el fee")]
    InsufficientRentForPaymaster,
    #[msg("El fee solicitado al Paymaster excede el máximo de 0.05 SOL")]
    PaymasterFeeTooHigh,

    // ── Fase 4: Tesorería ─────────────────────────────────────────────────
    #[msg("Falló la recolección de Transfer Fees hacia la tesorería del protocolo")]
    TreasuryCollectionFailed,

    // ── Gobernanza: presupuesto de mantenimiento ──────────────────────────
    #[msg("El presupuesto de mantenimiento debe ser mayor que cero y menor a $10M USDC")]
    InvalidMaintenanceBudget,

    #[msg("El presupuesto de mantenimiento ya fue ejecutado")]
    MaintenanceBudgetAlreadyExecuted,

    #[msg("La propuesta fue rechazada — no se puede ejecutar el pago")]
    MaintenanceBudgetRejected,

    #[msg("El vault de renta no tiene fondos suficientes para el pago")]
    InsufficientVaultFunds,
    // ── Fase 3: Proof of Reserve ──────────────────────────────────────────────
    #[msg("El hash del certificado notarial es inválido — debe ser SHA-256 de 32 bytes")]
    PorInvalidHash,

    #[msg("El CID de Arweave excede 50 caracteres")]
    PorArweaveCidTooLong,

    #[msg("La referencia de escritura excede 32 caracteres")]
    PorEscrituaRefTooLong,

    #[msg("El certificado notarial está expirado — se requiere renovación semestral")]
    PorCertificateExpired,

    // ── Fase 3: Liquidez CLMM ─────────────────────────────────────────────────
    #[msg("El pool de liquidez ya fue inicializado para esta propiedad")]
    PoolAlreadyInitialized,

    #[msg("El pool de liquidez no está activo")]
    PoolNotActive,

    // ── Fase 0: Seguridad — Timelock & Multisig ──────────────────────────────
    #[msg("El timelock no ha expirado — espera 48 horas desde la propuesta")]
    TimelockNotExpired,

    #[msg("Esta propuesta ya fue ejecutada y no puede modificarse")]
    ProposalAlreadyExecuted,

    #[msg("Esta propuesta fue cancelada")]
    ProposalAlreadyCancelled,

    #[msg("Propuesta cancelada por el multisig — operación bloqueada")]
    ProposalCancelled,

    #[msg("El payload de la propuesta excede 256 bytes")]
    TimelockPayloadTooLarge,

    #[msg("El multisig no alcanzó el threshold requerido de aprobaciones (3/5)")]
    MultisigThresholdNotMet,

    #[msg("Firmas insuficientes en el multisig — se requieren 3 de 5")]
    InsufficientSignatures,

    // ── Fase 0 / Fase 2: Oracle V2 — Switchboard ────────────────────────────
    #[msg("El feed de Switchboard es inválido o no tiene datos recientes")]
    SwitchboardFeedInvalid,

    #[msg("El feed de Switchboard está desactualizado — datos no confiables")]
    SwitchboardFeedStale,

    #[msg("El oracle de la propiedad no ha sido inicializado todavía")]
    OracleNotInitialized,

    #[msg("El precio propuesto se desvía más del 20% del feed externo de Switchboard")]
    OraclePriceDeviationTooLarge,

    #[msg("Actualización de oracle demasiado frecuente — mínimo 24h entre updates")]
    OracleUpdateTooFrequent,

    #[msg("El precio del oracle es inválido para calcular tokens en compound")]
    OraclePriceInvalid,

    // ── Fase 1: Auto-compound ────────────────────────────────────────────────
    #[msg("Monto de compound demasiado pequeño — mínimo 0.001 SOL")]
    CompoundAmountTooSmall,

    #[msg("El compound excedería el supply máximo de tokens de la propiedad")]
    CompoundExceedsTokenSupply,
    // ── Fase 4: Token MAMP ve-tokenomics ────────────────────────────────────
    #[msg("La cantidad de MAMP debe ser mayor que cero")]
    MampZeroAmount,

    #[msg("Duración de bloqueo inválida — mínimo 1 semana, máximo 4 años")]
    MampInvalidLockDuration,

    #[msg("Los tokens MAMP siguen bloqueados — espera hasta el unlock_at")]
    MampStillLocked,

    #[msg("No hay fees del protocolo acumulados para distribuir")]
    MampNoFeesToDistribute,

    #[msg("No hay stakers de MAMP activos para recompensar")]
    MampNoStakersToReward,

    // ── Fase 4: Light Protocol compressed accounts ───────────────────────────
    #[msg("El árbol de Merkle está lleno — crear un árbol adicional")]
    CompressedTreeFull,

    #[msg("El proof de Merkle es inválido — KYC no verificable")]
    CompressedInvalidMerkleProof,
}
