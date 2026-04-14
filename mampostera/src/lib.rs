// =============================================================================
//  MAMPOSTERA — Real Estate RWA Platform on Solana
//  Version : 0.5.4  |  Phase4 : 2026-04
//  Fase 0: Seguridad pre-mainnet (Timelock 48h · Multisig Squads 3/5)
//  Fase 1: Core · Distribución · Seguridad aritmética
//  Fase 2: KYC on-chain · Mercado secundario P2P
//  Fase 3: Gobernanza DAO · Oracle de valuación
//  Fase 4: AppChain soberana · dNFT Token-2022 · ZK · Cross-chain · DeFi
// =============================================================================

// ─── Módulos de Fase 2 (no modifican Fase 1) ─────────────────────────────────
pub mod errors;
pub mod kyc;
pub mod market;

// ─── Módulos de Fase 3 (no modifican Fases 1 y 2) ────────────────────────────
pub mod governance;
pub mod oracle;

// ─── Módulo de Fase 4 — AppChain soberana ────────────────────────────────────
pub mod appchain;

// ─── Módulos de Fase 0 — Seguridad pre-mainnet ────────────────────────────────
pub mod upgrades {
    pub mod security;
    pub mod oracle_v2;
    pub mod proof_of_reserve;
    pub mod liquidity;
    pub mod mamp_token;   // R10: ve-tokenomics MAMP
    pub mod compressed;   // R15: Light Protocol compressed accounts
}

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount},
};

// Re-exportar errores desde módulo centralizado
pub use errors::MamposteError;
// Re-exportar tipos KYC que usa mint_fractional_tokens
use kyc::{InvestorProfile, KycStatus};

declare_id!("MAMPoSTERAv2222222222222222222222222222222");

// ─── Constantes de seguridad ─────────────────────────────────────────────────

/// Supply mínimo: 1 token (con 6 decimales = 0.000001 unidades)
pub const MIN_TOKEN_SUPPLY: u64 = 1;
/// Supply máximo por propiedad: 100 millones de tokens
pub const MAX_TOKEN_SUPPLY: u64 = 100_000_000 * 1_000_000; // con 6 dec
/// Valor mínimo de propiedad: $100 USD en centavos
pub const MIN_PROPERTY_VALUE: u64 = 10_000;
/// Valor máximo de propiedad: $100 millones USD en centavos
pub const MAX_PROPERTY_VALUE: u64 = 10_000_000_000;
/// Mínimo de tokens que puede comprar un inversor en una sola tx
pub const MIN_INVESTMENT_TOKENS: u64 = 1_000_000; // 1 token con 6 dec
/// Renta mínima por depósito: 0.001 SOL
pub const MIN_RENT_DEPOSIT: u64 = 1_000_000; // lamports
/// Longitud exacta de un hash SHA-256 en hex
pub const SHA256_HEX_LEN: usize = 64;
/// Rango válido de un CIDv0 de IPFS (Qm... = 46 chars) o CIDv1
pub const IPFS_CID_MIN_LEN: usize = 46;
pub const IPFS_CID_MAX_LEN: usize = 59;
/// Longitud máxima de la ubicación
pub const MAX_LOCATION_LEN: usize = 128;

// =============================================================================
//  PROGRAMA
// =============================================================================

#[program]
pub mod mampostera {
    use super::*;

