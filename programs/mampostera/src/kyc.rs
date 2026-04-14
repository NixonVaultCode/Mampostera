// =============================================================================
//  MAMPOSTERA — Módulo KYC on-chain
//  Fase 2a | Sin dependencia externa de Civic — authority firma la aprobación
//
//  Flujo:
//  1. Inversor llama register_investor() → crea InvestorProfile PDA
//  2. Authority (Mampostera ops) llama approve_investor() tras verificar docs
//  3. mint_fractional_tokens verifica que el inversor esté aprobado
//  4. revoke_investor() permite bloquear cuentas (cumplimiento OFAC/UIAF)
//
//  Seguridad:
//  - Solo authority puede aprobar/revocar (never el propio inversor)
//  - PDA semilla incluye investor pubkey → no colisiones
//  - Estado inmutable una vez aprobado excepto por revocación explícita
//  - Timestamp de aprobación almacenado para auditoría
// =============================================================================

use anchor_lang::prelude::*;

use crate::errors::MamposteError;

// ─── Constantes ───────────────────────────────────────────────────────────────

/// Longitud máxima del campo de referencia documental (número de documento)
pub const MAX_DOC_REF_LEN: usize = 32;
/// Longitud máxima del nombre completo del inversor
pub const MAX_NAME_LEN: usize = 64;
/// Longitud máxima del país (ISO 3166-1 alpha-2)
pub const COUNTRY_CODE_LEN: usize = 2;

// ─── Instrucciones ────────────────────────────────────────────────────────────

/// El inversor se registra a sí mismo. No requiere la authority.
/// Crea el PDA con estado Pending — no puede operar hasta ser aprobado.
pub fn register_investor(
    ctx: Context<RegisterInvestor>,
    params: RegisterInvestorParams,
) -> Result<()> {
    require!(
        !params.full_name.is_empty() && params.full_name.len() <= MAX_NAME_LEN,
        MamposteError::InvalidInvestorName
    );
    require!(
        params.doc_reference.len() <= MAX_DOC_REF_LEN,
        MamposteError::InvalidDocReference
    );
    require!(
        params.country_code.len() == COUNTRY_CODE_LEN
            && params.country_code.chars().all(|c| c.is_ascii_uppercase()),
        MamposteError::InvalidCountryCode
    );

    let profile = &mut ctx.accounts.investor_profile;

    profile.investor      = ctx.accounts.investor.key();
    profile.full_name     = params.full_name;
    profile.doc_reference = params.doc_reference;
    profile.country_code  = params.country_code;
    profile.status        = KycStatus::Pending;
    profile.approved_at   = 0;
    profile.revoked_at    = 0;
    profile.bump          = ctx.bumps.investor_profile;

    emit!(InvestorRegistered {
        investor:      profile.investor,
        country_code:  profile.country_code.clone(),
        timestamp:     Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Solo la authority del programa aprueba inversores.
/// Se llama después de verificar documentos off-chain.
pub fn approve_investor(ctx: Context<AuthorityKycAction>) -> Result<()> {
    let profile = &mut ctx.accounts.investor_profile;

    require!(
        profile.status == KycStatus::Pending || profile.status == KycStatus::Revoked,
        MamposteError::InvestorAlreadyApproved
    );

    profile.status      = KycStatus::Approved;
    profile.approved_at = Clock::get()?.unix_timestamp;
    profile.revoked_at  = 0;

    emit!(InvestorApproved {
        investor:    profile.investor,
        approved_by: ctx.accounts.authority.key(),
        timestamp:   profile.approved_at,
    });

    Ok(())
}

/// Revoca un inversor aprobado. Bloquea todas sus operaciones futuras.
/// Cumplimiento OFAC/UIAF — no afecta tokens ya adquiridos.
pub fn revoke_investor(ctx: Context<AuthorityKycAction>, reason: String) -> Result<()> {
    require!(reason.len() <= 128, MamposteError::ReasonTooLong);

    let profile = &mut ctx.accounts.investor_profile;

    require!(
        profile.status == KycStatus::Approved,
        MamposteError::InvestorNotApproved
    );

    profile.status     = KycStatus::Revoked;
    profile.revoked_at = Clock::get()?.unix_timestamp;

    emit!(InvestorRevoked {
        investor:   profile.investor,
        revoked_by: ctx.accounts.authority.key(),
        reason,
        timestamp:  profile.revoked_at,
    });

    Ok(())
}

// ─── Account contexts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct RegisterInvestor<'info> {
    /// PDA único por wallet de inversor
    #[account(
        init,
        payer  = investor,
        space  = InvestorProfile::LEN,
        seeds  = [b"investor_kyc", investor.key().as_ref()],
        bump
    )]
    pub investor_profile: Account<'info, InvestorProfile>,

    #[account(mut)]
    pub investor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorityKycAction<'info> {
    #[account(
        mut,
        seeds = [b"investor_kyc", investor_profile.investor.as_ref()],
        bump  = investor_profile.bump,
    )]
    pub investor_profile: Account<'info, InvestorProfile>,

    /// CHECK: La authority es la misma del programa global.
    /// Se valida contra una account config que almacena la authority.
    #[account(
        seeds = [b"program_config"],
        bump  = program_config.bump,
        has_one = authority @ MamposteError::Unauthorized,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    pub authority: Signer<'info>,
}

// ─── Data structs ─────────────────────────────────────────────────────────────

#[account]
pub struct InvestorProfile {
    pub investor:      Pubkey,         // 32
    pub status:        KycStatus,      // 1
    pub approved_at:   i64,            // 8
    pub revoked_at:    i64,            // 8
    pub bump:          u8,             // 1
    pub country_code:  String,         // 4 + 2
    pub full_name:     String,         // 4 + 64
    pub doc_reference: String,         // 4 + 32  (número de documento, hashed)
}

impl InvestorProfile {
    pub const LEN: usize =
        8               // discriminator
        + 32            // investor
        + 1             // status
        + 8 + 8         // approved_at, revoked_at
        + 1             // bump
        + (4 + 2)       // country_code
        + (4 + 64)      // full_name
        + (4 + 32);     // doc_reference
}

/// Config global del programa — almacena la authority de Mampostera
#[account]
pub struct ProgramConfig {
    pub authority: Pubkey,  // 32
    pub bump:      u8,      // 1
}

impl ProgramConfig {
    pub const LEN: usize = 8 + 32 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum KycStatus {
    Pending,
    Approved,
    Revoked,
}

// ─── Parámetros ───────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RegisterInvestorParams {
    pub full_name:     String,
    pub doc_reference: String, // hash del número de documento — nunca el número real
    pub country_code:  String,
}

// ─── Eventos ─────────────────────────────────────────────────────────────────

#[event]
pub struct InvestorRegistered {
    pub investor:     Pubkey,
    pub country_code: String,
    pub timestamp:    i64,
}

#[event]
pub struct InvestorApproved {
    pub investor:    Pubkey,
    pub approved_by: Pubkey,
    pub timestamp:   i64,
}

#[event]
pub struct InvestorRevoked {
    pub investor:   Pubkey,
    pub revoked_by: Pubkey,
    pub reason:     String,
    pub timestamp:  i64,
}

// ─── Helper público — usado por mint_fractional_tokens en lib.rs ──────────────

/// Verifica que un inversor esté aprobado. Retorna error si no lo está.
/// Se llama desde mint_fractional_tokens antes de emitir tokens.
pub fn require_kyc_approved(profile: &InvestorProfile) -> Result<()> {
    require!(
        profile.status == KycStatus::Approved,
        MamposteError::InvestorNotApproved
    );
    Ok(())
}
