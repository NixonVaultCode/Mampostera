/**
 * programs/mampostera/src/upgrades/mamp_token.rs
 *
 * R10: Token MAMP ve-tokenomics (instrucciones 39-41)
 *
 * Modelo:
 *   - MAMP: token de gobernanza SPL (100M supply, 6 decimales)
 *   - veMAMP: no-transferible, decae con el tiempo
 *     veMAMP = mamp_amount * (lock_duration_secs / MAX_LOCK_SECS)
 *   - Stakers capturan 20% de todos los fees del protocolo (en USDC)
 *   - Boost de liquidity mining: hasta 2.5x para LPs con veMAMP
 *
 * Instrucciones:
 *   39. stake_mamp(amount, lock_secs) — bloquear MAMP → recibir veMAMP
 *   40. unstake_mamp()               — liberar MAMP (veMAMP → 0)
 *   41. distribute_protocol_fees()   — distribuir 20% fees a veMAMP holders
 *
 * Integrar en lib.rs:
 *   pub mod mamp_token; (dentro de pub mod upgrades)
 *   Instrucciones 39, 40, 41 en el #[program] block
 */

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

// ── Constantes ────────────────────────────────────────────────────────────────

/// Bloqueo máximo: 4 años en segundos
pub const MAX_LOCK_SECS: u64 = 4 * 365 * 24 * 3600;

/// Bloqueo mínimo: 1 semana
pub const MIN_LOCK_SECS: u64 = 7 * 24 * 3600;

/// Porcentaje de fees del protocolo que va a veMAMP holders: 20%
pub const VE_FEE_SHARE_BPS: u64 = 2_000;

/// Multiplicador máximo de boost para LPs (2.5x = 25_000 bps)
pub const MAX_BOOST_BPS: u64 = 25_000;

/// Denominador BPS
pub const BPS_DENOM: u64 = 10_000;

// ── VeStake PDA ───────────────────────────────────────────────────────────────
/// Seeds: [b"ve_stake", staker_pubkey]
/// Representa la posición de staking de un holder de MAMP.
#[account]
pub struct VeStake {
    /// Wallet del staker
    pub staker:          Pubkey,   // 32
    /// Cantidad de MAMP bloqueada (6 decimales)
    pub mamp_amount:     u64,      // 8
    /// veMAMP efectivo en el momento del stake
    /// veMAMP = mamp * (lock_remaining / MAX_LOCK_SECS)
    pub ve_mamp_initial: u64,      // 8
    /// Timestamp de inicio del bloqueo
    pub locked_at:       i64,      // 8
    /// Timestamp de desbloqueo (locked_at + lock_secs)
    pub unlock_at:       i64,      // 8
    /// Duración del bloqueo en segundos
    pub lock_secs:       u64,      // 8
    /// USDC acumulado pendiente de reclamar (6 decimales)
    pub pending_usdc:    u64,      // 8
    /// Total USDC reclamado históricamente
    pub total_claimed:   u64,      // 8
    /// Índice del último epoch de fees distribuido
    pub last_fee_epoch:  u64,      // 8
    pub bump:            u8,       // 1
}

impl VeStake {
    pub const LEN: usize = 8
        + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 1;

    /// veMAMP actual (decae linealmente con el tiempo restante)
    pub fn current_ve_mamp(&self, now: i64) -> u64 {
        if now >= self.unlock_at { return 0; }
        let remaining = (self.unlock_at - now) as u64;
        // ve = mamp * remaining / MAX_LOCK_SECS
        (self.mamp_amount as u128)
            .saturating_mul(remaining as u128)
            .saturating_div(MAX_LOCK_SECS as u128) as u64
    }
}

// ── ProtocolFeePool PDA ───────────────────────────────────────────────────────
/// Seeds: [b"protocol_fee_pool"]
/// Acumula los fees del protocolo para distribución a veMAMP holders.
/// Se actualiza en cada swap del mercado P2P y en cada liquidación.
#[account]
pub struct ProtocolFeePool {
    /// Total veMAMP en circulación (suma de todos los VeStake activos)
    pub total_ve_mamp:       u64,   // 8
    /// USDC acumulado pendiente de distribuir
    pub pending_usdc:        u64,   // 8
    /// Total USDC distribuido históricamente
    pub total_distributed:   u64,   // 8
    /// Epoch actual de distribución (se incrementa en cada distribute_fees)
    pub current_epoch:       u64,   // 8
    /// USDC por veMAMP en el epoch actual (escala x10^9 para precisión)
    pub usdc_per_ve_mamp_x9: u64,   // 8
    pub bump:                u8,    // 1
}

