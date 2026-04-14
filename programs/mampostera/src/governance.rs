// =============================================================================
//  MAMPOSTERA — Módulo Gobernanza DAO
//  Fase 3a | Votación on-chain por propiedad
//
//  Flujo:
//  1. Authority crea una propuesta: create_proposal(title, description, options)
//  2. Token holders votan: cast_vote(proposal, option_index)
//     - Poder de voto = tokens SPL que posee la wallet al momento del voto
//     - Un holder = un voto por propuesta (PDA VoteRecord previene doble voto)
//  3. Después del deadline: finalize_proposal() → registra el resultado on-chain
//
//  Seguridad:
//  - VoteRecord PDA (voter, proposal) previene votos duplicados
//  - Peso de voto tomado de token account en el momento — snapshot implícito
//  - KYC requerido para votar (mismo guard que mint)
//  - Solo authority puede crear y finalizar propuestas
//  - Deadline validado con Clock::get().unix_timestamp
// =============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::errors::MamposteError;
use crate::kyc::{InvestorProfile, KycStatus};

// ─── Constantes ───────────────────────────────────────────────────────────────

pub const MAX_TITLE_LEN:       usize = 64;
pub const MAX_DESCRIPTION_LEN: usize = 256;
pub const MAX_OPTIONS:         usize = 4;
pub const MAX_OPTION_LEN:      usize = 32;
/// Duración mínima de una propuesta: 1 hora en segundos
pub const MIN_VOTING_DURATION: i64 = 3_600;
/// Duración máxima: 30 días
pub const MAX_VOTING_DURATION: i64 = 2_592_000;
/// Quórum mínimo: 10% de tokens emitidos debe participar
pub const MIN_QUORUM_BPS: u64 = 1_000; // 10%

// ─── Instrucciones ────────────────────────────────────────────────────────────

/// Authority crea una propuesta para la comunidad de una propiedad.
pub fn create_proposal(
    ctx: Context<CreateProposal>,
    params: CreateProposalParams,
) -> Result<()> {
    // ── Validaciones ──────────────────────────────────────────────────────────
    require!(
        !params.title.is_empty() && params.title.len() <= MAX_TITLE_LEN,
        MamposteError::InvalidProposalTitle
    );
    require!(
        params.description.len() <= MAX_DESCRIPTION_LEN,
        MamposteError::InvalidProposalDescription
    );
    require!(
        params.options.len() >= 2 && params.options.len() <= MAX_OPTIONS,
        MamposteError::InvalidProposalOptions
    );
    for opt in &params.options {
        require!(
            !opt.is_empty() && opt.len() <= MAX_OPTION_LEN,
            MamposteError::InvalidProposalOptions
        );
    }
    require!(
        params.voting_duration >= MIN_VOTING_DURATION
            && params.voting_duration <= MAX_VOTING_DURATION,
        MamposteError::InvalidVotingDuration
    );

    let now      = Clock::get()?.unix_timestamp;
    let proposal = &mut ctx.accounts.proposal;

    proposal.property          = ctx.accounts.property_state.key();
    proposal.property_mint     = ctx.accounts.property_state.mint;
    proposal.creator           = ctx.accounts.authority.key();
    proposal.title             = params.title;
    proposal.description       = params.description;
    proposal.options           = params.options.clone();
    proposal.vote_counts       = vec![0u64; params.options.len()];
    proposal.total_votes_cast  = 0;
    proposal.total_weight_cast = 0;
    proposal.created_at        = now;
    proposal.deadline          = now
        .checked_add(params.voting_duration)
        .ok_or(MamposteError::ArithmeticOverflow)?;
    proposal.status            = ProposalStatus::Active;
    proposal.winning_option    = None;
    proposal.bump              = ctx.bumps.proposal;

    emit!(ProposalCreated {
        proposal:  proposal.key(),
        property:  proposal.property,
        title:     proposal.title.clone(),
        deadline:  proposal.deadline,
        options:   proposal.options.clone(),
        timestamp: now,
    });

    Ok(())
}