    // ─────────────────────────────────────────────────────────────────────────
    // 1. INITIALIZE_PROPERTY
    //
    //    Seguridad aplicada:
    //    - property_id (u64) como seed en lugar de String variable →
    //      seeds deterministas, inmunes a colisiones por encoding.
    //    - Vault bump almacenado en PropertyState → evita re-derivación
    //      costosa y posibles grietas en bump canonicalization.
    //    - Validaciones de rango en todos los parámetros numéricos.
    //    - Hash SHA-256 y CID IPFS con longitudes verificadas.
    //    - overflow-safe con checked_* + ok_or() en lugar de unwrap().
    // ─────────────────────────────────────────────────────────────────────────
    pub fn initialize_property(
        ctx: Context<InitializeProperty>,
        params: InitPropertyParams,
    ) -> Result<()> {
        // ── Validaciones de entrada ──────────────────────────────────────────
        require!(
            params.total_value >= MIN_PROPERTY_VALUE
                && params.total_value <= MAX_PROPERTY_VALUE,
            MamposteError::InvalidPropertyValue
        );
        require!(
            params.total_tokens >= MIN_TOKEN_SUPPLY
                && params.total_tokens <= MAX_TOKEN_SUPPLY,
            MamposteError::InvalidTokenSupply
        );
        require!(
            !params.location.is_empty() && params.location.len() <= MAX_LOCATION_LEN,
            MamposteError::LocationTooLong
        );
        require!(
            params.legal_doc_hash.len() == SHA256_HEX_LEN
                && params.legal_doc_hash.chars().all(|c| c.is_ascii_hexdigit()),
            MamposteError::InvalidDocHash
        );
        require!(
            params.ipfs_cid.len() >= IPFS_CID_MIN_LEN
                && params.ipfs_cid.len() <= IPFS_CID_MAX_LEN,
            MamposteError::InvalidIpfsCid
        );

        let property   = &mut ctx.accounts.property_state;
        let vault_bump = ctx.bumps.rent_vault; // guardamos el bump del vault

        property.authority        = ctx.accounts.authority.key();
        property.mint             = ctx.accounts.property_mint.key();
        property.property_id      = params.property_id;
        property.location         = params.location;
        property.total_value      = params.total_value;
        property.total_tokens     = params.total_tokens;
        property.tokens_issued    = 0;
        property.collected_rent   = 0;
        property.distributed_rent = 0;
        property.legal_doc_hash   = params.legal_doc_hash;
        property.ipfs_cid         = params.ipfs_cid;
        property.is_active        = true;
        property.is_rent_locked   = false;
        property.bump             = ctx.bumps.property_state;
        property.vault_bump       = vault_bump;
        property.mint_bump        = ctx.bumps.property_mint;
        property.distribution_epoch = 0;

        emit!(PropertyInitialized {
            property:     property.key(),
            authority:    property.authority,
            property_id:  property.property_id,
            location:     property.location.clone(),
            total_value:  property.total_value,
            total_tokens: property.total_tokens,
            timestamp:    Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. MINT_FRACTIONAL_TOKENS
    //
    //    Seguridad aplicada:
    //    - checked_add con ok_or() — nunca panic, retorna error controlado.
    //    - Validación de monto mínimo por inversión.
    //    - Authority verificada por constraint has_one en el struct.
    //    - PDA signer con seeds fijos (property_id u64).
    // ─────────────────────────────────────────────────────────────────────────
    pub fn mint_fractional_tokens(
        ctx: Context<MintFractionalTokens>,
        amount: u64,
    ) -> Result<()> {
        require!(amount >= MIN_INVESTMENT_TOKENS, MamposteError::BelowMinimumInvestment);

        let property = &mut ctx.accounts.property_state;

        require!(property.is_active, MamposteError::PropertyInactive);

        // ── FASE 2a: KYC — bloquea inversores sin aprobación ─────────────────
        kyc::require_kyc_approved(&ctx.accounts.investor_kyc)?;

        // FIX CRÍTICO: checked_add con error en lugar de unwrap
        let new_issued = property
            .tokens_issued
            .checked_add(amount)
            .ok_or(MamposteError::ArithmeticOverflow)?;

        require!(new_issued <= property.total_tokens, MamposteError::ExceedsTokenSupply);

        // Seeds fijos con property_id u64 (no String variable)
        let pid_bytes = property.property_id.to_le_bytes();
        let seeds: &[&[u8]] = &[
            b"property",
            property.authority.as_ref(),
            pid_bytes.as_ref(),
            &[property.bump],
        ];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint:      ctx.accounts.property_mint.to_account_info(),
                    to:        ctx.accounts.investor_token_account.to_account_info(),
                    authority: ctx.accounts.property_state.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        // FIX CRÍTICO: usar new_issued ya calculado, no recalcular
        property.tokens_issued = new_issued;

        emit!(TokensMinted {
            property:     ctx.accounts.property_state.key(),
            investor:     ctx.accounts.investor.key(),
            amount,
            total_issued: property.tokens_issued,
            timestamp:    Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. DEPOSIT_RENT
    //
    //    Seguridad aplicada:
    //    - Monto mínimo de 0.001 SOL para evitar spam de micro-depósitos.
    //    - is_rent_locked flag para prevenir depósitos durante distribución.
    //    - checked_add con error controlado.
    //    - Vault PDA con bump almacenado en PropertyState.
    // ─────────────────────────────────────────────────────────────────────────
    pub fn deposit_rent(ctx: Context<DepositRent>, amount_lamports: u64) -> Result<()> {
        require!(amount_lamports >= MIN_RENT_DEPOSIT, MamposteError::RentDepositTooSmall);

        let property = &ctx.accounts.property_state;

        require!(property.is_active, MamposteError::PropertyInactive);
        require!(!property.is_rent_locked, MamposteError::RentDistributionInProgress);

        // Transferir SOL del depositor al vault PDA
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.depositor.to_account_info(),
                    to:   ctx.accounts.rent_vault.to_account_info(),
                },
            ),
            amount_lamports,
        )?;

        // FIX CRÍTICO: checked_add con error en lugar de unwrap
        ctx.accounts.property_state.collected_rent = ctx
            .accounts
            .property_state
            .collected_rent
            .checked_add(amount_lamports)
            .ok_or(MamposteError::ArithmeticOverflow)?;

        emit!(RentDeposited {
            property:        ctx.accounts.property_state.key(),
            depositor:       ctx.accounts.depositor.key(),
            amount_lamports,
            total_collected: ctx.accounts.property_state.collected_rent,
            timestamp:       Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. START_DISTRIBUTION
    //
    //    Nueva instrucción que bloquea el vault antes de distribuir.
    //    Seguridad: previene depósitos mientras se distribuye (re-entrancy).
    //    Solo la authority puede iniciar una distribución.
    //    Snapshot del total a distribuir al momento del inicio.
    // ─────────────────────────────────────────────────────────────────────────
    pub fn start_distribution(ctx: Context<StartDistribution>) -> Result<()> {
        let property = &mut ctx.accounts.property_state;

        require!(property.is_active, MamposteError::PropertyInactive);
        require!(!property.is_rent_locked, MamposteError::RentDistributionInProgress);
        require!(property.collected_rent > 0, MamposteError::NoRentToDistribute);
        require!(property.tokens_issued > 0, MamposteError::NoTokensIssued);

        // Snapshot: cuánto hay disponible en esta época de distribución
        property.rent_snapshot = property.collected_rent;
        property.is_rent_locked = true;
        property.distribution_epoch = property
            .distribution_epoch
            .checked_add(1)
            .ok_or(MamposteError::ArithmeticOverflow)?;

        emit!(DistributionStarted {
            property:           property.key(),
            epoch:              property.distribution_epoch,
            rent_snapshot:      property.rent_snapshot,
            tokens_at_snapshot: property.tokens_issued,
            timestamp:          Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. CLAIM_RENT
    //
    //    FIX CRÍTICO — Re-entrancy guard:
    //    Antes: distribute_rent podía llamarse múltiples veces por el mismo
    //    inversor en la misma época robando fondos del vault.
    //    Ahora: InvestorClaim PDA registra si el inversor ya cobró en esta
    //    época. Segundo intento → error ClaimAlreadyProcessed.
    //
    //    Seguridad adicional:
    //    - Cálculo con u128 para evitar overflow en multiplicación.
    //    - Vault PDA signer con bump almacenado (no re-derivado).
    //    - checked_sub con error controlado.
    //    - Validación cruzada: investor en token account = investor en claim.
    // ─────────────────────────────────────────────────────────────────────────
    pub fn claim_rent(ctx: Context<ClaimRent>) -> Result<()> {
        let property = &ctx.accounts.property_state;

        require!(property.is_rent_locked, MamposteError::NoActiveDistribution);

        // ── Re-entrancy guard ─────────────────────────────────────────────────
        let claim = &mut ctx.accounts.investor_claim;

        require!(
            claim.last_epoch_claimed < property.distribution_epoch,
            MamposteError::ClaimAlreadyProcessed
        );

        // ── Cálculo proporcional con u128 ─────────────────────────────────────
        let investor_balance = ctx.accounts.investor_token_account.amount;
        require!(investor_balance > 0, MamposteError::InvestorHasNoTokens);

        // share = (investor_tokens × rent_snapshot) / total_tokens
        // Usamos u128 para evitar overflow en la multiplicación
        let share_lamports = (investor_balance as u128)
            .checked_mul(property.rent_snapshot as u128)
            .ok_or(MamposteError::ArithmeticOverflow)?
            .checked_div(property.total_tokens as u128)
            .ok_or(MamposteError::ArithmeticOverflow)? as u64;

        require!(share_lamports > 0, MamposteError::ShareTooSmall);

        // ── Transferir desde vault PDA usando bump almacenado ─────────────────
        let property_key = property.key();
        let vault_seeds: &[&[u8]] = &[
            b"rent_vault",
            property_key.as_ref(),
            &[property.vault_bump],
        ];

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.rent_vault.to_account_info(),
                    to:   ctx.accounts.investor.to_account_info(),
                },
                &[vault_seeds],
            ),
            share_lamports,
        )?;

        // ── Actualizar estado ─────────────────────────────────────────────────
        // Marcar esta época como reclamada para este inversor
        claim.investor            = ctx.accounts.investor.key();
        claim.property            = property_key;
        claim.last_epoch_claimed  = property.distribution_epoch;
        claim.total_claimed       = claim
            .total_claimed
            .checked_add(share_lamports)
            .ok_or(MamposteError::ArithmeticOverflow)?;

        // Reducir el collected_rent del estado de la propiedad
        ctx.accounts.property_state.collected_rent = ctx
            .accounts
            .property_state
            .collected_rent
            .checked_sub(share_lamports)
            .ok_or(MamposteError::ArithmeticOverflow)?;

        ctx.accounts.property_state.distributed_rent = ctx
            .accounts
            .property_state
            .distributed_rent
            .checked_add(share_lamports)
            .ok_or(MamposteError::ArithmeticOverflow)?;

        emit!(RentClaimed {
            property:        property_key,
            investor:        ctx.accounts.investor.key(),
            investor_tokens: investor_balance,
            share_lamports,
            epoch:           property.distribution_epoch,
            timestamp:       Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. END_DISTRIBUTION
    //
    //    Desbloquea el vault después de que todos los inversores cobraron
    //    (o pasó el tiempo límite). Solo la authority puede ejecutarlo.
    //    Cualquier renta no reclamada permanece en el vault para la
    //    siguiente época.
    // ─────────────────────────────────────────────────────────────────────────
    pub fn end_distribution(ctx: Context<EndDistribution>) -> Result<()> {
        let property = &mut ctx.accounts.property_state;

        require!(property.is_rent_locked, MamposteError::NoActiveDistribution);

        property.is_rent_locked = false;
        property.rent_snapshot  = 0;

        emit!(DistributionEnded {
            property:         property.key(),
            epoch:            property.distribution_epoch,
            remaining_rent:   property.collected_rent,
            timestamp:        Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. TOGGLE_PROPERTY (admin)
    // ─────────────────────────────────────────────────────────────────────────
    pub fn toggle_property(ctx: Context<ToggleProperty>, active: bool) -> Result<()> {
        ctx.accounts.property_state.is_active = active;
        msg!("Propiedad {} → {}", ctx.accounts.property_state.key(), if active { "activa" } else { "inactiva" });
        Ok(())
    }

    // =========================================================================
    //  FASE 2a — KYC: delegamos a kyc.rs
    // =========================================================================

    // 8. Inicializa la config global del programa (se llama una sola vez)
    pub fn initialize_program_config(ctx: Context<InitProgramConfig>) -> Result<()> {
        let config    = &mut ctx.accounts.program_config;
        config.authority = ctx.accounts.authority.key();
        config.bump      = ctx.bumps.program_config;
        msg!("ProgramConfig inicializado. Authority: {}", config.authority);
        Ok(())
    }

    // 9. Inversor se registra para KYC
    pub fn register_investor(
        ctx: Context<kyc::RegisterInvestor>,
        params: kyc::RegisterInvestorParams,
    ) -> Result<()> {
        kyc::register_investor(ctx, params)
    }

    // 10. Authority aprueba un inversor
    pub fn approve_investor(ctx: Context<kyc::AuthorityKycAction>) -> Result<()> {
        kyc::approve_investor(ctx)
    }

    // 11. Authority revoca un inversor (cumplimiento OFAC/UIAF)
    pub fn revoke_investor(
        ctx: Context<kyc::AuthorityKycAction>,
        reason: String,
    ) -> Result<()> {
        kyc::revoke_investor(ctx, reason)
    }

    // =========================================================================
    //  FASE 2b — MERCADO SECUNDARIO: delegamos a market.rs
    // =========================================================================

    // 12. Vendedor crea una oferta bloqueando tokens en escrow
    pub fn create_offer(
        ctx: Context<market::CreateOffer>,
        amount_tokens: u64,
        price_lamports_per_token: u64,
        expiry_slots: Option<u64>,
    ) -> Result<()> {
        market::create_offer(ctx, amount_tokens, price_lamports_per_token, expiry_slots)
    }

    // 13. Comprador acepta la oferta — swap atómico SOL ↔ tokens
    pub fn accept_offer(ctx: Context<market::AcceptOffer>) -> Result<()> {
        market::accept_offer(ctx)
    }

    // 14. Vendedor (o cualquiera si expiró) cancela y recupera tokens
    pub fn cancel_offer(ctx: Context<market::CancelOffer>) -> Result<()> {
        market::cancel_offer(ctx)
    }

    // =========================================================================
    //  FASE 3a — GOBERNANZA DAO
    // =========================================================================

    // 15. Authority crea propuesta para holders de una propiedad
    pub fn create_proposal(
        ctx: Context<governance::CreateProposal>,
        params: governance::CreateProposalParams,
    ) -> Result<()> {
        governance::create_proposal(ctx, params)
    }

    // 16. Token holder emite su voto (peso = tokens que posee)
    pub fn cast_vote(
        ctx: Context<governance::CastVote>,
        option_index: u8,
    ) -> Result<()> {
        governance::cast_vote(ctx, option_index)
    }

    // 17. Authority finaliza propuesta después del deadline
    pub fn finalize_proposal(
        ctx: Context<governance::FinalizeProposal>,
    ) -> Result<()> {
        governance::finalize_proposal(ctx)
    }

    // 31. Propuesta específica de presupuesto de mantenimiento (Aprobar/Rechazar)
    pub fn create_maintenance_budget_proposal(
        ctx: Context<governance::CreateMaintenanceBudget>,
        params: governance::MaintenanceBudgetParams,
    ) -> Result<()> {
        governance::create_maintenance_budget_proposal(ctx, params)
    }

    // 32. Ejecuta el pago al contratista si la propuesta fue aprobada
    pub fn execute_maintenance_budget(
        ctx: Context<governance::ExecuteMaintenanceBudget>,
    ) -> Result<()> {
        governance::execute_maintenance_budget(ctx)
    }

    // =========================================================================
    //  FASE 3b — ORACLE DE VALUACIÓN
    // =========================================================================

    // 18. Inicializa oracle de precio para una propiedad
    pub fn initialize_oracle(
        ctx: Context<oracle::InitializeOracle>,
        initial_value_usd_cents: u64,
    ) -> Result<()> {
        oracle::initialize_oracle(ctx, initial_value_usd_cents)
    }

    // 19. Authority actualiza la valuación (con circuit breaker ±50%)
    pub fn update_valuation(
        ctx: Context<oracle::UpdateValuation>,
        new_value_usd_cents: u64,
    ) -> Result<()> {
        oracle::update_valuation(ctx, new_value_usd_cents)
    }

    // 20. Lee la valuación actual (emite evento para indexación)
    pub fn read_valuation(ctx: Context<oracle::ReadValuation>) -> Result<()> {
        oracle::read_valuation(ctx)
    }

    // =========================================================================
    //  FASE 4 — APPCHAIN SOBERANA (producción)
    //  dNFT atómico · Hyperlane ISM real · Liquidador permisivo
    //  ZK CU dinámico · SmartAccount WebAuthn · Paymaster · Treasury
    // =========================================================================

    // 21. dNFT atómico: inicializa Mint Token-2022 con 4 extensiones en 1 tx
    //     (TransferFee + ConfidentialTransfer + MetadataPointer + TransferHook)
    //     CU: ~250_000
    pub fn initialize_dnft_atomic(
        ctx: Context<appchain::InitializeDnftAtomic>,
        params: appchain::DnftParams,
    ) -> Result<()> {
        appchain::initialize_dnft_atomic(ctx, params)
    }

    // 22. Cross-chain buy con Hyperlane ISM CPI real (3/5 multisig)
    //     CU: ~350_000
    pub fn process_cross_chain_buy(
        ctx: Context<appchain::ProcessCrossChainBuy>,
        payload: appchain::CrossChainPayload,
    ) -> Result<()> {
        appchain::process_cross_chain_buy(ctx, payload)
    }

    // 23. Liquidador permisivo: cualquiera liquida si LTV>75% o préstamo vencido
    //     CU: ~120_000
    pub fn liquidate_collateral(
        ctx: Context<appchain::LiquidateCollateral>,
    ) -> Result<()> {
        appchain::liquidate_collateral(ctx)
    }

    // 24. Transfer Hook ZK: CU dinámico 1.4M (verify) / 50K (cache hit)
    //     Spinlock atómico en ZkVerificationRecord
    pub fn zk_transfer_hook(
        ctx: Context<appchain::ZkTransferHook>,
        amount: u64,
        proof: Vec<u8>,
    ) -> Result<()> {
        appchain::zk_transfer_hook(ctx, amount, proof)
    }

    // 25. Oracle Notarial trimestral con Legal Wrapper (Ley 527/1999 Colombia)
    //     CU: ~80_000
    pub fn update_notarial_metadata(
        ctx: Context<appchain::UpdateNotarialMetadata>,
        params: appchain::NotarialUpdateParams,
    ) -> Result<()> {
        appchain::update_notarial_metadata(ctx, params)
    }

    // 26. Préstamo DeFi con dNFT como colateral (máx 60% LTV)
    //     CU: ~100_000
    pub fn initiate_loan(
        ctx: Context<appchain::InitiateLoan>,
        loan_amount_usdc: u64,
        duration_days: u32,
    ) -> Result<()> {
        appchain::initiate_loan(ctx, loan_amount_usdc, duration_days)
    }

    // 27. Repago de préstamo — libera dNFT del escrow
    //     CU: ~90_000
    pub fn repay_loan(ctx: Context<appchain::RepayLoan>) -> Result<()> {
        appchain::repay_loan(ctx)
    }

    // 28. SmartAccount WebAuthn — wallet sin seed phrase (P256/FaceID)
    //     CU: ~60_000
    pub fn initialize_smart_account(
        ctx: Context<appchain::InitializeSmartAccount>,
        webauthn_pubkey: [u8; appchain::P256_PUBKEY_LEN],
        display_name: String,
    ) -> Result<()> {
        appchain::initialize_smart_account(ctx, webauthn_pubkey, display_name)
    }

    // 29. Paymaster: paga fee del usuario descontando de su saldo de renta
    //     CU: ~40_000
    pub fn paymaster_sponsor_fee(
        ctx: Context<appchain::PaymasterSponsorFee>,
        fee_lamports: u64,
    ) -> Result<()> {
        appchain::paymaster_sponsor_fee(ctx, fee_lamports)
    }

    // 30. Tesorería: recoge Transfer Fees Token-2022 → fondo de liquidez
    //     CU: ~80_000
    pub fn collect_transfer_fees_to_treasury(
        ctx: Context<appchain::CollectTransferFees>,
    ) -> Result<()> {
        appchain::collect_transfer_fees_to_treasury(ctx)
    }

    // =========================================================================
    //  FASE 0 — SEGURIDAD PRE-MAINNET (Timelock + Multisig)
    // =========================================================================

    // 33. Proponer operación crítica con timelock de 48h
    //     Operaciones: UpdateValuation, ToggleProperty, ApproveKycBatch,
    //                  UpdateProtocolFee, UpdateLtvParams, EmergencyPause
    pub fn propose_critical_op(
        ctx: Context<upgrades::security::ProposeCriticalOp>,
        operation_type: upgrades::security::OperationType,
        payload: Vec<u8>,
        target_property: Option<Pubkey>,
    ) -> Result<()> {
        upgrades::security::propose_critical_op(ctx, operation_type, payload, target_property)
    }

    // 34. Cancelar propuesta antes de que sea ejecutada
    //     Solo el proposer original puede cancelar (o el multisig Squads)
    pub fn cancel_critical_op(
        ctx: Context<upgrades::security::CancelCriticalOp>,
    ) -> Result<()> {
        upgrades::security::cancel_critical_op(ctx)
    }

    // =========================================================================
    //  FASE 0 / FASE 2 — ORACLE V2 con Switchboard + Auto-Compound
    // =========================================================================

    // 35. Actualizar valuación con validación contra feed externo Switchboard
    //     Rechaza si el precio se desvía >20% del feed descentralizado
    pub fn update_valuation_v2(
        ctx: Context<upgrades::oracle_v2::UpdateValuationV2>,
        new_value_usd_cents: u64,
    ) -> Result<()> {
        upgrades::oracle_v2::update_valuation_v2(ctx, new_value_usd_cents)
    }

    // 36. Auto-compound: la renta del inversor se reinvierte en más tokens
    //     en lugar de ser transferida como SOL
    pub fn compound_rent(
        ctx: Context<upgrades::oracle_v2::CompoundRent>,
    ) -> Result<()> {
        upgrades::oracle_v2::compound_rent(ctx)
    }

    // =========================================================================
    //  FASE 3 — PROOF OF RESERVE + LIQUIDEZ CLMM
    // =========================================================================

    // 37. Registra o renueva el Proof of Reserve notarial de una propiedad
    //     El hash SHA-256 del certificado queda on-chain — verificable por cualquiera
    pub fn register_proof_of_reserve(
        ctx: Context<upgrades::proof_of_reserve::RegisterProofOfReserve>,
        certificate_hash: [u8; 32],
        arweave_cid:      String,
        escritura_ref:    String,
        matricula_ref:    String,
        notaria_ref:      String,
        sas_nit:          String,
        certificate_date: i64,
    ) -> Result<()> {
        upgrades::proof_of_reserve::register_proof_of_reserve(
            ctx,
            upgrades::proof_of_reserve::RegisterPorParams {
                certificate_hash,
                arweave_cid,
                escritura_ref,
                matricula_ref,
                notaria_ref,
                sas_nit,
                certificate_date,
            },
        )
    }

    // 38. Inicializa el pool de liquidez Orca CLMM para una propiedad
    //     Crea par TOKEN_RWA/USDC con rango ±15% del precio oracle
    pub fn initialize_property_pool(
        ctx: Context<upgrades::liquidity::InitializePropertyPool>,
        whirlpool_pubkey: Pubkey,
    ) -> Result<()> {
        upgrades::liquidity::initialize_property_pool(ctx, whirlpool_pubkey)
    }

    // =========================================================================
    //  FASE 4 — TOKEN MAMP + COMPRESSED ACCOUNTS
    // =========================================================================

    // 39. Bloquear MAMP → recibir veMAMP proporcional al tiempo de lock
    //     veMAMP = mamp * (lock_secs / MAX_LOCK_SECS=4años)
    //     Holders capturan 20% de todos los fees del protocolo en USDC
    pub fn stake_mamp(
        ctx: Context<upgrades::mamp_token::StakeMamp>,
        amount:    u64,
        lock_secs: u64,
    ) -> Result<()> {
        upgrades::mamp_token::stake_mamp(ctx, amount, lock_secs)
    }

    // 40. Liberar MAMP bloqueado (solo disponible después de unlock_at)
    //     veMAMP decae a 0 al desbloquear
    pub fn unstake_mamp(
        ctx: Context<upgrades::mamp_token::UnstakeMamp>,
    ) -> Result<()> {
        upgrades::mamp_token::unstake_mamp(ctx)
    }

    // 41. Distribuir 20% de los fees acumulados entre veMAMP holders
    //     Cualquiera puede llamar esta instrucción (sin authority requerida)
    //     Diseñado para ser llamado semanalmente por el cron job de Inngest
    pub fn distribute_protocol_fees(
        ctx: Context<upgrades::mamp_token::DistributeProtocolFees>,
    ) -> Result<()> {
        upgrades::mamp_token::distribute_protocol_fees(ctx)
    }

    // 42. Registrar KYC usando compressed accounts de Light Protocol
    //     Costo: ~0.000001 SOL vs ~0.002 SOL del modelo normal (-99.95%)
    //     Escala a 10M+ inversores sin colapsar en costos de storage
    pub fn register_investor_compressed(
        ctx: Context<upgrades::compressed::RegisterInvestorCompressed>,
        identity_hash: [u8; 32],
    ) -> Result<()> {
        upgrades::compressed::register_investor_compressed(ctx, identity_hash)
    }
}

// =============================================================================
//  ACCOUNT CONTEXTS
// =============================================================================

#[derive(Accounts)]
#[instruction(params: InitPropertyParams)]
pub struct InitializeProperty<'info> {
    // PDA de estado — seeds con property_id u64 (determinista, sin colisiones)
    #[account(
        init,
        payer = authority,
        space = PropertyState::LEN,
        seeds = [
            b"property",
            authority.key().as_ref(),
            params.property_id.to_le_bytes().as_ref(),
        ],
        bump
    )]
    pub property_state: Account<'info, PropertyState>,

    // Mint del SPL Token — autoridad es el PDA de la propiedad
    #[account(
        init,
        payer = authority,
        mint::decimals      = 6,
        mint::authority     = property_state,
        mint::freeze_authority = property_state,
    )]
    pub property_mint: Account<'info, Mint>,

    // Vault PDA para almacenar SOL de renta — bump almacenado en PropertyState
    /// CHECK: PDA sin datos, solo almacena lamports. Validado por seeds.
    #[account(
        mut,
        seeds = [b"rent_vault", property_state.key().as_ref()],
        bump
    )]
    pub rent_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program:  Program<'info, Token>,
    pub rent:           Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MintFractionalTokens<'info> {
    // has_one = authority verifica que el signer sea la authority real
    #[account(
        mut,
        seeds = [
            b"property",
            property_state.authority.as_ref(),
            property_state.property_id.to_le_bytes().as_ref(),
        ],
        bump = property_state.bump,
        has_one = authority @ MamposteError::Unauthorized,
        has_one = mint @ MamposteError::MintMismatch,
    )]
    pub property_state: Account<'info, PropertyState>,

    #[account(mut, address = property_state.mint @ MamposteError::MintMismatch)]
    pub property_mint: Account<'info, Mint>,

    // ATA del inversor — se crea si no existe
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint      = property_mint,
        associated_token::authority = investor,
    )]
    pub investor_token_account: Account<'info, TokenAccount>,

    /// CHECK: Solo recibe tokens. Su dirección es validada por el ATA constraint.
    pub investor: UncheckedAccount<'info>,

    /// KYC del inversor — debe estar Approved antes de recibir tokens
    #[account(
        seeds = [b"investor_kyc", investor.key().as_ref()],
        bump  = investor_kyc.bump,
    )]
    pub investor_kyc: Account<'info, InvestorProfile>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program:           Program<'info, System>,
    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent:                     Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DepositRent<'info> {
    #[account(
        mut,
        seeds = [
            b"property",
            property_state.authority.as_ref(),
            property_state.property_id.to_le_bytes().as_ref(),
        ],
        bump = property_state.bump,
    )]
    pub property_state: Account<'info, PropertyState>,

    /// CHECK: PDA validado por seeds. Solo recibe lamports.
    #[account(
        mut,
        seeds  = [b"rent_vault", property_state.key().as_ref()],
        bump   = property_state.vault_bump,
    )]
    pub rent_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub depositor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartDistribution<'info> {
    #[account(
        mut,
        seeds = [
            b"property",
            property_state.authority.as_ref(),
            property_state.property_id.to_le_bytes().as_ref(),
        ],
        bump = property_state.bump,
        has_one = authority @ MamposteError::Unauthorized,
    )]
    pub property_state: Account<'info, PropertyState>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimRent<'info> {
    #[account(
        mut,
        seeds = [
            b"property",
            property_state.authority.as_ref(),
            property_state.property_id.to_le_bytes().as_ref(),
        ],
        bump = property_state.bump,
    )]
    pub property_state: Account<'info, PropertyState>,

    /// CHECK: PDA validado por seeds. El bump está almacenado en property_state.
    #[account(
        mut,
        seeds  = [b"rent_vault", property_state.key().as_ref()],
        bump   = property_state.vault_bump,
    )]
    pub rent_vault: UncheckedAccount<'info>,

    // Re-entrancy guard: PDA único por (investor, property)
    // Si ya existe → ya cobró en esta época
    #[account(
        init_if_needed,
        payer = investor,
        space = InvestorClaim::LEN,
        seeds = [
            b"claim",
            investor.key().as_ref(),
            property_state.key().as_ref(),
        ],
        bump
    )]
    pub investor_claim: Account<'info, InvestorClaim>,

    // Token account del inversor — para leer su saldo
    #[account(
        associated_token::mint      = property_state.mint,
        associated_token::authority = investor,
    )]
    pub investor_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub investor: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program:  Program<'info, Token>,
}