impl ProtocolFeePool {
    pub const LEN: usize = 8 + 8 + 8 + 8 + 8 + 8 + 1;
}

// ── Instrucción 39: stake_mamp ────────────────────────────────────────────────

pub fn stake_mamp(
    ctx: Context<StakeMamp>,
    amount:   u64,
    lock_secs: u64,
) -> Result<()> {
    require!(amount > 0, MampTokenError::ZeroAmount);
    require!(
        lock_secs >= MIN_LOCK_SECS && lock_secs <= MAX_LOCK_SECS,
        MampTokenError::InvalidLockDuration
    );

    let now     = Clock::get()?.unix_timestamp;
    let stake   = &mut ctx.accounts.ve_stake;
    let pool    = &mut ctx.accounts.fee_pool;

    // Calcular veMAMP inicial
    let ve_mamp = (amount as u128)
        .checked_mul(lock_secs as u128)
        .ok_or(MampTokenError::ArithmeticOverflow)?
        .checked_div(MAX_LOCK_SECS as u128)
        .ok_or(MampTokenError::ArithmeticOverflow)? as u64;

    // Transferir MAMP del usuario al vault del PDA
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from:      ctx.accounts.staker_mamp_ata.to_account_info(),
                to:        ctx.accounts.stake_vault.to_account_info(),
                authority: ctx.accounts.staker.to_account_info(),
            },
        ),
        amount,
    )?;

    // Registrar stake
    stake.staker          = ctx.accounts.staker.key();
    stake.mamp_amount     = amount;
    stake.ve_mamp_initial = ve_mamp;
    stake.locked_at       = now;
    stake.unlock_at       = now
        .checked_add(lock_secs as i64)
        .ok_or(MampTokenError::ArithmeticOverflow)?;
    stake.lock_secs       = lock_secs;
    stake.pending_usdc    = 0;
    stake.total_claimed   = 0;
    stake.last_fee_epoch  = pool.current_epoch;
    stake.bump            = ctx.bumps.ve_stake;

    // Actualizar total veMAMP en el pool
    pool.total_ve_mamp = pool.total_ve_mamp
        .checked_add(ve_mamp)
        .ok_or(MampTokenError::ArithmeticOverflow)?;

    msg!(
        "[mamp] Stake: {} MAMP bloqueados · {} veMAMP · unlock en {}",
        amount, ve_mamp, stake.unlock_at
    );

    Ok(())
}

// ── Instrucción 40: unstake_mamp ──────────────────────────────────────────────

pub fn unstake_mamp(ctx: Context<UnstakeMamp>) -> Result<()> {
    let now   = Clock::get()?.unix_timestamp;
    let stake = &mut ctx.accounts.ve_stake;
    let pool  = &mut ctx.accounts.fee_pool;

    require!(now >= stake.unlock_at, MampTokenError::StillLocked);
    require!(stake.mamp_amount > 0,  MampTokenError::ZeroAmount);

    let amount = stake.mamp_amount;
    let ve_was = stake.ve_mamp_initial;

    // Restar veMAMP del pool
    pool.total_ve_mamp = pool.total_ve_mamp.saturating_sub(ve_was);

    // Devolver MAMP al staker desde el vault
    let staker_key  = stake.staker;
    let stake_seeds: &[&[u8]] = &[
        b"ve_stake",
        staker_key.as_ref(),
        &[stake.bump],
    ];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from:      ctx.accounts.stake_vault.to_account_info(),
                to:        ctx.accounts.staker_mamp_ata.to_account_info(),
                authority: ctx.accounts.ve_stake.to_account_info(),
            },
            &[stake_seeds],
        ),
        amount,
    )?;

    // Reset stake
    stake.mamp_amount     = 0;
    stake.ve_mamp_initial = 0;

    msg!("[mamp] Unstake: {} MAMP liberados para {}", amount, staker_key);
    Ok(())
}

// ── Instrucción 41: distribute_protocol_fees ─────────────────────────────────