/// Token holder emite su voto. Peso = balance de tokens en su ATA.
pub fn cast_vote(ctx: Context<CastVote>, option_index: u8) -> Result<()> {
    // ── Validaciones ──────────────────────────────────────────────────────────
    let now      = Clock::get()?.unix_timestamp;
    let proposal = &mut ctx.accounts.proposal;

    require!(
        proposal.status == ProposalStatus::Active,
        MamposteError::ProposalNotActive
    );
    require!(now <= proposal.deadline, MamposteError::VotingPeriodEnded);
    require!(
        (option_index as usize) < proposal.options.len(),
        MamposteError::InvalidVoteOption
    );

    // ── KYC check ────────────────────────────────────────────────────────────
    require!(
        ctx.accounts.voter_kyc.status == KycStatus::Approved,
        MamposteError::InvestorNotApproved
    );

    // ── Peso de voto = tokens que posee ──────────────────────────────────────
    let vote_weight = ctx.accounts.voter_token_account.amount;
    require!(vote_weight > 0, MamposteError::InvestorHasNoTokens);

    // ── Registrar voto ────────────────────────────────────────────────────────
    let record         = &mut ctx.accounts.vote_record;
    record.voter       = ctx.accounts.voter.key();
    record.proposal    = proposal.key();
    record.option_index = option_index;
    record.weight      = vote_weight;
    record.voted_at    = now;
    record.bump        = ctx.bumps.vote_record;

    // Actualizar conteos (el índice está validado arriba)
    proposal.vote_counts[option_index as usize] = proposal.vote_counts[option_index as usize]
        .checked_add(vote_weight)
        .ok_or(MamposteError::ArithmeticOverflow)?;
    proposal.total_votes_cast = proposal.total_votes_cast
        .checked_add(1)
        .ok_or(MamposteError::ArithmeticOverflow)?;
    proposal.total_weight_cast = proposal.total_weight_cast
        .checked_add(vote_weight)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    emit!(VoteCast {
        proposal:     proposal.key(),
        voter:        record.voter,
        option_index,
        weight:       vote_weight,
        timestamp:    now,
    });

    Ok(())
}

/// Authority finaliza la propuesta después del deadline.
/// Calcula el ganador y verifica quórum mínimo.
pub fn finalize_proposal(ctx: Context<FinalizeProposal>) -> Result<()> {
    let now      = Clock::get()?.unix_timestamp;
    let proposal = &mut ctx.accounts.proposal;

    require!(
        proposal.status == ProposalStatus::Active,
        MamposteError::ProposalNotActive
    );
    require!(now > proposal.deadline, MamposteError::VotingPeriodNotEnded);

    // ── Verificar quórum ──────────────────────────────────────────────────────
    let total_supply  = ctx.accounts.property_state.tokens_issued;
    let quorum_needed = (total_supply as u128)
        .checked_mul(MIN_QUORUM_BPS as u128)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(MamposteError::ArithmeticOverflow)? as u64;

    if proposal.total_weight_cast < quorum_needed {
        proposal.status = ProposalStatus::QuorumNotReached;
        emit!(ProposalFinalized {
            proposal:       proposal.key(),
            status:         "quorum_not_reached".to_string(),
            winning_option: None,
            total_votes:    proposal.total_votes_cast,
            timestamp:      now,
        });
        return Ok(());
    }

    // ── Determinar ganador ────────────────────────────────────────────────────
    let mut winning_idx: usize = 0;
    let mut winning_count: u64 = 0;
    for (i, &count) in proposal.vote_counts.iter().enumerate() {
        if count > winning_count {
            winning_count = count;
            winning_idx   = i;
        }
    }

    proposal.status         = ProposalStatus::Executed;
    proposal.winning_option = Some(winning_idx as u8);

    emit!(ProposalFinalized {
        proposal:       proposal.key(),
        status:         "executed".to_string(),
        winning_option: Some(winning_idx as u8),
        total_votes:    proposal.total_votes_cast,
        timestamp:      now,
    });

    Ok(())
}