#[derive(Accounts)]
pub struct EndDistribution<'info> {
    #[account(
        mut,
        seeds = [
            b"property",
            property_state.authority.as_ref(),
            property_state.property_id.to_le_bytes().as_ref(),
        ],
        bump = property_state.bump,
        has_one = authority @ MamposteError::Unauthorized,
    )]
    pub property_state: Account<'info, PropertyState>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ToggleProperty<'info> {
    #[account(
        mut,
        has_one = authority @ MamposteError::Unauthorized,
    )]
    pub property_state: Account<'info, PropertyState>,

    pub authority: Signer<'info>,
}

// ─── Fase 2a: Config global ───────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitProgramConfig<'info> {
    #[account(
        init,
        payer  = authority,
        space  = kyc::ProgramConfig::LEN,
        seeds  = [b"program_config"],
        bump
    )]
    pub program_config: Account<'info, kyc::ProgramConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// =============================================================================
//  ACCOUNT DATA STRUCTS
// =============================================================================

#[account]
pub struct PropertyState {
    pub authority:          Pubkey,  // 32
    pub mint:               Pubkey,  // 32
    pub property_id:        u64,     // 8  — seed determinista
    pub total_value:        u64,     // 8  — USD cents
    pub total_tokens:       u64,     // 8
    pub tokens_issued:      u64,     // 8
    pub collected_rent:     u64,     // 8  — lamports sin distribuir
    pub distributed_rent:   u64,     // 8  — lamports distribuidos total
    pub rent_snapshot:      u64,     // 8  — snapshot para distribución activa
    pub distribution_epoch: u64,     // 8  — contador de distribuciones
    pub is_active:          bool,    // 1
    pub is_rent_locked:     bool,    // 1  — true durante distribución
    pub bump:               u8,      // 1
    pub vault_bump:         u8,      // 1  — bump del rent_vault PDA
    pub mint_bump:          u8,      // 1  — bump del property_mint PDA (para compound_rent)
    pub location:           String,  // 4 + 128
    pub legal_doc_hash:     String,  // 4 + 64
    pub ipfs_cid:           String,  // 4 + 59 (CIDv1 max)

