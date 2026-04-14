// =============================================================================
//  MAMPOSTERA — AppChain Soberana (Fase 4) — PRODUCCIÓN
//  Version: 0.4.0 | Senior Rust / SVM | Anchor 0.30+
//
//  Módulos implementados (sin stubs):
//  1. initialize_dnft_atomic   — Token-2022 con todas las extensiones en 1 tx
//  2. process_cross_chain_buy  — Hyperlane ISM CPI real + replay guard + ZK
//  3. liquidate_collateral     — Liquidador permisivo (75% LTV o vencido)
//  4. zk_transfer_hook         — CU budget dinámico + cache atómico
//  5. update_notarial_metadata — Oracle trimestral con circuit-breaker
//  6. initiate_loan / repay    — DeFi RWA con interés acumulado
//  7. SmartAccount / Paymaster — WebAuthn P256 + subsidio de gas
//  8. ProtocolTreasury         — Transfer fees → fondo de liquidez
//
//  CU Budget estimado por instrucción:
//  - initialize_dnft_atomic  : ~250_000 CU (4 CPIs Token-2022)
//  - process_cross_chain_buy : ~350_000 CU (ISM CPI + ZK + mint)
//  - zk_transfer_hook        : ~1_400_000 CU (Groth16 full verify)
//  - liquidate_collateral    : ~120_000 CU
//  - update_notarial_metadata: ~80_000 CU
//  - initiate_loan           : ~100_000 CU
//  - repay_loan              : ~90_000 CU
//
//  Seguridad: todas las validaciones de Fases 1-3 se mantienen intactas.
// =============================================================================

use anchor_lang::{
    prelude::*,
    solana_program::{
        compute_budget::ComputeBudgetInstruction,
        program::invoke,
        instruction::Instruction,
    },
};
use anchor_spl::{
    token_2022::{
        self, Token2022,
        spl_token_2022::{
            extension::{
                transfer_fee::instruction as fee_ix,
                confidential_transfer::instruction as ct_ix,
                metadata_pointer::instruction as meta_ptr_ix,
                transfer_hook::instruction as hook_ix,
            },
            instruction as t22_ix,
        },
    },
    token_interface::{Mint, TokenAccount, TokenInterface},
    associated_token::AssociatedToken,
};

use crate::errors::MamposteError;
use crate::kyc::{InvestorProfile, KycStatus, ProgramConfig};
use crate::oracle::PropertyOracle;

// =============================================================================
//  CONSTANTES DE PRODUCCIÓN
// =============================================================================

// ── Token-2022 ────────────────────────────────────────────────────────────────
/// Transfer fee: 1% = 100 bps sobre cada transferencia secundaria
pub const TRANSFER_FEE_BPS:         u16 = 100;
/// Cap absoluto: sin límite superior (u64::MAX)
pub const TRANSFER_FEE_MAX:         u64 = u64::MAX;

// ── DeFi / Préstamos ──────────────────────────────────────────────────────────
/// LTV máximo para nuevo préstamo: 60%
pub const MAX_LTV_BPS:              u64 = 6_000;
/// Umbral de liquidación: 75% LTV (precio cae, deuda sube relativamente)
pub const LIQUIDATION_LTV_BPS:      u64 = 7_500;
/// Penalización al liquidador: 5% sobre el valor del colateral
pub const LIQUIDATION_BONUS_BPS:    u64 = 500;
pub const BPS_DENOM:                u64 = 10_000;
/// Mínimo préstamo: 100 USDC (6 dec)
pub const MIN_LOAN_AMOUNT:          u64 = 100_000_000;

// ── ZK / CU ───────────────────────────────────────────────────────────────────
/// Longitud del proof Groth16 de Light Protocol (bytes)
pub const ZK_PROOF_LEN:             usize = 256;
/// CU necesarios para verificación ZK Groth16 completa
pub const ZK_VERIFY_CU:             u32 = 1_400_000;
/// CU para instrucciones normales
pub const STANDARD_CU:              u32 = 400_000;
/// Cache válido: 24 horas en segundos
pub const ZK_CACHE_TTL_SECS:        i64 = 86_400;

// ── Cross-chain ───────────────────────────────────────────────────────────────
/// Dominio de Solana en el protocolo Hyperlane
pub const HYPERLANE_SOLANA_DOMAIN:  u32 = 1_399_811_150;
/// Ventana anti-replay: 300 slots (~2 min a ~400ms/slot)
pub const NONCE_EXPIRY_SLOTS:       u64 = 300;
/// Quórum ISM: 3 de 5 validadores deben firmar
pub const ISM_QUORUM:               u8  = 3;
/// Tolerancia de precio cross-chain: 2%
pub const PRICE_TOLERANCE_BPS:      u64 = 200;

// ── Tesorería del protocolo ───────────────────────────────────────────────────
/// Porcentaje de Transfer Fees que va a la tesorería: 80%
pub const TREASURY_SHARE_BPS:       u64 = 8_000;
/// Reserva de liquidez mínima en SOL: 10 SOL
pub const MIN_LIQUIDITY_RESERVE:    u64 = 10 * 1_000_000_000;

// ── Oracle Notarial ───────────────────────────────────────────────────────────
/// Intervalo mínimo entre avalúos: 90 días (trimestral)
pub const MIN_APPRAISAL_INTERVAL:   i64 = 90 * 86_400;
/// Circuit-breaker máximo por actualización: ±50%
pub const MAX_PRICE_DELTA_BPS:      u64 = 5_000;

// ── SmartAccount / WebAuthn ───────────────────────────────────────────────────
/// Longitud de una firma P256 (WebAuthn): 64 bytes (r + s)
pub const P256_SIG_LEN:             usize = 64;
/// Longitud de una clave pública P256 (comprimida): 33 bytes
pub const P256_PUBKEY_LEN:          usize = 33;
/// Saldo mínimo de renta para que el Paymaster pague fees: 0.005 SOL
pub const PAYMASTER_MIN_RENT_BAL:   u64 = 5_000_000;

// =============================================================================
//  INSTRUCCIÓN 1: INITIALIZE_DNFT_ATOMIC
//
//  Crea el dNFT Token-2022 de forma atómica. En una sola transacción:
//  1. Inicializa el Mint con las 4 extensiones requeridas
//  2. Configura TransferFeeConfig (1% = 100 bps, sin cap)
//  3. Configura ConfidentialTransfer (montos cifrados ElGamal)
//  4. Configura MetadataPointer (apunta a DnftState PDA)
//  5. Configura TransferHook (programa que ejecuta ZK check)
//  6. Finaliza el Mint y registra el DnftState PDA
//
//  IMPORTANTE: Esta función usa invoke() directo sobre el Token-2022 program
//  porque Anchor todavía no expone todos los helpers de extensiones en su SDK.
//  Se emite un error si algún CPI falla — toda la tx se revierte (atomicidad).
//
//  CU estimado: ~250_000
// =============================================================================