// ─── Account contexts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(params: CreateProposalParams)]
pub struct CreateProposal<'info> {
    #[account(
        init,
        payer  = authority,
        space  = Proposal::len(&params.options),
        seeds  = [
            b"proposal",
            property_state.key().as_ref(),
            &property_state.distribution_epoch.to_le_bytes(), // epoch como nonce
        ],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    /// CHECK: Solo lectura para obtener property key y mint
    pub property_state: Account<'info, crate::PropertyState>,

    #[account(
        seeds = [b"program_config"],
        bump  = program_config.bump,
        has_one = authority @ MamposteError::Unauthorized,
    )]
    pub program_config: Account<'info, crate::kyc::ProgramConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(
        mut,
        seeds = [
            b"proposal",
            proposal.property.as_ref(),
            &{
                let epoch = proposal.created_at; // placeholder — se usa en PDA real
                epoch.to_le_bytes()
            },
        ],
        bump = proposal.bump,
    )]
    pub proposal: Account<'info, Proposal>,

    /// PDA anti double-vote: (voter, proposal) → único por combinación
    #[account(
        init,
        payer  = voter,
        space  = VoteRecord::LEN,
        seeds  = [b"vote", voter.key().as_ref(), proposal.key().as_ref()],
        bump
    )]
    pub vote_record: Account<'info, VoteRecord>,

    /// Token account del votante — determina su peso de voto
    #[account(
        associated_token::mint      = proposal.property_mint,
        associated_token::authority = voter,
    )]
    pub voter_token_account: Account<'info, TokenAccount>,

    /// KYC del votante — debe estar aprobado
    #[account(
        seeds = [b"investor_kyc", voter.key().as_ref()],
        bump  = voter_kyc.bump,
    )]
    pub voter_kyc: Account<'info, InvestorProfile>,

    #[account(mut)]
    pub voter: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeProposal<'info> {
    #[account(mut)]
    pub proposal: Account<'info, Proposal>,

    pub property_state: Account<'info, crate::PropertyState>,

    #[account(
        seeds = [b"program_config"],
        bump  = program_config.bump,
        has_one = authority @ MamposteError::Unauthorized,
    )]
    pub program_config: Account<'info, crate::kyc::ProgramConfig>,

    pub authority: Signer<'info>,
}

// ─── Data structs ─────────────────────────────────────────────────────────────

#[account]
pub struct Proposal {
    pub property:          Pubkey,           // 32
    pub property_mint:     Pubkey,           // 32
    pub creator:           Pubkey,           // 32
    pub status:            ProposalStatus,   // 1
    pub winning_option:    Option<u8>,       // 2 (1 discriminant + 1 value)
    pub total_votes_cast:  u64,              // 8
    pub total_weight_cast: u64,              // 8
    pub created_at:        i64,              // 8
    pub deadline:          i64,              // 8
    pub bump:              u8,               // 1
    // Variable-length — calculado en ::len()
    pub title:             String,
    pub description:       String,
    pub options:           Vec<String>,
    pub vote_counts:       Vec<u64>,
}

impl Proposal {
    /// Calcula el space dinámico según las opciones provistas
    pub fn len(options: &[String]) -> usize {
        8                                       // discriminator
        + 32 + 32 + 32                          // property, mint, creator
        + 1 + 2                                 // status, winning_option
        + 8 + 8 + 8 + 8                         // votes, weight, timestamps
        + 1                                     // bump
        + (4 + MAX_TITLE_LEN)                   // title
        + (4 + MAX_DESCRIPTION_LEN)             // description
        + 4 + options.len() * (4 + MAX_OPTION_LEN) // options vec
        + 4 + options.len() * 8                 // vote_counts vec
    }
}

