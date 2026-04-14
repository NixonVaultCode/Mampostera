// =============================================================================
//  MAMPOSTERA — Módulo Oracle de Valuación
//  Fase 3b | Precio de propiedad actualizable on-chain
//
//  Diseño: oracle "push" firmado por authority
//  La authority de Mampostera actualiza el precio periódicamente.
//  En Fase 4 se puede migrar a Switchboard/Pyth sin cambiar la interfaz.
//
//  Flujo:
//  1. Al inicializar la propiedad, se crea un PropertyOracle PDA vacío
//  2. Authority llama update_valuation(new_value_usd_cents) periódicamente
//     (mensual para propiedades residenciales)
//  3. El frontend lee PropertyOracle para mostrar precio actualizado
//  4. El mercado secundario puede leer el oracle para validar precios de oferta
//
//  Seguridad:
//  - Solo authority puede actualizar la valuación
//  - Límite de variación máxima: ±50% por actualización (evita manipulación)
//  - Timestamp de última actualización almacenado
//  - Historial de las últimas 5 valuaciones (circular buffer)
//  - Precio mínimo absol: $1,000 USD para evitar valuaciones abusivas
// =============================================================================

use anchor_lang::prelude::*;
use crate::errors::MamposteError;

// ─── Constantes ───────────────────────────────────────────────────────────────

/// Variación máxima permitida por actualización: 50%
pub const MAX_PRICE_CHANGE_BPS: u64 = 5_000;
/// Precio mínimo: $1,000 USD en centavos
pub const MIN_ORACLE_VALUE: u64 = 100_000;
/// Precio máximo: $500M USD en centavos (para propiedades comerciales grandes)
pub const MAX_ORACLE_VALUE: u64 = 50_000_000_000;
/// Tiempo mínimo entre actualizaciones: 1 día en segundos
pub const MIN_UPDATE_INTERVAL: i64 = 86_400;
/// Tamaño del historial circular
pub const HISTORY_SIZE: usize = 5;

// ─── Instrucciones ────────────────────────────────────────────────────────────

/// Inicializa el oracle para una propiedad (se llama junto con initialize_property).
pub fn initialize_oracle(
    ctx: Context<InitializeOracle>,
    initial_value_usd_cents: u64,
) -> Result<()> {
    require!(
        initial_value_usd_cents >= MIN_ORACLE_VALUE
            && initial_value_usd_cents <= MAX_ORACLE_VALUE,
        MamposteError::InvalidOracleValue
    );

    let oracle  = &mut ctx.accounts.property_oracle;
    let now     = Clock::get()?.unix_timestamp;

    oracle.property          = ctx.accounts.property_state.key();
    oracle.authority         = ctx.accounts.authority.key();
    oracle.current_value     = initial_value_usd_cents;
    oracle.last_updated      = now;
    oracle.update_count      = 0;
    oracle.bump              = ctx.bumps.property_oracle;
    oracle.price_history     = [initial_value_usd_cents; HISTORY_SIZE];
    oracle.history_head      = 0;

    emit!(OracleInitialized {
        oracle:    oracle.key(),
        property:  oracle.property,
        value:     initial_value_usd_cents,
        timestamp: now,
    });

    Ok(())
}