    // ── Fase 3: Liquidez + PoR ──────────────────────────────────────────────
    /// Pubkey del LiquidityPool PDA (0 si no inicializado)
    pub pool_pubkey:        Pubkey,  // 32  — Orca CLMM pool
    /// Si el pool de liquidez fue inicializado
    pub pool_initialized:   bool,    // 1
    /// Hash SHA-256 del Proof of Reserve actual (zeros si no registrado)
    pub por_hash:           [u8; 32], // 32
}

impl PropertyState {
    pub const LEN: usize =
        8                    // discriminator
        + 32 + 32            // authority, mint
        + 8 + 8 + 8 + 8      // property_id, total_value, total_tokens, tokens_issued
        + 8 + 8 + 8 + 8      // collected_rent, distributed_rent, rent_snapshot, distribution_epoch
        + 1 + 1 + 1 + 1 + 1  // is_active, is_rent_locked, bump, vault_bump, mint_bump
        + (4 + 128)          // location
        + (4 + 64)           // legal_doc_hash
        + (4 + 59)           // ipfs_cid
        + 32 + 1 + 32;       // pool_pubkey, pool_initialized, por_hash
}

/// PDA de claim por inversor por propiedad — re-entrancy guard
#[account]
pub struct InvestorClaim {
    pub investor:           Pubkey,  // 32
    pub property:           Pubkey,  // 32
    pub last_epoch_claimed: u64,     // 8
    pub total_claimed:      u64,     // 8
    pub bump:               u8,      // 1
}