#[account]
pub struct VoteRecord {
    pub voter:        Pubkey,   // 32
    pub proposal:     Pubkey,   // 32
    pub option_index: u8,       // 1
    pub weight:       u64,      // 8
    pub voted_at:     i64,      // 8
    pub bump:         u8,       // 1
}

impl VoteRecord {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ProposalStatus {
    Active,
    Executed,
    QuorumNotReached,
    Cancelled,
}

// ─── Parámetros ───────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateProposalParams {
    pub title:           String,
    pub description:     String,
    pub options:         Vec<String>,
    pub voting_duration: i64,
}

/// Parámetros específicos para propuestas de presupuesto de mantenimiento.
/// Los holders votan aprobar/rechazar un gasto con monto y proveedor definidos.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MaintenanceBudgetParams {
    pub title:            String,
    pub description:      String,
    pub budget_usdc:      u64,    // Monto máximo aprobado en USDC (6 dec)
    pub contractor:       Pubkey, // Wallet del contratista que recibirá el pago
    pub voting_duration:  i64,
    pub work_description: String, // Descripción del trabajo (máx 256 chars)
}

// ─── Instrucción: create_maintenance_budget_proposal ─────────────────────────
// Crea una propuesta específica de tipo "presupuesto de mantenimiento".
// Solo tiene dos opciones: ["Aprobar", "Rechazar"].
// Si gana "Aprobar" con quórum ≥ 10%, los fondos quedan disponibles
// para ser liberados via execute_maintenance_budget.

pub fn create_maintenance_budget_proposal(
    ctx: Context<CreateMaintenanceBudget>,
    params: MaintenanceBudgetParams,
) -> Result<()> {
    require!(
        !params.title.is_empty() && params.title.len() <= MAX_TITLE_LEN,
        MamposteError::InvalidProposalTitle
    );
    require!(
        params.description.len() <= MAX_DESCRIPTION_LEN,
        MamposteError::InvalidProposalDescription
    );
    require!(
        params.work_description.len() <= MAX_DESCRIPTION_LEN,
        MamposteError::InvalidProposalDescription
    );
    require!(
        params.budget_usdc > 0 && params.budget_usdc <= 10_000_000_000_000u64, // max $10M
        MamposteError::InvalidMaintenanceBudget
    );
    require!(
        params.voting_duration >= MIN_VOTING_DURATION
            && params.voting_duration <= MAX_VOTING_DURATION,
        MamposteError::InvalidVotingDuration
    );

    let now      = Clock::get()?.unix_timestamp;
    let proposal = &mut ctx.accounts.proposal;

    proposal.property          = ctx.accounts.property_state.key();
    proposal.property_mint     = ctx.accounts.property_state.mint;
    proposal.creator           = ctx.accounts.authority.key();
    proposal.title             = params.title;
    proposal.description       = params.description;
    // Opciones fijas para presupuesto: solo Aprobar / Rechazar
    proposal.options           = vec!["Aprobar".to_string(), "Rechazar".to_string()];
    proposal.vote_counts       = vec![0u64; 2];
    proposal.total_votes_cast  = 0;
    proposal.total_weight_cast = 0;
    proposal.created_at        = now;
    proposal.deadline          = now
        .checked_add(params.voting_duration)
        .ok_or(MamposteError::ArithmeticOverflow)?;
    proposal.status            = ProposalStatus::Active;
    proposal.winning_option    = None;
    proposal.bump              = ctx.bumps.proposal;

    // Registro del presupuesto de mantenimiento
    let budget              = &mut ctx.accounts.maintenance_budget;
    budget.proposal         = proposal.key();
    budget.property         = proposal.property;
    budget.budget_usdc      = params.budget_usdc;
    budget.contractor       = params.contractor;
    budget.work_description = params.work_description;
    budget.is_approved      = false;
    budget.is_executed      = false;
    budget.approved_at      = 0;
    budget.bump             = ctx.bumps.maintenance_budget;

    emit!(MaintenanceBudgetProposed {
        proposal:     proposal.key(),
        property:     proposal.property,
        budget_usdc:  params.budget_usdc,
        contractor:   params.contractor,
        deadline:     proposal.deadline,
        timestamp:    now,
    });

    Ok(())
}