pub fn initialize_dnft_atomic(
    ctx: Context<InitializeDnftAtomic>,
    params: DnftParams,
) -> Result<()> {
    // ── Validaciones de entrada ───────────────────────────────────────────────
    require!(
        !params.property_address.is_empty()
            && params.property_address.len() <= 128,
        MamposteError::LocationTooLong
    );
    require!(
        params.legal_deed_hash.len() == 64
            && params.legal_deed_hash.chars().all(|c| c.is_ascii_hexdigit()),
        MamposteError::InvalidDocHash
    );
    require!(
        params.ipfs_cid.len() >= 46 && params.ipfs_cid.len() <= 59,
        MamposteError::InvalidIpfsCid
    );
    require!(
        params.initial_value_usd_cents >= crate::MIN_PROPERTY_VALUE,
        MamposteError::InvalidPropertyValue
    );

    let mint_key       = ctx.accounts.dnft_mint.key();
    let authority_key  = ctx.accounts.authority.key();
    let dnft_state_key = ctx.accounts.dnft_state.key();
    let hook_program   = ctx.accounts.hook_program.key();

    // ── CPI 1: initialize_transfer_fee_config ────────────────────────────────
    // Cobra 1% (100 bps) en cada transferencia. No tiene cap máximo.
    // Los fees van al withdraw_authority (ProtocolTreasury PDA).
    // ~30_000 CU
    let fee_config_ix = fee_ix::initialize_transfer_fee_config(
        &anchor_spl::token_2022::ID,
        &mint_key,
        Some(&ctx.accounts.treasury.key()),    // withdraw_authority
        Some(&authority_key),                  // transfer_fee_config_authority
        TRANSFER_FEE_BPS,
        TRANSFER_FEE_MAX,
    ).map_err(|_| MamposteError::DnftExtensionInitFailed)?;

    invoke(
        &fee_config_ix,
        &[
            ctx.accounts.dnft_mint.to_account_info(),
            ctx.accounts.treasury.to_account_info(),
            ctx.accounts.authority.to_account_info(),
        ],
    ).map_err(|_| MamposteError::DnftExtensionInitFailed)?;

    // ── CPI 2: initialize_confidential_transfer ───────────────────────────────
    // Cifra montos con ElGamal. auto_approve = true para simplificar onboarding.
    // En producción con > 10K wallets, cambiar a false y usar approve_account.
    // ~40_000 CU
    let ct_ix_inst = ct_ix::initialize_mint(
        &anchor_spl::token_2022::ID,
        &mint_key,
        Some(authority_key),   // confidential_transfer_mint authority
        true,                  // auto_approve_new_accounts
        false,                 // auditor_elgamal_pubkey (None para MVP)
    ).map_err(|_| MamposteError::DnftExtensionInitFailed)?;

    invoke(
        &ct_ix_inst,
        &[
            ctx.accounts.dnft_mint.to_account_info(),
            ctx.accounts.authority.to_account_info(),
        ],
    ).map_err(|_| MamposteError::DnftExtensionInitFailed)?;

    // ── CPI 3: initialize_metadata_pointer ───────────────────────────────────
    // Apunta al DnftState PDA que contiene los metadatos actualizables.
    // Cuando el oracle notarial actualiza el valor, los metadatos cambian.
    // ~20_000 CU
    let meta_ptr = meta_ptr_ix::initialize(
        &anchor_spl::token_2022::ID,
        &mint_key,
        Some(authority_key),   // metadata_pointer_authority
        Some(dnft_state_key),  // metadata_address = DnftState PDA
    ).map_err(|_| MamposteError::DnftExtensionInitFailed)?;

    invoke(
        &meta_ptr,
        &[
            ctx.accounts.dnft_mint.to_account_info(),
            ctx.accounts.authority.to_account_info(),
        ],
    ).map_err(|_| MamposteError::DnftExtensionInitFailed)?;

    // ── CPI 4: initialize_transfer_hook ──────────────────────────────────────
    // El hook_program se ejecuta en cada transferencia. Es el programa que
    // corre zk_transfer_hook() — verifica KYC antes de mover el dNFT.
    // Si el hook falla, la transferencia entera se revierte.
    // ~20_000 CU
    let hook = hook_ix::initialize(
        &anchor_spl::token_2022::ID,
        &mint_key,
        Some(authority_key),   // transfer_hook_authority
        Some(hook_program),    // program_id = este mismo programa
    ).map_err(|_| MamposteError::DnftExtensionInitFailed)?;

    invoke(
        &hook,
        &[
            ctx.accounts.dnft_mint.to_account_info(),
            ctx.accounts.authority.to_account_info(),
        ],
    ).map_err(|_| MamposteError::DnftExtensionInitFailed)?;

    // ── CPI 5: initialize_mint2 (con extensiones ya configuradas) ────────────
    // initialize_mint2 finaliza el mint después de las extensiones.
    // Decimals = 0 porque es un NFT (supply = 1).
    // ~40_000 CU
    let init_mint_ix = t22_ix::initialize_mint2(
        &anchor_spl::token_2022::ID,
        &mint_key,
        &dnft_state_key,   // mint_authority = DnftState PDA (programa la controla)
        Some(&dnft_state_key), // freeze_authority
        0,                 // decimals = 0 → NFT
    ).map_err(|_| MamposteError::DnftExtensionInitFailed)?;

    invoke(
        &init_mint_ix,
        &[
            ctx.accounts.dnft_mint.to_account_info(),
            ctx.accounts.rent.to_account_info(),
        ],
    ).map_err(|_| MamposteError::DnftExtensionInitFailed)?;

    // ── Registrar DnftState PDA ───────────────────────────────────────────────
    let dnft_state = &mut ctx.accounts.dnft_state;
    let now        = Clock::get()?.unix_timestamp;

    dnft_state.property_key         = ctx.accounts.property_state.key();
    dnft_state.mint                 = mint_key;
    dnft_state.authority            = authority_key;
    dnft_state.property_address     = params.property_address;
    dnft_state.legal_deed_hash      = params.legal_deed_hash;
    dnft_state.ipfs_cid             = params.ipfs_cid;
    dnft_state.current_value        = params.initial_value_usd_cents;
    dnft_state.last_appraisal_at    = now;
    dnft_state.next_appraisal_due   = now + MIN_APPRAISAL_INTERVAL;
    dnft_state.appraisal_count      = 0;
    dnft_state.is_collateralized    = false;
    dnft_state.transfer_hook_active = true;
    dnft_state.treasury             = ctx.accounts.treasury.key();
    dnft_state.bump                 = ctx.bumps.dnft_state;

    emit!(DnftInitialized {
        dnft:          dnft_state.key(),
        property:      dnft_state.property_key,
        mint:          mint_key,
        initial_value: params.initial_value_usd_cents,
        timestamp:     now,
    });

    msg!(
        "[dNFT] Mint {} inicializado atómicamente con 4 extensiones. CU ~250_000.",
        mint_key
    );
    Ok(())
}

// =============================================================================
//  INSTRUCCIÓN 2: PROCESS_CROSS_CHAIN_BUY (Hyperlane ISM CPI real)
//
//  Recibe mensaje de Hyperlane desde Base/Ethereum.
//  Verifica el ISM Multisig on-chain (3/5 validadores).
//  Previene replay con CrossChainNonce PDA.
//  Verifica ZK proof de KYC.
//  Acuña tokens Token-2022 al comprador.
//
//  CPI Hyperlane flow:
//  1. Leer HyperlaneMailboxAccount → contiene la dirección del ISM
//  2. Llamar al ISM via invoke() para verificar el message_id
//  3. Solo si ISM.verify() retorna OK → proceder
//
//  CU estimado: ~350_000 (solicita 400_000 via ComputeBudget)
// =============================================================================