/// Distribuye el 20% de los fees acumulados en el ProtocolFeePool
/// entre todos los holders activos de veMAMP, proporcional a su veMAMP.
///
/// Cualquiera puede llamar esta instrucción — no requiere authority.
/// Se diseñó para ser llamada semanalmente por un cron job.
pub fn distribute_protocol_fees(ctx: Context<DistributeProtocolFees>) -> Result<()> {
    let pool = &mut ctx.accounts.fee_pool;

    require!(pool.pending_usdc > 0, MampTokenError::NoFeesToDistribute);
    require!(pool.total_ve_mamp > 0, MampTokenError::NoStakersToReward);

    // Calcular USDC por veMAMP en este epoch (escala x10^9)
    let usdc_per_ve_x9 = (pool.pending_usdc as u128)
        .checked_mul(1_000_000_000)
        .ok_or(MampTokenError::ArithmeticOverflow)?
        .checked_div(pool.total_ve_mamp as u128)
        .ok_or(MampTokenError::ArithmeticOverflow)? as u64;

    // Registrar el epoch
    pool.usdc_per_ve_mamp_x9 = usdc_per_ve_x9;
    pool.total_distributed   = pool.total_distributed
        .checked_add(pool.pending_usdc)
        .ok_or(MampTokenError::ArithmeticOverflow)?;
    pool.current_epoch       = pool.current_epoch
        .checked_add(1)
        .ok_or(MampTokenError::ArithmeticOverflow)?;
    pool.pending_usdc        = 0;

    msg!(
        "[mamp] Distribución epoch {} · {} USDC · {} veMAMP · tasa: {}x10⁻⁹",
        pool.current_epoch,
        pool.total_distributed,
        pool.total_ve_mamp,
        usdc_per_ve_x9
    );

    Ok(())
}

// ── Contextos Anchor ──────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct StakeMamp<'info> {
    #[account(
        init_if_needed,
        payer  = staker,
        space  = VeStake::LEN,
        seeds  = [b"ve_stake", staker.key().as_ref()],
        bump,
    )]
    pub ve_stake: Account<'info, VeStake>,

    #[account(
        init_if_needed,
        payer  = staker,
        space  = ProtocolFeePool::LEN,
        seeds  = [b"protocol_fee_pool"],
        bump,
    )]
    pub fee_pool: Account<'info, ProtocolFeePool>,

    /// ATA de MAMP del staker (fuente)
    #[account(mut)]
    pub staker_mamp_ata: Account<'info, TokenAccount>,

    /// Vault del PDA donde se bloquea el MAMP
    #[account(
        mut,
        seeds  = [b"stake_vault", staker.key().as_ref()],
        bump,
        token::mint      = mamp_mint,
        token::authority = ve_stake,
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    /// CHECK: mint del token MAMP — verificado por stake_vault constraint
    pub mamp_mint: AccountInfo<'info>,

    #[account(mut)]
    pub staker: Signer<'info>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnstakeMamp<'info> {
    #[account(
        mut,
        seeds  = [b"ve_stake", staker.key().as_ref()],
        bump   = ve_stake.bump,
        has_one = staker @ MampTokenError::Unauthorized,
    )]
    pub ve_stake: Account<'info, VeStake>,

    #[account(
        mut,
        seeds  = [b"protocol_fee_pool"],
        bump   = fee_pool.bump,
    )]
    pub fee_pool: Account<'info, ProtocolFeePool>,

    #[account(mut)]
    pub staker_mamp_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds  = [b"stake_vault", staker.key().as_ref()],
        bump,
    )]
    pub stake_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub staker: Signer<'info>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DistributeProtocolFees<'info> {
    #[account(
        mut,
        seeds  = [b"protocol_fee_pool"],
        bump   = fee_pool.bump,
    )]
    pub fee_pool: Account<'info, ProtocolFeePool>,

    pub system_program: Program<'info, System>,
}

// ── Errores ───────────────────────────────────────────────────────────────────

#[error_code]
pub enum MampTokenError {
    #[msg("La cantidad debe ser mayor que cero")]
    ZeroAmount,
    #[msg("Duración de bloqueo inválida (mín 1 semana, máx 4 años)")]
    InvalidLockDuration,
    #[msg("Los tokens siguen bloqueados — espera hasta unlock_at")]
    StillLocked,
    #[msg("No hay fees acumulados para distribuir")]
    NoFeesToDistribute,
    #[msg("No hay stakers activos para recompensar")]
    NoStakersToReward,
    #[msg("No autorizado")]
    Unauthorized,
    #[msg("Overflow aritmético en cálculo de veMAMP")]
    ArithmeticOverflow,
}