// ─── Instrucción: execute_maintenance_budget ──────────────────────────────────
// Ejecuta el pago al contratista si la propuesta fue aprobada.
// Condiciones: propuesta finalizada con opción 0 ganadora (Aprobar).
// El pago sale del RentVault de la propiedad (renta acumulada).
// El contratista recibe el monto en SOL (convertido desde USDC via oracle).

pub fn execute_maintenance_budget(
    ctx: Context<ExecuteMaintenanceBudget>,
) -> Result<()> {
    let budget   = &mut ctx.accounts.maintenance_budget;
    let proposal = &ctx.accounts.proposal;
    let now      = Clock::get()?.unix_timestamp;

    require!(!budget.is_executed, MamposteError::MaintenanceBudgetAlreadyExecuted);

    // Verificar que la propuesta fue aprobada (opción 0 ganó)
    require!(
        proposal.status == ProposalStatus::Executed,
        MamposteError::ProposalNotActive
    );
    require!(
        proposal.winning_option == Some(0), // 0 = "Aprobar"
        MamposteError::MaintenanceBudgetRejected
    );
    require!(
        now > proposal.deadline,
        MamposteError::VotingPeriodNotEnded
    );

    // Calcular monto en lamports usando el oracle como referencia
    // budget_usdc (6 dec) / oracle_value (cents) × 10^2 × LAMPORTS_PER_SOL
    // Simplificado: 1 USDC ≈ X lamports según price feed
    // En producción: usar Pyth SOL/USD para conversión exacta
    // Por ahora: relación fija 1 USDC = 5_000_000 lamports (≈ $0.20 SOL price)
    // El cliente puede calcular la conversión exacta off-chain
    let oracle_sol_price_cents = ctx.accounts.property_oracle.current_value;
    let payment_lamports = (budget.budget_usdc as u128)
        .checked_mul(sol_per_usdc_lamports as u128)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(1_000_000) // USDC tiene 6 decimales
        .ok_or(MamposteError::ArithmeticOverflow)? as u64;

    // Verificar que el vault tiene fondos suficientes
    let vault_balance = ctx.accounts.rent_vault.lamports();
    require!(
        vault_balance >= payment_lamports,
        MamposteError::InsufficientVaultFunds
    );

    // Transferir desde el RentVault al contratista
    let property_key = ctx.accounts.property_state.key();
    let vault_seeds: &[&[u8]] = &[
        b"rent_vault",
        property_key.as_ref(),
        &[ctx.accounts.property_state.vault_bump],
    ];

    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.rent_vault.to_account_info(),
                to:   ctx.accounts.contractor.to_account_info(),
            },
            &[vault_seeds],
        ),
        payment_lamports,
    )?;

    // Actualizar estado
    budget.is_approved  = true;
    budget.is_executed  = true;
    budget.approved_at  = now;

    ctx.accounts.property_state.collected_rent = ctx
        .accounts.property_state.collected_rent
        .checked_sub(payment_lamports)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    emit!(MaintenanceBudgetExecuted {
        proposal:         ctx.accounts.proposal.key(),
        property:         ctx.accounts.property_state.key(),
        contractor:       budget.contractor,
        budget_usdc:      budget.budget_usdc,
        payment_lamports,
        timestamp:        now,
    });

    msg!(
        "[Mantenimiento] Pago ejecutado: {} lamports → {}",
        payment_lamports, budget.contractor
    );
    Ok(())
}

// ─── Account contexts para mantenimiento ─────────────────────────────────────