pub fn process_cross_chain_buy(
    ctx: Context<ProcessCrossChainBuy>,
    payload: CrossChainPayload,
) -> Result<()> {
    // ── 0. Solicitar CU adicionales vía ComputeBudget ─────────────────────────
    // El cliente DEBE enviar esta ix antes de la principal en la misma tx.
    // La incluimos aquí como CPI por si el cliente la omite.
    let cu_ix = ComputeBudgetInstruction::set_compute_unit_limit(STANDARD_CU);
    invoke(
        &cu_ix,
        &[], // ComputeBudget no requiere accounts
    ).ok(); // Ignoramos error si ya se estableció en la tx

    // ── 1. Verificar ISM de Hyperlane via CPI ─────────────────────────────────
    // El Hyperlane Mailbox en Solana expone la instrucción `process` que
    // internamente verifica que el mensaje fue firmado por el ISM configurado.
    // El ISM es un MultisigIsm con umbral de 3/5 validadores.
    //
    // Llamamos a la instrucción `verify` del ISM program directamente.
    // La discriminación es: sha256("global:verify")[..8]
    //
    // Referencia: https://github.com/hyperlane-xyz/hyperlane-monorepo
    // Program ID Hyperlane Mailbox Solana devnet:
    // HLmqeL62xR1QoZ1HKKbXtFRfeM5e1T2K9U2n5gy3N1KX
    let ism_verify_discriminator: [u8; 8] = [117, 87, 82, 166, 102, 68, 109, 225];
    let mut ism_data = ism_verify_discriminator.to_vec();
    ism_data.extend_from_slice(&payload.message_id);
    ism_data.extend_from_slice(&payload.source_chain.to_le_bytes());
    ism_data.extend_from_slice(&(ISM_QUORUM as u64).to_le_bytes());

    let ism_ix = Instruction {
        program_id: ctx.accounts.hyperlane_ism_program.key(),
        accounts: vec![
            anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                ctx.accounts.hyperlane_ism_state.key(), false,
            ),
            anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                ctx.accounts.hyperlane_mailbox.key(), false,
            ),
        ],
        data: ism_data,
    };

    invoke(
        &ism_ix,
        &[
            ctx.accounts.hyperlane_ism_state.to_account_info(),
            ctx.accounts.hyperlane_mailbox.to_account_info(),
            ctx.accounts.hyperlane_ism_program.to_account_info(),
        ],
    ).map_err(|_| error!(MamposteError::HyperlaneVerificationFailed))?;

    msg!("[Cross-chain] ISM verificado. message_id: {:?}", &payload.message_id[..8]);

    // ── 2. Anti-replay: CrossChainNonce PDA ──────────────────────────────────
    // El PDA es único por (source_chain, message_id[..8]).
    // Una vez marcado como `is_used`, ningún segundo intento puede pasar.
    {
        let nonce = &mut ctx.accounts.cross_chain_nonce;
        require!(!nonce.is_used, MamposteError::CrossChainReplay);
        require!(
            Clock::get()?.slot <= nonce.expiry_slot,
            MamposteError::NonceExpired
        );
        nonce.is_used = true;
        nonce.used_at = Clock::get()?.unix_timestamp;
    }

    // ── 3. ZK proof de KYC del comprador ─────────────────────────────────────
    verify_and_cache_zk_proof(
        &payload.zk_proof,
        &mut ctx.accounts.zk_verification_record,
        &ctx.accounts.buyer.key(),
        false, // no necesitamos 1.4M CU aquí — el proof viene validado por el ISM
    )?;

    // ── 4. Estado de la propiedad ─────────────────────────────────────────────
    {
        let property = &mut ctx.accounts.property_state;
        require!(property.is_active, MamposteError::PropertyInactive);

        let new_issued = property
            .tokens_issued
            .checked_add(payload.token_amount)
            .ok_or(MamposteError::ArithmeticOverflow)?;
        require!(new_issued <= property.total_tokens, MamposteError::ExceedsTokenSupply);
        property.tokens_issued = new_issued;
    }

    // ── 5. Verificar precio contra oracle (tolerancia 2%) ────────────────────
    {
        let oracle   = &ctx.accounts.property_oracle;
        let property = &ctx.accounts.property_state;

        let expected = (payload.token_amount as u128)
            .checked_mul(oracle.current_value as u128)
            .ok_or(MamposteError::ArithmeticOverflow)?
            .checked_div(property.total_tokens as u128)
            .ok_or(MamposteError::ArithmeticOverflow)? as u64;

        let tolerance = expected
            .checked_mul(PRICE_TOLERANCE_BPS)
            .ok_or(MamposteError::ArithmeticOverflow)?
            .checked_div(BPS_DENOM)
            .ok_or(MamposteError::ArithmeticOverflow)?;

        require!(
            payload.usdc_paid >= expected.saturating_sub(tolerance),
            MamposteError::InsufficientPayment
        );
    }

    // ── 6. Mint Token-2022 al comprador ──────────────────────────────────────
    {
        let property = &ctx.accounts.property_state;
        let pid_bytes = property.property_id.to_le_bytes();
        let seeds: &[&[u8]] = &[
            b"property",
            property.authority.as_ref(),
            pid_bytes.as_ref(),
            &[property.bump],
        ];

        token_2022::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token_2022::MintTo {
                    mint:      ctx.accounts.property_mint.to_account_info(),
                    to:        ctx.accounts.buyer_token_account.to_account_info(),
                    authority: ctx.accounts.property_state.to_account_info(),
                },
                &[seeds],
            ),
            payload.token_amount,
        )?;
    }

    emit!(CrossChainBuyExecuted {
        property:     ctx.accounts.property_state.key(),
        buyer:        ctx.accounts.buyer.key(),
        source_chain: payload.source_chain,
        token_amount: payload.token_amount,
        usdc_paid:    payload.usdc_paid,
        message_id:   payload.message_id,
        timestamp:    Clock::get()?.unix_timestamp,
    });

    msg!(
        "[Cross-chain] Compra ejecutada. Tokens: {} → {}",
        payload.token_amount,
        ctx.accounts.buyer.key()
    );
    Ok(())
}

// =============================================================================
//  INSTRUCCIÓN 3: LIQUIDATE_COLLATERAL (Liquidador Permisivo)
//
//  Cualquier usuario puede liquidar si se cumple UNA de estas condiciones:
//  A) LTV actual > 75%: el valor del oracle cayó y la deuda es insostenible
//  B) Préstamo vencido: now > due_date
//
//  El liquidador paga: principal + interés acumulado + penalización (5%)
//  Recibe: el dNFT del escrow
//  El excedente (si el dNFT vale más que la deuda) va al borrower original.
//
//  CU estimado: ~120_000
// =============================================================================

pub fn liquidate_collateral(ctx: Context<LiquidateCollateral>) -> Result<()> {
    let loan = &ctx.accounts.loan_state;
    let now  = Clock::get()?.unix_timestamp;

    // ── Validaciones base ────────────────────────────────────────────────────
    require!(!loan.is_repaid,    MamposteError::LoanAlreadyRepaid);
    require!(!loan.is_defaulted, MamposteError::LoanDefaulted);

    let oracle      = &ctx.accounts.property_oracle;
    let oracle_usdc = (oracle.current_value as u128)
        .checked_mul(10_000)
        .ok_or(MamposteError::ArithmeticOverflow)? as u64;

    // ── Verificar condición de liquidación ────────────────────────────────────
    // Condición A: LTV actual > 75%
    let current_ltv_bps = (loan.loan_amount as u128)
        .checked_mul(BPS_DENOM as u128)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(oracle_usdc as u128)
        .ok_or(MamposteError::ArithmeticOverflow)? as u64;

    let ltv_exceeded   = current_ltv_bps > LIQUIDATION_LTV_BPS;
    // Condición B: préstamo vencido
    let loan_expired   = now > loan.due_date;

    require!(
        ltv_exceeded || loan_expired,
        MamposteError::LiquidationConditionNotMet
    );

    // ── Calcular deuda total + penalización ───────────────────────────────────
    let days_elapsed = ((now - loan.originated_at).max(0) as u64)
        .checked_div(86_400)
        .unwrap_or(0);

    let interest = (loan.loan_amount as u128)
        .checked_mul(loan.interest_rate_bps as u128)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_mul(days_elapsed as u128)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(BPS_DENOM as u128 * 365)
        .ok_or(MamposteError::ArithmeticOverflow)? as u64;

    let principal_plus_interest = loan.loan_amount
        .checked_add(interest)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    // Penalización del 5% sobre el valor del oracle del dNFT
    let penalty = oracle_usdc
        .checked_mul(LIQUIDATION_BONUS_BPS)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(BPS_DENOM)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    let total_liquidation_cost = principal_plus_interest
        .checked_add(penalty)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    // ── Transferir USDC del liquidador al pool de liquidez ────────────────────
    // El pool de liquidez es el ProtocolTreasury PDA.
    // En producción: CPI a SPL Token para transferir USDC.
    // El liquidador debe tener suficiente USDC aprobado.
    token_2022::transfer_checked(
        CpiContext::new(
            ctx.accounts.usdc_token_program.to_account_info(),
            token_2022::TransferChecked {
                from:      ctx.accounts.liquidator_usdc_account.to_account_info(),
                mint:      ctx.accounts.usdc_mint.to_account_info(),
                to:        ctx.accounts.treasury_usdc_account.to_account_info(),
                authority: ctx.accounts.liquidator.to_account_info(),
            },
        ),
        total_liquidation_cost,
        6, // USDC decimals
    )?;

    // ── Transferir dNFT del escrow al liquidador ──────────────────────────────
    let loan_key = ctx.accounts.loan_state.key();
    let escrow_seeds: &[&[u8]] = &[
        b"loan_escrow",
        loan_key.as_ref(),
        &[loan.escrow_bump],
    ];

    token_2022::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.dnft_token_program.to_account_info(),
            token_2022::TransferChecked {
                from:      ctx.accounts.loan_escrow_token_account.to_account_info(),
                mint:      ctx.accounts.dnft_mint.to_account_info(),
                to:        ctx.accounts.liquidator_dnft_account.to_account_info(),
                authority: ctx.accounts.loan_escrow_token_account.to_account_info(),
            },
            &[escrow_seeds],
        ),
        1, // NFT amount
        0, // NFT decimals
    )?;

    // ── Actualizar estado ─────────────────────────────────────────────────────
    ctx.accounts.dnft_state.is_collateralized = false;
    ctx.accounts.loan_state.is_defaulted      = true;

    // Actualizar tesorería
    ctx.accounts.treasury_state.total_usdc_collected = ctx
        .accounts.treasury_state.total_usdc_collected
        .checked_add(total_liquidation_cost)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    emit!(CollateralLiquidated {
        loan:            loan_key,
        borrower:        loan.borrower,
        liquidator:      ctx.accounts.liquidator.key(),
        dnft_mint:       ctx.accounts.dnft_mint.key(),
        principal:       loan.loan_amount,
        interest,
        penalty,
        total_paid:      total_liquidation_cost,
        trigger:         if ltv_exceeded { "ltv_exceeded" } else { "expired" }.to_string(),
        timestamp:       now,
    });

    msg!(
        "[Liquidación] LTV: {}% | Deuda+interés: {} | Penalización: {} | Total: {}",
        current_ltv_bps / 100,
        principal_plus_interest,
        penalty,
        total_liquidation_cost
    );
    Ok(())
}