impl InvestorClaim {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1;
}

// =============================================================================
//  PARÁMETROS
// =============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitPropertyParams {
    pub property_id:    u64,
    pub location:       String,
    pub total_value:    u64,
    pub total_tokens:   u64,
    pub legal_doc_hash: String,
    pub ipfs_cid:       String,
}

// =============================================================================
//  EVENTOS — para indexación off-chain (The Graph / Helius webhooks)
// =============================================================================

#[event]
pub struct PropertyInitialized {
    pub property:     Pubkey,
    pub authority:    Pubkey,
    pub property_id:  u64,
    pub location:     String,
    pub total_value:  u64,
    pub total_tokens: u64,
    pub timestamp:    i64,
}

#[event]
pub struct TokensMinted {
    pub property:     Pubkey,
    pub investor:     Pubkey,
    pub amount:       u64,
    pub total_issued: u64,
    pub timestamp:    i64,
}

#[event]
pub struct RentDeposited {
    pub property:        Pubkey,
    pub depositor:       Pubkey,
    pub amount_lamports: u64,
    pub total_collected: u64,
    pub timestamp:       i64,
}

#[event]
pub struct DistributionStarted {
    pub property:           Pubkey,
    pub epoch:              u64,
    pub rent_snapshot:      u64,
    pub tokens_at_snapshot: u64,
    pub timestamp:          i64,
}

#[event]
pub struct RentClaimed {
    pub property:        Pubkey,
    pub investor:        Pubkey,
    pub investor_tokens: u64,
    pub share_lamports:  u64,
    pub epoch:           u64,
    pub timestamp:       i64,
}

#[event]
pub struct DistributionEnded {
    pub property:       Pubkey,
    pub epoch:          u64,
    pub remaining_rent: u64,
    pub timestamp:      i64,
}

// =============================================================================
//  ERRORES — centralizados en errors.rs, re-exportados aquí
//  Todos los módulos usan: use crate::errors::MamposteError;
// =============================================================================
// (ya importado en el tope como `pub use errors::MamposteError`)