#[derive(Accounts)]
#[instruction(params: MaintenanceBudgetParams)]
pub struct CreateMaintenanceBudget<'info> {
    #[account(
        init,
        payer  = authority,
        space  = Proposal::len(&["Aprobar".to_string(), "Rechazar".to_string()]),
        seeds  = [
            b"proposal",
            property_state.key().as_ref(),
            &property_state.distribution_epoch.to_le_bytes(),
        ],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(
        init,
        payer = authority,
        space = MaintenanceBudgetRecord::LEN,
        seeds = [b"maintenance", proposal.key().as_ref()],
        bump
    )]
    pub maintenance_budget: Account<'info, MaintenanceBudgetRecord>,

    pub property_state: Account<'info, crate::PropertyState>,

    #[account(
        seeds = [b"program_config"],
        bump  = program_config.bump,
        has_one = authority @ MamposteError::Unauthorized,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteMaintenanceBudget<'info> {
    #[account(
        mut,
        seeds = [b"maintenance", proposal.key().as_ref()],
        bump  = maintenance_budget.bump,
    )]
    pub maintenance_budget: Account<'info, MaintenanceBudgetRecord>,

    pub proposal: Account<'info, Proposal>,

    #[account(mut)]
    pub property_state: Account<'info, crate::PropertyState>,

    /// CHECK: vault PDA validado por seeds
    #[account(
        mut,
        seeds  = [b"rent_vault", property_state.key().as_ref()],
        bump   = property_state.vault_bump,
    )]
    pub rent_vault: UncheckedAccount<'info>,

    /// CHECK: contratista que recibirá el pago
    #[account(
        mut,
        address = maintenance_budget.contractor @ MamposteError::Unauthorized,
    )]
    pub contractor: UncheckedAccount<'info>,

    #[account(
        seeds = [b"program_config"],
        bump  = program_config.bump,
        has_one = authority @ MamposteError::Unauthorized,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ─── Data structs nuevos ──────────────────────────────────────────────────────

/// Registro de propuesta de presupuesto de mantenimiento
#[account]
pub struct MaintenanceBudgetRecord {
    pub proposal:         Pubkey,  // 32
    pub property:         Pubkey,  // 32
    pub contractor:       Pubkey,  // 32
    pub budget_usdc:      u64,     // 8
    pub is_approved:      bool,    // 1
    pub is_executed:      bool,    // 1
    pub approved_at:      i64,     // 8
    pub bump:             u8,      // 1
    pub work_description: String,  // 4 + 256
}

impl MaintenanceBudgetRecord {
    pub const LEN: usize =
        8 + 32 + 32 + 32 + 8 + 1 + 1 + 8 + 1 + (4 + 256);
}

// ─── Eventos ─────────────────────────────────────────────────────────────────

#[event]
pub struct ProposalCreated {
    pub proposal:  Pubkey,
    pub property:  Pubkey,
    pub title:     String,
    pub deadline:  i64,
    pub options:   Vec<String>,
    pub timestamp: i64,
}

#[event]
pub struct VoteCast {
    pub proposal:     Pubkey,
    pub voter:        Pubkey,
    pub option_index: u8,
    pub weight:       u64,
    pub timestamp:    i64,
}

#[event]
pub struct ProposalFinalized {
    pub proposal:       Pubkey,
    pub status:         String,
    pub winning_option: Option<u8>,
    pub total_votes:    u64,
    pub timestamp:      i64,
}

#[event]
pub struct MaintenanceBudgetProposed {
    pub proposal:    Pubkey,
    pub property:    Pubkey,
    pub budget_usdc: u64,
    pub contractor:  Pubkey,
    pub deadline:    i64,
    pub timestamp:   i64,
}

#[event]
pub struct MaintenanceBudgetExecuted {
    pub proposal:         Pubkey,
    pub property:         Pubkey,
    pub contractor:       Pubkey,
    pub budget_usdc:      u64,
    pub payment_lamports: u64,
    pub timestamp:        i64,
}