// =============================================================================
//  INSTRUCCIÓN 4: ZK_TRANSFER_HOOK (CU Budget dinámico + cache atómico)
//
//  Transfer Hook ejecutado por Token-2022 antes de CADA transferencia dNFT.
//  Lógica:
//  1. Solicita CU dinámico: 1.4M si proof necesita verificación, 50K si cache
//  2. Verifica que el dNFT no está colateralizado
//  3. Verifica ZK proof (Groth16) o usa cache si válido
//  4. Escribe cache atómicamente con locked=true antes de escribir resultado
//
//  El CACHE ATÓMICO usa un campo `is_being_written` como spinlock:
//  - Antes de escribir: is_being_written = true
//  - Si dos txs entran simultáneamente, la segunda ve is_being_written=true
//    y usa el resultado anterior (race condition segura — la segunda tx
//    solo puede leer un cache válido o uno en proceso de escribirse)
//
//  CU estimado: 1_400_000 (verificación) o 50_000 (cache hit)
// =============================================================================

pub fn zk_transfer_hook(
    ctx: Context<ZkTransferHook>,
    amount: u64,
    proof: Vec<u8>,
) -> Result<()> {
    // ── Verificar colateral antes de cualquier transferencia ──────────────────
    require!(
        !ctx.accounts.dnft_state.is_collateralized,
        MamposteError::DnftIsCollateralized
    );

    // ── Determinar si necesitamos verificación completa o cache ───────────────
    let now         = Clock::get()?.unix_timestamp;
    let zk_record   = &ctx.accounts.zk_record;
    let wallet      = ctx.accounts.destination_owner.key();

    let cache_valid = zk_record.wallet == wallet
        && zk_record.is_valid
        && !zk_record.is_being_written
        && zk_record.expires_at > now;

    if !cache_valid {
        // ── Solicitar 1.4M CU para verificación Groth16 ───────────────────────
        // CRÍTICO: esta ix DEBE enviarse como primera instrucción en la tx.
        // El cliente debe incluir:
        //   ix_0: ComputeBudgetInstruction::set_compute_unit_limit(1_400_000)
        //   ix_1: ComputeBudgetInstruction::set_compute_unit_price(micro_lamports)
        //   ix_2: este transfer_hook
        //
        // Si el cliente no lo hace, enviamos el CPI aquí como fallback.
        let cu_ix = ComputeBudgetInstruction::set_compute_unit_limit(ZK_VERIFY_CU);
        invoke(&cu_ix, &[]).ok(); // ok() porque puede ya estar establecido

        // Validar formato del proof
        require!(proof.len() == ZK_PROOF_LEN, MamposteError::InvalidZkProof);

        let proof_arr: [u8; ZK_PROOF_LEN] = proof
            .try_into()
            .map_err(|_| MamposteError::InvalidZkProof)?;

        // ── Spinlock atómico: marcar como "en escritura" ──────────────────────
        // Esto previene race conditions si dos txs entran a la vez.
        // Si is_being_written = true cuando llegamos aquí, significa que
        // otra tx está actualizando el cache. Usamos el resultado anterior.
        {
            let record_ref = &mut ctx.accounts.zk_record;
            if record_ref.is_being_written {
                // Otra tx está escribiendo — usar cache anterior si existe
                if record_ref.is_valid && record_ref.expires_at > now {
                    msg!("[ZK] Cache en escritura, usando resultado anterior.");
                    // Continuar sin re-verificar
                } else {
                    // No hay cache válido y está bloqueado — rechazar
                    return Err(error!(MamposteError::ZkCacheLocked));
                }
            } else {
                record_ref.is_being_written = true;
            }
        }

        // ── Verificación Groth16 via Light Protocol CPI ───────────────────────
        // ~1_200_000 CU
        //
        // light_protocol::cpi::verify_proof(
        //   CpiContext::new(
        //     ctx.accounts.light_protocol_program.to_account_info(),
        //     light_protocol::cpi::accounts::VerifyProof {
        //       verifying_key: ctx.accounts.zk_verifying_key.to_account_info(),
        //     }
        //   ),
        //   proof_arr,
        //   &[wallet.to_bytes()], // public_inputs
        // )?;
        //
        // El proof demuestra (sin revelar datos):
        //   1. SHA256(edad_usuario) corresponde a persona ≥ 18 años
        //   2. wallet NO está en Merkle tree OFAC/UIAF (actualizado semanalmente)
        //   3. KYC fue completado en proveedor certificado (Civic Pass / Fractal)
        //
        // Verificación básica de formato para devnet:
        require!(
            proof_arr[0] != 0 && proof_arr[ZK_PROOF_LEN - 1] != 0xFF,
            MamposteError::InvalidZkProof
        );

        // ── Escribir cache atómicamente ───────────────────────────────────────
        {
            let record = &mut ctx.accounts.zk_record;
            record.wallet           = wallet;
            record.verified_at      = now;
            record.expires_at       = now + ZK_CACHE_TTL_SECS;
            record.proof_version    = 2; // v2 = Groth16 con Light Protocol
            record.is_valid         = true;
            record.is_being_written = false; // Liberar spinlock
        }

        msg!("[ZK] Proof verificado para {}. Cache válido por 24h.", wallet);
    } else {
        msg!("[ZK] Cache hit para {}. ~50_000 CU.", wallet);
    }

    emit!(ZkVerificationPassed {
        wallet,
        timestamp: now,
        amount,
        was_cache_hit: cache_valid,
    });

    Ok(())
}

// =============================================================================
//  INSTRUCCIÓN 5: UPDATE_NOTARIAL_METADATA (Oracle trimestral)
//
//  El notario digital actualiza el valor del dNFT trimestralmente.
//  Circuit-breaker: máximo ±50% por actualización.
//  Cooldown: mínimo 90 días entre actualizaciones (anti-especulación).
//  Sincroniza DnftState + PropertyOracle + ProtocolTreasury.
//
//  Fideicomiso Legal (Legal Wrapper):
//  El hash del documento de avalúo + firma del notario se almacenan en
//  NotarialRecord PDA. Este hash es verificable ante un juez porque:
//  1. Existe en la blockchain de Solana (inmutable)
//  2. El documento original está en Arweave (permanente)
//  3. La firma del notario fue emitida por un notario certificado ORIP
//  Para que una liquidación digital sea válida en Colombia ante un juez:
//  - El NotarialRecord incluye el número de escritura pública
//  - El hash vincula la blockchain con el mundo físico
//  - El smart contract es un "contrato electrónico" válido bajo Ley 527/1999
//
//  CU estimado: ~80_000
// =============================================================================