/// Authority actualiza la valuación de la propiedad.
/// Incluye circuit breaker: máximo ±50% de cambio por actualización.
pub fn update_valuation(
    ctx: Context<UpdateValuation>,
    new_value_usd_cents: u64,
) -> Result<()> {
    require!(
        new_value_usd_cents >= MIN_ORACLE_VALUE
            && new_value_usd_cents <= MAX_ORACLE_VALUE,
        MamposteError::InvalidOracleValue
    );

    let oracle  = &mut ctx.accounts.property_oracle;
    let now     = Clock::get()?.unix_timestamp;

    // ── Cooldown entre actualizaciones ────────────────────────────────────────
    let time_since_last = now
        .checked_sub(oracle.last_updated)
        .ok_or(MamposteError::ArithmeticOverflow)?;
    require!(
        time_since_last >= MIN_UPDATE_INTERVAL,
        MamposteError::OracleUpdateTooFrequent
    );

    // ── Circuit breaker: máximo ±50% de cambio ────────────────────────────────
    let current  = oracle.current_value;
    let max_up   = current
        .checked_mul(10_000 + MAX_PRICE_CHANGE_BPS)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(MamposteError::ArithmeticOverflow)?;
    let max_down = current
        .checked_mul(10_000 - MAX_PRICE_CHANGE_BPS)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    require!(
        new_value_usd_cents <= max_up && new_value_usd_cents >= max_down,
        MamposteError::OracleValueChangeTooBig
    );

    // ── Actualizar historial circular ─────────────────────────────────────────
    let head = oracle.history_head as usize;
    oracle.price_history[head] = oracle.current_value;
    oracle.history_head        = ((head + 1) % HISTORY_SIZE) as u8;

    let old_value        = oracle.current_value;
    oracle.current_value = new_value_usd_cents;
    oracle.last_updated  = now;
    oracle.update_count  = oracle.update_count
        .checked_add(1)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    emit!(ValuationUpdated {
        oracle:     oracle.key(),
        property:   oracle.property,
        old_value,
        new_value:  new_value_usd_cents,
        update_n:   oracle.update_count,
        timestamp:  now,
    });

    Ok(())
}

/// Lee la valuación actual. Convenience instruction para el frontend.
/// No modifica estado — solo emite el evento con el precio actual.
pub fn read_valuation(ctx: Context<ReadValuation>) -> Result<()> {
    let oracle = &ctx.accounts.property_oracle;

    emit!(ValuationRead {
        oracle:       oracle.key(),
        property:     oracle.property,
        current_value: oracle.current_value,
        last_updated: oracle.last_updated,
        update_count: oracle.update_count,
        timestamp:    Clock::get()?.unix_timestamp,
    });

    Ok(())
}

// ─── Account contexts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeOracle<'info> {
    #[account(
        init,
        payer  = authority,
        space  = PropertyOracle::LEN,
        seeds  = [b"oracle", property_state.key().as_ref()],
        bump
    )]
    pub property_oracle: Account<'info, PropertyOracle>,

    /// CHECK: Solo lectura para obtener la clave de la propiedad
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
pub struct UpdateValuation<'info> {
    #[account(
        mut,
        seeds = [b"oracle", property_oracle.property.as_ref()],
        bump  = property_oracle.bump,
    )]
    pub property_oracle: Account<'info, PropertyOracle>,

    #[account(
        seeds = [b"program_config"],
        bump  = program_config.bump,
        has_one = authority @ MamposteError::Unauthorized,
    )]
    pub program_config: Account<'info, crate::kyc::ProgramConfig>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ReadValuation<'info> {
    #[account(
        seeds = [b"oracle", property_oracle.property.as_ref()],
        bump  = property_oracle.bump,
    )]
    pub property_oracle: Account<'info, PropertyOracle>,
}

// ─── Data struct ──────────────────────────────────────────────────────────────

#[account]
pub struct PropertyOracle {
    pub property:      Pubkey,               // 32
    pub authority:     Pubkey,               // 32
    pub current_value: u64,                  // 8  USD cents
    pub last_updated:  i64,                  // 8
    pub update_count:  u64,                  // 8
    pub history_head:  u8,                   // 1  índice del circular buffer
    pub bump:          u8,                   // 1
    pub price_history: [u64; HISTORY_SIZE],  // 8 * 5 = 40
}

impl PropertyOracle {
    pub const LEN: usize =
        8               // discriminator
        + 32 + 32       // property, authority
        + 8 + 8 + 8     // current_value, last_updated, update_count
        + 1 + 1         // history_head, bump
        + 8 * HISTORY_SIZE; // price_history
}

// ─── Eventos ─────────────────────────────────────────────────────────────────

#[event]
pub struct OracleInitialized {
    pub oracle:    Pubkey,
    pub property:  Pubkey,
    pub value:     u64,
    pub timestamp: i64,
}

#[event]
pub struct ValuationUpdated {
    pub oracle:    Pubkey,
    pub property:  Pubkey,
    pub old_value: u64,
    pub new_value: u64,
    pub update_n:  u64,
    pub timestamp: i64,
}

#[event]
pub struct ValuationRead {
    pub oracle:        Pubkey,
    pub property:      Pubkey,
    pub current_value: u64,
    pub last_updated:  i64,
    pub update_count:  u64,
    pub timestamp:     i64,
}