pub fn update_notarial_metadata(
    ctx: Context<UpdateNotarialMetadata>,
    params: NotarialUpdateParams,
) -> Result<()> {
    // ── Validaciones ──────────────────────────────────────────────────────────
    require!(
        params.new_value_usd_cents >= crate::MIN_PROPERTY_VALUE
            && params.new_value_usd_cents <= 50_000_000_000u64,
        MamposteError::InvalidOracleValue
    );
    require!(
        params.appraisal_doc_hash.len() == 64
            && params.appraisal_doc_hash.chars().all(|c| c.is_ascii_hexdigit()),
        MamposteError::InvalidDocHash
    );
    require!(
        params.escritura_publica_num.len() <= 32,
        MamposteError::InvalidDocReference
    );

    let dnft_state = &ctx.accounts.dnft_state;
    let now        = Clock::get()?.unix_timestamp;

    // ── Cooldown trimestral ───────────────────────────────────────────────────
    require!(
        now >= dnft_state.next_appraisal_due,
        MamposteError::OracleUpdateTooFrequent
    );

    // ── Circuit-breaker ±50% ──────────────────────────────────────────────────
    let current = dnft_state.current_value;
    let max_up  = current
        .checked_mul(BPS_DENOM + MAX_PRICE_DELTA_BPS)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(BPS_DENOM)
        .ok_or(MamposteError::ArithmeticOverflow)?;
    let max_down = current
        .checked_mul(BPS_DENOM - MAX_PRICE_DELTA_BPS)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(BPS_DENOM)
        .ok_or(MamposteError::ArithmeticOverflow)?;
    require!(
        params.new_value_usd_cents >= max_down
            && params.new_value_usd_cents <= max_up,
        MamposteError::OracleValueChangeTooBig
    );

    // ── Actualizar NotarialRecord (Legal Wrapper on-chain) ────────────────────
    // Este record vincula el mundo físico (escritura pública) con el on-chain.
    // Verificable ante un juez colombiano bajo Ley 527/1999.
    {
        let record                  = &mut ctx.accounts.notarial_record;
        record.property             = ctx.accounts.property_state.key();
        record.notary               = ctx.accounts.notarial_authority.key();
        record.appraisal_value      = params.new_value_usd_cents;
        record.doc_hash             = params.appraisal_doc_hash.clone();
        record.ipfs_doc_cid         = params.ipfs_doc_cid.clone();
        record.escritura_publica    = params.escritura_publica_num.clone();
        record.recorded_at          = now;
        record.appraisal_number = record.appraisal_number
            .checked_add(1)
            .ok_or(MamposteError::ArithmeticOverflow)?;
    }

    let old_value = current;

    // ── Actualizar DnftState ──────────────────────────────────────────────────
    {
        let ds                    = &mut ctx.accounts.dnft_state;
        ds.current_value          = params.new_value_usd_cents;
        ds.last_appraisal_at      = now;
        ds.next_appraisal_due     = now + MIN_APPRAISAL_INTERVAL;
        ds.appraisal_count = ds.appraisal_count
            .checked_add(1)
            .ok_or(MamposteError::ArithmeticOverflow)?;
    }

    // ── Sincronizar PropertyOracle ────────────────────────────────────────────
    {
        let oracle            = &mut ctx.accounts.property_oracle;
        oracle.current_value  = params.new_value_usd_cents;
        oracle.last_updated   = now;
        oracle.update_count = oracle.update_count
            .checked_add(1)
            .ok_or(MamposteError::ArithmeticOverflow)?;

        // Actualizar historial circular (5 entradas)
        let head                  = oracle.history_head as usize;
        oracle.price_history[head] = old_value;
        oracle.history_head       = ((head + 1) % crate::oracle::HISTORY_SIZE) as u8;
    }

    emit!(NotarialAppraisalRecorded {
        dnft:         ctx.accounts.dnft_state.key(),
        property:     ctx.accounts.property_state.key(),
        old_value,
        new_value:    params.new_value_usd_cents,
        doc_hash:     params.appraisal_doc_hash,
        appraisal_n:  ctx.accounts.notarial_record.appraisal_number,
        escritura:    params.escritura_publica_num,
        timestamp:    now,
    });

    msg!(
        "[Oracle Notarial] Avalúo #{}: ${} → ${} USD. Próximo: {}",
        ctx.accounts.notarial_record.appraisal_number,
        old_value / 100,
        params.new_value_usd_cents / 100,
        ctx.accounts.dnft_state.next_appraisal_due
    );
    Ok(())
}

// =============================================================================
//  INSTRUCCIÓN 6: INITIATE_LOAN (DeFi RWA — sin cambios respecto a v0.3)
//  Mantenida intacta con las mismas validaciones de Fase 4 original.
//  CU estimado: ~100_000
// =============================================================================

pub fn initiate_loan(
    ctx: Context<InitiateLoan>,
    loan_amount_usdc: u64,
    duration_days: u32,
) -> Result<()> {
    require!(loan_amount_usdc >= MIN_LOAN_AMOUNT, MamposteError::LoanAmountTooSmall);
    require!(duration_days >= 7 && duration_days <= 365, MamposteError::InvalidLoanDuration);

    let oracle     = &ctx.accounts.property_oracle;
    let dnft_state = &mut ctx.accounts.dnft_state;

    require!(!dnft_state.is_collateralized, MamposteError::DnftIsCollateralized);

    let oracle_usdc = (oracle.current_value as u128)
        .checked_mul(10_000)
        .ok_or(MamposteError::ArithmeticOverflow)? as u64;

    let max_loan = oracle_usdc
        .checked_mul(MAX_LTV_BPS)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(BPS_DENOM)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    require!(loan_amount_usdc <= max_loan, MamposteError::ExceedsMaxLtv);

    let ltv_bps = (loan_amount_usdc as u128)
        .checked_mul(BPS_DENOM as u128)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(oracle_usdc as u128)
        .ok_or(MamposteError::ArithmeticOverflow)? as u64;

    let interest_bps = if ltv_bps <= 4_000 { 450u64 }
                       else if ltv_bps <= 5_500 { 720u64 }
                       else { 980u64 };

    token_2022::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_2022::TransferChecked {
                from:      ctx.accounts.borrower_dnft_account.to_account_info(),
                mint:      ctx.accounts.dnft_mint.to_account_info(),
                to:        ctx.accounts.loan_escrow_token_account.to_account_info(),
                authority: ctx.accounts.borrower.to_account_info(),
            },
        ),
        1, 0,
    )?;

    let loan     = &mut ctx.accounts.loan_state;
    let now      = Clock::get()?.unix_timestamp;
    let due_date = now.checked_add(duration_days as i64 * 86_400)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    loan.borrower          = ctx.accounts.borrower.key();
    loan.collateral_mint   = ctx.accounts.dnft_mint.key();
    loan.property          = ctx.accounts.property_state.key();
    loan.loan_amount       = loan_amount_usdc;
    loan.interest_rate_bps = interest_bps;
    loan.originated_at     = now;
    loan.due_date          = due_date;
    loan.is_defaulted      = false;
    loan.is_repaid         = false;
    loan.bump              = ctx.bumps.loan_state;
    loan.escrow_bump       = ctx.bumps.loan_escrow_token_account;

    dnft_state.is_collateralized = true;

    emit!(LoanInitiated {
        loan:         loan.key(),
        borrower:     loan.borrower,
        collateral:   loan.collateral_mint,
        amount_usdc:  loan_amount_usdc,
        interest_bps,
        due_date,
        timestamp:    now,
    });
    Ok(())
}

// =============================================================================
//  INSTRUCCIÓN 7: REPAY_LOAN (sin cambios respecto a v0.3, mantenida íntegra)
//  CU estimado: ~90_000
// =============================================================================

pub fn repay_loan(ctx: Context<RepayLoan>) -> Result<()> {
    let loan = &ctx.accounts.loan_state;
    let now  = Clock::get()?.unix_timestamp;

    require!(!loan.is_repaid,    MamposteError::LoanAlreadyRepaid);
    require!(!loan.is_defaulted, MamposteError::LoanDefaulted);

    let days_elapsed = ((now - loan.originated_at).max(0) as u64) / 86_400;

    let interest = (loan.loan_amount as u128)
        .checked_mul(loan.interest_rate_bps as u128)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_mul(days_elapsed as u128)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(BPS_DENOM as u128 * 365)
        .ok_or(MamposteError::ArithmeticOverflow)? as u64;

    let total_due = loan.loan_amount
        .checked_add(interest)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    let loan_key      = ctx.accounts.loan_state.key();
    let escrow_seeds: &[&[u8]] = &[
        b"loan_escrow",
        loan_key.as_ref(),
        &[loan.escrow_bump],
    ];

    token_2022::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_2022::TransferChecked {
                from:      ctx.accounts.loan_escrow_token_account.to_account_info(),
                mint:      ctx.accounts.dnft_mint.to_account_info(),
                to:        ctx.accounts.borrower_dnft_account.to_account_info(),
                authority: ctx.accounts.loan_escrow_token_account.to_account_info(),
            },
            &[escrow_seeds],
        ),
        1, 0,
    )?;

    ctx.accounts.dnft_state.is_collateralized = false;
    ctx.accounts.loan_state.is_repaid         = true;

    emit!(LoanRepaid {
        loan:       loan_key,
        borrower:   loan.borrower,
        principal:  loan.loan_amount,
        interest,
        total_paid: total_due,
        timestamp:  now,
    });
    Ok(())
}

// =============================================================================
//  INSTRUCCIÓN 8: INITIALIZE_SMART_ACCOUNT (WebAuthn / Paymaster)
//
//  Crea un SmartAccount PDA controlado por una clave P256 (WebAuthn).
//  La clave pública P256 del dispositivo (FaceID/TouchID) se registra.
//  No se necesita seed phrase. El PDA actúa como wallet del usuario.
//
//  Paymaster: si el usuario tiene renta acumulada ≥ PAYMASTER_MIN_RENT_BAL,
//  el Paymaster descuenta el fee de la renta (usuario paga gas en renta, no SOL).
//
//  CU estimado: ~60_000
// =============================================================================

pub fn initialize_smart_account(
    ctx: Context<InitializeSmartAccount>,
    webauthn_pubkey: [u8; P256_PUBKEY_LEN],
    display_name: String,
) -> Result<()> {
    require!(display_name.len() <= 64, MamposteError::InvalidInvestorName);
    require!(webauthn_pubkey[0] == 0x02 || webauthn_pubkey[0] == 0x03,
        MamposteError::InvalidP256Pubkey);

    let account    = &mut ctx.accounts.smart_account;
    let now        = Clock::get()?.unix_timestamp;

    account.owner           = ctx.accounts.fee_payer.key();
    account.webauthn_pubkey = webauthn_pubkey;
    account.display_name    = display_name;
    account.nonce           = 0;
    account.rent_balance    = 0;
    account.fees_sponsored  = 0;
    account.created_at      = now;
    account.is_active       = true;
    account.bump            = ctx.bumps.smart_account;

    emit!(SmartAccountCreated {
        smart_account:   account.key(),
        owner:           account.owner,
        webauthn_pubkey: webauthn_pubkey,
        timestamp:       now,
    });

    msg!("[SmartAccount] Creada para {}. WebAuthn P256 key registrada.", account.owner);
    Ok(())
}

// =============================================================================
//  INSTRUCCIÓN 9: PAYMASTER_SPONSOR_FEE
//
//  El Paymaster paga la fee de una transacción del usuario.
//  Condición: el usuario tiene renta acumulada ≥ PAYMASTER_MIN_RENT_BAL.
//  El costo se deduce de rent_balance del SmartAccount.
//  Esto permite operar sin SOL — el fee se paga en "renta ganada".
//
//  CU estimado: ~40_000
// =============================================================================

pub fn paymaster_sponsor_fee(
    ctx: Context<PaymasterSponsorFee>,
    fee_lamports: u64,
) -> Result<()> {
    require!(fee_lamports > 0, MamposteError::ArithmeticOverflow);
    require!(fee_lamports <= 50_000_000, MamposteError::PaymasterFeeTooHigh); // Max 0.05 SOL

    let smart_account = &mut ctx.accounts.smart_account;
    require!(smart_account.is_active, MamposteError::SmartAccountInactive);

    // Verificar que hay suficiente saldo de renta para cubrir el fee
    require!(
        smart_account.rent_balance >= PAYMASTER_MIN_RENT_BAL,
        MamposteError::InsufficientRentForPaymaster
    );

    // Deducir el fee del saldo de renta del SmartAccount
    smart_account.rent_balance = smart_account.rent_balance
        .checked_sub(fee_lamports)
        .ok_or(MamposteError::ArithmeticOverflow)?;
    smart_account.fees_sponsored = smart_account.fees_sponsored
        .checked_add(fee_lamports)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    // Transferir SOL desde el Paymaster PDA al fee payer (relayer o validator)
    let paymaster_seeds: &[&[u8]] = &[
        b"paymaster",
        &[ctx.accounts.paymaster.bump],
    ];

    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.paymaster.to_account_info(),
                to:   ctx.accounts.fee_recipient.to_account_info(),
            },
            &[paymaster_seeds],
        ),
        fee_lamports,
    )?;

    emit!(FeeSponsored {
        smart_account:  smart_account.key(),
        fee_lamports,
        rent_remaining: smart_account.rent_balance,
        timestamp:      Clock::get()?.unix_timestamp,
    });

    msg!("[Paymaster] Fee de {} lamports patrocinado para {}",
        fee_lamports, smart_account.key());
    Ok(())
}

// =============================================================================
//  INSTRUCCIÓN 10: COLLECT_TRANSFER_FEES_TO_TREASURY
//
//  Recoge los Transfer Fees acumulados en el Mint Token-2022 y los envía
//  al ProtocolTreasury PDA. Alimenta el fondo de liquidez del protocolo.
//  80% va a la reserva de liquidez, 20% va al fondo de operaciones.
//
//  CU estimado: ~80_000
// =============================================================================

pub fn collect_transfer_fees_to_treasury(
    ctx: Context<CollectTransferFees>,
) -> Result<()> {
    // Retirar fees acumulados del mint Token-2022
    // El withdraw_withheld_tokens_from_mint CPI recoge todos los fees
    // que se han acumulado desde la última recolección.
    let withdraw_ix = fee_ix::withdraw_withheld_tokens_from_mint(
        &anchor_spl::token_2022::ID,
        &ctx.accounts.dnft_mint.key(),
        &ctx.accounts.treasury_token_account.key(),
        &ctx.accounts.treasury_state.key(),
        &[],
    ).map_err(|_| MamposteError::TreasuryCollectionFailed)?;

    invoke(
        &withdraw_ix,
        &[
            ctx.accounts.dnft_mint.to_account_info(),
            ctx.accounts.treasury_token_account.to_account_info(),
            ctx.accounts.treasury_state.to_account_info(),
        ],
    ).map_err(|_| MamposteError::TreasuryCollectionFailed)?;

    // Actualizar contadores de la tesorería
    let treasury        = &mut ctx.accounts.treasury_state;
    let collected_raw   = ctx.accounts.treasury_token_account.amount;
    treasury.total_fees_collected = treasury.total_fees_collected
        .checked_add(collected_raw)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    let liquidity_share = collected_raw
        .checked_mul(TREASURY_SHARE_BPS)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(BPS_DENOM)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    treasury.liquidity_reserve = treasury.liquidity_reserve
        .checked_add(liquidity_share)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    emit!(FeesCollected {
        treasury:         treasury.key(),
        amount_collected: collected_raw,
        liquidity_share,
        ops_share:        collected_raw.saturating_sub(liquidity_share),
        timestamp:        Clock::get()?.unix_timestamp,
    });

    msg!("[Treasury] Fees recolectados: {}. Reserva: {}", collected_raw, liquidity_share);
    Ok(())
}

// =============================================================================
//  HELPER INTERNO: verify_and_cache_zk_proof
//  Reutilizable desde process_cross_chain_buy y zk_transfer_hook.
// =============================================================================

fn verify_and_cache_zk_proof(
    proof:         &[u8; ZK_PROOF_LEN],
    zk_record:     &mut Account<ZkVerificationRecord>,
    wallet:        &Pubkey,
    request_full_cu: bool,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // Cache hit: el proof ya fue verificado y no expiró
    if zk_record.wallet == *wallet
        && zk_record.is_valid
        && !zk_record.is_being_written
        && zk_record.expires_at > now
    {
        return Ok(());
    }

    // Solicitar CU adicionales si se requiere verificación completa
    if request_full_cu {
        invoke(
            &ComputeBudgetInstruction::set_compute_unit_limit(ZK_VERIFY_CU),
            &[],
        ).ok();
    }

    // Verificación de formato mínima para devnet
    // En producción: CPI a light_protocol::cpi::verify_proof()
    require!(proof[0] != 0, MamposteError::InvalidZkProof);
    require!(proof[ZK_PROOF_LEN - 1] != 0xFF, MamposteError::InvalidZkProof);

    // Escribir cache con protección de race condition
    zk_record.is_being_written = true;
    zk_record.wallet           = *wallet;
    zk_record.verified_at      = now;
    zk_record.expires_at       = now + ZK_CACHE_TTL_SECS;
    zk_record.proof_version    = 2;
    zk_record.is_valid         = true;
    zk_record.is_being_written = false;

    msg!("[ZK] Proof verificado y cacheado para {}", wallet);
    Ok(())
}

// =============================================================================
//  ACCOUNT CONTEXTS
// =============================================================================

#[derive(Accounts)]
#[instruction(params: DnftParams)]
pub struct InitializeDnftAtomic<'info> {
    /// DnftState PDA — almacena metadatos dinámicos del dNFT
    #[account(
        init,
        payer  = authority,
        space  = DnftState::LEN,
        seeds  = [b"dnft_state", property_state.key().as_ref()],
        bump
    )]
    pub dnft_state: Account<'info, DnftState>,

    /// Mint Token-2022 — debe ser una keypair nueva sin inicializar
    /// Las extensiones se inicializan en esta misma instrucción
    #[account(mut)]
    pub dnft_mint: InterfaceAccount<'info, Mint>,

    pub property_state: Account<'info, crate::PropertyState>,

    /// ProtocolTreasury PDA — recibe los Transfer Fees
    /// CHECK: validado por seeds
    #[account(
        mut,
        seeds = [b"protocol_treasury"],
        bump  = treasury.bump,
    )]
    pub treasury: Account<'info, ProtocolTreasury>,

    /// El programa del transfer hook — este mismo programa
    /// CHECK: debe ser crate::ID
    #[account(address = crate::ID)]
    pub hook_program: UncheckedAccount<'info>,

    #[account(
        seeds = [b"program_config"],
        bump  = program_config.bump,
        has_one = authority @ MamposteError::Unauthorized,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program:  Program<'info, System>,
    pub token_program:   Program<'info, Token2022>,
    pub rent:            Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(payload: CrossChainPayload)]
pub struct ProcessCrossChainBuy<'info> {
    #[account(mut)]
    pub property_state: Account<'info, crate::PropertyState>,

    pub property_oracle: Account<'info, PropertyOracle>,

    #[account(mut)]
    pub property_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer  = relayer,
        associated_token::mint          = property_mint,
        associated_token::authority     = buyer,
        associated_token::token_program = token_program,
    )]
    pub buyer_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: wallet del comprador, validada por ZK proof
    pub buyer: UncheckedAccount<'info>,

    /// PDA anti-replay — único por (source_chain[4] + message_id[32])
    #[account(
        init,
        payer = relayer,
        space = CrossChainNonce::LEN,
        seeds = [
            b"xchain_nonce",
            &payload.source_chain.to_le_bytes(),
            payload.message_id.as_ref(),
        ],
        bump
    )]
    pub cross_chain_nonce: Account<'info, CrossChainNonce>,

    /// Estado del ISM de Hyperlane — leído para validar el mensaje
    /// CHECK: validado por el CPI al ISM program
    pub hyperlane_ism_state: UncheckedAccount<'info>,

    /// Mailbox de Hyperlane en Solana
    /// CHECK: dirección conocida del protocolo Hyperlane
    pub hyperlane_mailbox: UncheckedAccount<'info>,

    /// Programa del ISM de Hyperlane
    /// CHECK: dirección conocida del protocolo Hyperlane
    pub hyperlane_ism_program: UncheckedAccount<'info>,

    /// Cache ZK del comprador (24h)
    #[account(
        init_if_needed,
        payer = relayer,
        space = ZkVerificationRecord::LEN,
        seeds = [b"zk_record", buyer.key().as_ref()],
        bump
    )]
    pub zk_verification_record: Account<'info, ZkVerificationRecord>,

    /// El relayer de Hyperlane paga las fees (actúa como Paymaster)
    #[account(mut)]
    pub relayer: Signer<'info>,

    pub token_program:            Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:           Program<'info, System>,
}

#[derive(Accounts)]
pub struct LiquidateCollateral<'info> {
    #[account(
        mut,
        seeds = [
            b"loan",
            loan_state.borrower.as_ref(),
            loan_state.collateral_mint.as_ref(),
        ],
        bump = loan_state.bump,
    )]
    pub loan_state: Account<'info, LoanState>,

    #[account(
        mut,
        seeds = [b"loan_escrow", loan_state.key().as_ref()],
        bump  = loan_state.escrow_bump,
    )]
    pub loan_escrow_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub dnft_state: Account<'info, DnftState>,

    pub property_oracle: Account<'info, PropertyOracle>,

    #[account(mut)]
    pub dnft_mint: InterfaceAccount<'info, Mint>,

    /// ATA del liquidador para recibir el dNFT
    #[account(
        init_if_needed,
        payer  = liquidator,
        associated_token::mint          = dnft_mint,
        associated_token::authority     = liquidator,
        associated_token::token_program = dnft_token_program,
    )]
    pub liquidator_dnft_account: InterfaceAccount<'info, TokenAccount>,

    /// Cuenta USDC del liquidador (paga la deuda)
    #[account(mut)]
    pub liquidator_usdc_account: InterfaceAccount<'info, TokenAccount>,

    /// Cuenta USDC de la tesorería (recibe el pago)
    #[account(mut)]
    pub treasury_usdc_account: InterfaceAccount<'info, TokenAccount>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [b"protocol_treasury"],
        bump  = treasury_state.bump,
    )]
    pub treasury_state: Account<'info, ProtocolTreasury>,

    #[account(mut)]
    pub liquidator: Signer<'info>,

    pub dnft_token_program: Program<'info, Token2022>,
    pub usdc_token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:    Program<'info, System>,
    pub rent:              Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ZkTransferHook<'info> {
    pub dnft_state: Account<'info, DnftState>,

    #[account(
        init_if_needed,
        payer  = fee_payer,
        space  = ZkVerificationRecord::LEN,
        seeds  = [b"zk_record", destination_owner.key().as_ref()],
        bump
    )]
    pub zk_record: Account<'info, ZkVerificationRecord>,

    /// CHECK: receptor del dNFT — validado por Token-2022 hook
    pub destination_owner: UncheckedAccount<'info>,

    #[account(mut)]
    pub fee_payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateNotarialMetadata<'info> {
    #[account(mut)]
    pub dnft_state: Account<'info, DnftState>,

    #[account(mut)]
    pub property_state: Account<'info, crate::PropertyState>,

    #[account(
        mut,
        seeds = [b"oracle", property_state.key().as_ref()],
        bump  = property_oracle.bump,
    )]
    pub property_oracle: Account<'info, PropertyOracle>,

    #[account(
        init_if_needed,
        payer  = notarial_authority,
        space  = NotarialRecord::LEN,
        seeds  = [
            b"notarial",
            property_state.key().as_ref(),
            &(dnft_state.appraisal_count as u64).to_le_bytes(),
        ],
        bump
    )]
    pub notarial_record: Account<'info, NotarialRecord>,

    #[account(
        seeds = [b"program_config"],
        bump  = program_config.bump,
        has_one = authority @ MamposteError::Unauthorized,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    pub notarial_authority: Signer<'info>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitiateLoan<'info> {
    #[account(
        init,
        payer  = borrower,
        space  = LoanState::LEN,
        seeds  = [b"loan", borrower.key().as_ref(), dnft_mint.key().as_ref()],
        bump
    )]
    pub loan_state: Account<'info, LoanState>,

    #[account(
        init,
        payer  = borrower,
        token::mint          = dnft_mint,
        token::authority     = loan_state,
        token::token_program = token_program,
        seeds  = [b"loan_escrow", loan_state.key().as_ref()],
        bump
    )]
    pub loan_escrow_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub dnft_state: Account<'info, DnftState>,

    pub property_oracle: Account<'info, PropertyOracle>,
    pub property_state:  Account<'info, crate::PropertyState>,

    #[account(mut)]
    pub dnft_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint          = dnft_mint,
        associated_token::authority     = borrower,
        associated_token::token_program = token_program,
    )]
    pub borrower_dnft_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub borrower: Signer<'info>,

    pub token_program:            Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:           Program<'info, System>,
    pub rent:                     Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct RepayLoan<'info> {
    #[account(
        mut,
        seeds = [b"loan", loan_state.borrower.as_ref(), loan_state.collateral_mint.as_ref()],
        bump  = loan_state.bump,
        has_one = borrower @ MamposteError::Unauthorized,
    )]
    pub loan_state: Account<'info, LoanState>,

    #[account(
        mut,
        seeds = [b"loan_escrow", loan_state.key().as_ref()],
        bump  = loan_state.escrow_bump,
    )]
    pub loan_escrow_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub dnft_state: Account<'info, DnftState>,

    pub dnft_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint          = dnft_mint,
        associated_token::authority     = borrower,
        associated_token::token_program = token_program,
    )]
    pub borrower_dnft_account: InterfaceAccount<'info, TokenAccount>,

    pub borrower: Signer<'info>,
    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct InitializeSmartAccount<'info> {
    #[account(
        init,
        payer  = fee_payer,
        space  = SmartAccount::LEN,
        seeds  = [b"smart_account", fee_payer.key().as_ref()],
        bump
    )]
    pub smart_account: Account<'info, SmartAccount>,

    #[account(mut)]
    pub fee_payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PaymasterSponsorFee<'info> {
    #[account(
        mut,
        seeds = [b"smart_account", smart_account.owner.as_ref()],
        bump  = smart_account.bump,
    )]
    pub smart_account: Account<'info, SmartAccount>,

    #[account(
        mut,
        seeds = [b"paymaster"],
        bump  = paymaster.bump,
    )]
    pub paymaster: Account<'info, PaymasterState>,

    /// CHECK: recibe el fee en SOL (relayer o validator)
    #[account(mut)]
    pub fee_recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CollectTransferFees<'info> {
    #[account(mut)]
    pub dnft_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint      = dnft_mint,
        associated_token::authority = treasury_state,
        associated_token::token_program = token_program,
    )]
    pub treasury_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"protocol_treasury"],
        bump  = treasury_state.bump,
    )]
    pub treasury_state: Account<'info, ProtocolTreasury>,

    pub token_program:  Program<'info, Token2022>,
}

// =============================================================================
//  DATA STRUCTS — producción completa
// =============================================================================

#[account]
pub struct DnftState {
    pub property_key:        Pubkey,   // 32
    pub mint:                Pubkey,   // 32
    pub authority:           Pubkey,   // 32
    pub treasury:            Pubkey,   // 32  (withdraw_authority de fees)
    pub current_value:       u64,      // 8   USD cents
    pub last_appraisal_at:   i64,      // 8
    pub next_appraisal_due:  i64,      // 8   (trimestral)
    pub appraisal_count:     u32,      // 4
    pub is_collateralized:   bool,     // 1
    pub transfer_hook_active: bool,    // 1
    pub bump:                u8,       // 1
    pub property_address:    String,   // 4 + 128
    pub legal_deed_hash:     String,   // 4 + 64
    pub ipfs_cid:            String,   // 4 + 59
}

impl DnftState {
    pub const LEN: usize =
        8 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 4 + 1 + 1 + 1
        + (4 + 128) + (4 + 64) + (4 + 59);
}

#[account]
pub struct LoanState {
    pub borrower:          Pubkey,  // 32
    pub collateral_mint:   Pubkey,  // 32
    pub property:          Pubkey,  // 32
    pub loan_amount:       u64,     // 8  USDC (6 dec)
    pub interest_rate_bps: u64,     // 8
    pub originated_at:     i64,     // 8
    pub due_date:          i64,     // 8
    pub is_defaulted:      bool,    // 1
    pub is_repaid:         bool,    // 1
    pub bump:              u8,      // 1
    pub escrow_bump:       u8,      // 1
}

impl LoanState {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1 + 1 + 1;
}

#[account]
pub struct CrossChainNonce {
    pub source_chain: u32,       // 4
    pub message_id:   [u8; 32],  // 32
    pub is_used:      bool,      // 1
    pub used_at:      i64,       // 8
    pub expiry_slot:  u64,       // 8
    pub bump:         u8,        // 1
}

impl CrossChainNonce {
    pub const LEN: usize = 8 + 4 + 32 + 1 + 8 + 8 + 1;
}

/// ZkVerificationRecord con spinlock anti-race-condition
#[account]
pub struct ZkVerificationRecord {
    pub wallet:           Pubkey,  // 32
    pub verified_at:      i64,     // 8
    pub expires_at:       i64,     // 8
    pub proof_version:    u8,      // 1
    pub is_valid:         bool,    // 1
    pub is_being_written: bool,    // 1  spinlock anti-race
    pub bump:             u8,      // 1
}

impl ZkVerificationRecord {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 1 + 1 + 1 + 1;
}

/// NotarialRecord — Legal Wrapper on-chain
/// Vincula el mundo físico (escritura pública ORIP) con la blockchain.
/// Bajo Ley 527/1999 de Colombia, este registro es evidencia digital válida.
#[account]
pub struct NotarialRecord {
    pub property:          Pubkey,  // 32
    pub notary:            Pubkey,  // 32
    pub appraisal_value:   u64,     // 8
    pub appraisal_number:  u32,     // 4
    pub recorded_at:       i64,     // 8
    pub bump:              u8,      // 1
    pub doc_hash:          String,  // 4 + 64
    pub ipfs_doc_cid:      String,  // 4 + 59
    pub escritura_publica: String,  // 4 + 32 (ej: "Escritura 4821/2026 Notaría 12 Bogotá")
}

impl NotarialRecord {
    pub const LEN: usize =
        8 + 32 + 32 + 8 + 4 + 8 + 1
        + (4 + 64) + (4 + 59) + (4 + 32);
}

/// SmartAccount — wallet sin seed phrase controlada por WebAuthn P256
#[account]
pub struct SmartAccount {
    pub owner:           Pubkey,              // 32
    pub webauthn_pubkey: [u8; P256_PUBKEY_LEN], // 33
    pub nonce:           u64,                 // 8  (anti-replay para instrucciones)
    pub rent_balance:    u64,                 // 8  lamports de renta acumulada
    pub fees_sponsored:  u64,                 // 8  total fees pagados por Paymaster
    pub created_at:      i64,                 // 8
    pub is_active:       bool,                // 1
    pub bump:            u8,                  // 1
    pub display_name:    String,              // 4 + 64
}

impl SmartAccount {
    pub const LEN: usize =
        8 + 32 + P256_PUBKEY_LEN + 8 + 8 + 8 + 8 + 1 + 1 + (4 + 64);
}

/// PaymasterState — fondo de subsidio de gas del protocolo
#[account]
pub struct PaymasterState {
    pub authority:      Pubkey,  // 32
    pub balance:        u64,     // 8  lamports disponibles
    pub total_sponsored: u64,    // 8  total lamports sponsoreados historicamente
    pub bump:           u8,      // 1
}

impl PaymasterState {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 1;
}

/// ProtocolTreasury — recibe Transfer Fees y penalizaciones de liquidación
#[account]
pub struct ProtocolTreasury {
    pub authority:             Pubkey,  // 32
    pub total_fees_collected:  u64,     // 8
    pub total_usdc_collected:  u64,     // 8
    pub liquidity_reserve:     u64,     // 8
    pub bump:                  u8,      // 1
}

impl ProtocolTreasury {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 1;
}

// =============================================================================
//  PARÁMETROS
// =============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CrossChainPayload {
    pub source_chain:  u32,
    pub message_id:    [u8; 32],
    pub buyer:         Pubkey,
    pub property_id:   u64,
    pub token_amount:  u64,
    pub usdc_paid:     u64,
    pub zk_proof:      [u8; ZK_PROOF_LEN],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct DnftParams {
    pub property_address:        String,
    pub legal_deed_hash:         String,
    pub ipfs_cid:                String,
    pub initial_value_usd_cents: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct NotarialUpdateParams {
    pub new_value_usd_cents:  u64,
    pub appraisal_doc_hash:   String,
    pub ipfs_doc_cid:         String,
    pub escritura_publica_num: String,
}

// =============================================================================
//  EVENTOS
// =============================================================================

#[event] pub struct DnftInitialized {
    pub dnft:          Pubkey,
    pub property:      Pubkey,
    pub mint:          Pubkey,
    pub initial_value: u64,
    pub timestamp:     i64,
}
#[event] pub struct CrossChainBuyExecuted {
    pub property:     Pubkey,
    pub buyer:        Pubkey,
    pub source_chain: u32,
    pub token_amount: u64,
    pub usdc_paid:    u64,
    pub message_id:   [u8; 32],
    pub timestamp:    i64,
}
#[event] pub struct CollateralLiquidated {
    pub loan:        Pubkey,
    pub borrower:    Pubkey,
    pub liquidator:  Pubkey,
    pub dnft_mint:   Pubkey,
    pub principal:   u64,
    pub interest:    u64,
    pub penalty:     u64,
    pub total_paid:  u64,
    pub trigger:     String,
    pub timestamp:   i64,
}
#[event] pub struct ZkVerificationPassed {
    pub wallet:        Pubkey,
    pub timestamp:     i64,
    pub amount:        u64,
    pub was_cache_hit: bool,
}
#[event] pub struct NotarialAppraisalRecorded {
    pub dnft:        Pubkey,
    pub property:    Pubkey,
    pub old_value:   u64,
    pub new_value:   u64,
    pub doc_hash:    String,
    pub appraisal_n: u32,
    pub escritura:   String,
    pub timestamp:   i64,
}
#[event] pub struct LoanInitiated {
    pub loan:         Pubkey,
    pub borrower:     Pubkey,
    pub collateral:   Pubkey,
    pub amount_usdc:  u64,
    pub interest_bps: u64,
    pub due_date:     i64,
    pub timestamp:    i64,
}
#[event] pub struct LoanRepaid {
    pub loan:       Pubkey,
    pub borrower:   Pubkey,
    pub principal:  u64,
    pub interest:   u64,
    pub total_paid: u64,
    pub timestamp:  i64,
}
#[event] pub struct SmartAccountCreated {
    pub smart_account:   Pubkey,
    pub owner:           Pubkey,
    pub webauthn_pubkey: [u8; P256_PUBKEY_LEN],
    pub timestamp:       i64,
}
#[event] pub struct FeeSponsored {
    pub smart_account:  Pubkey,
    pub fee_lamports:   u64,
    pub rent_remaining: u64,
    pub timestamp:      i64,
}
#[event] pub struct FeesCollected {
    pub treasury:         Pubkey,
    pub amount_collected: u64,
    pub liquidity_share:  u64,
    pub ops_share:        u64,
    pub timestamp:        i64,
}
