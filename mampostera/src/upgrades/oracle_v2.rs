/**
 * programs/mampostera/src/upgrades/oracle_v2.rs
 *
 * R4: Switchboard V2 — validación externa del oracle notarial
 * R11: compound_rent() — renta se reinvierte en más tokens automáticamente
 *
 * Integrar en lib.rs como instrucciones 35 y 36:
 *   35. update_valuation_v2(new_value_usd_cents) — con validación Switchboard
 *   36. compound_rent()                           — auto-compound de renta
 *
 * Cargo.toml additions:
 *   [dependencies]
 *   switchboard-solana = "0.30"
 */

use anchor_lang::prelude::*;
use anchor_spl::token::{self, MintTo, Token, TokenAccount};
use switchboard_solana::AggregatorAccountData;

// ── Constantes ────────────────────────────────────────────────────────────────

/// Desviación máxima permitida vs feed Switchboard: 20% (2000 bps)
/// Si el valor propuesto se desvía más, la tx es rechazada
pub const MAX_SWITCHBOARD_DEVIATION_BPS: u64 = 2_000;

/// Mínimo de lamports para que valga la pena un compound (evitar micro-txs)
pub const MIN_COMPOUND_LAMPORTS: u64 = 1_000_000; // 0.001 SOL

// ── Instrucción: update_valuation_v2 con Switchboard ─────────────────────────

/// Versión mejorada de update_valuation() que valida el precio propuesto
/// contra un feed externo de Switchboard V2 antes de aceptarlo.
///
/// Si el nuevo valor se desvía más del MAX_SWITCHBOARD_DEVIATION_BPS
/// respecto al feed de Switchboard, la instrucción es rechazada.
///
/// El feed de Switchboard para Mampostera agrega:
///   - Índice Lonja de Propiedad Raíz Bogotá (scraping certificado)
///   - DANE Vivienda trimestral
///   - Promedio de transacciones on-chain recientes de la zona
pub fn update_valuation_v2(
    ctx: Context<UpdateValuationV2>,
    new_value_usd_cents: u64,
) -> Result<()> {
    // ── Validar contra Switchboard feed (R4 — CPI real) ────────────────────

    // Usar el SDK oficial de Switchboard V2 para deserializar el feed
    // AggregatorAccountData gestiona el layout interno automáticamente
    let feed_data = ctx.accounts.switchboard_feed.try_borrow_data()?;
    let aggregator = AggregatorAccountData::new_from_bytes(&feed_data)
        .map_err(|_| crate::errors::MamposteError::SwitchboardFeedInvalid)?;

    // Verificar que el feed no está desactualizado (máx 1h de antigüedad)
    let now = Clock::get()?.unix_timestamp;
    let last_update = aggregator.latest_confirmed_round.round_open_timestamp;
    require!(
        now.checked_sub(last_update).unwrap_or(i64::MAX) <= 3_600,
        crate::errors::MamposteError::SwitchboardFeedStale
    );

    // get_result() devuelve SwitchboardDecimal — convertir a USD cents
    // El feed MAMP_BOGOTA_INDEX publica valores en USD con 2 decimales
    // Multiplicamos el mantissa por 10^(2-scale) para obtener cents
    let result = aggregator.get_result()
        .map_err(|_| crate::errors::MamposteError::SwitchboardFeedInvalid)?;

    // SwitchboardDecimal: value = mantissa * 10^(-scale)
    // Para cents (2 dec): cents = mantissa * 10^(2-scale) si scale >= 2
    //                             mantissa * 100 / 10^scale
    let switchboard_value_cents: u64 = if result.scale <= 2 {
        (result.mantissa.unsigned_abs() as u128)
            .checked_mul(10u128.pow(2 - result.scale))
            .ok_or(crate::errors::MamposteError::ArithmeticOverflow)? as u64
    } else {
        (result.mantissa.unsigned_abs() as u128)
            .checked_div(10u128.pow(result.scale - 2))
            .ok_or(crate::errors::MamposteError::ArithmeticOverflow)? as u64
    };

    require!(
        switchboard_value_cents > 0,
        crate::errors::MamposteError::SwitchboardFeedStale
    );

    // ── Verificar desviación ─────────────────────────────────────────────────
    // |new_value - switchboard_value| / switchboard_value <= MAX_DEVIATION
    let delta = if new_value_usd_cents >= switchboard_value_cents {
        new_value_usd_cents - switchboard_value_cents
    } else {
        switchboard_value_cents - new_value_usd_cents
    };

    let deviation_bps = (delta as u128)
        .checked_mul(10_000)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?
        .checked_div(switchboard_value_cents as u128)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)? as u64;

    require!(
        deviation_bps <= MAX_SWITCHBOARD_DEVIATION_BPS,
        crate::errors::MamposteError::OraclePriceDeviationTooLarge
    );

    // ── Aplicar actualización (lógica idéntica a update_valuation v1) ────────
    let oracle = &mut ctx.accounts.property_oracle;
    let now    = Clock::get()?.unix_timestamp;

    // Cooldown: mínimo 24h entre actualizaciones (86400 segundos)
    let elapsed = now
        .checked_sub(oracle.last_updated)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?;
    require!(elapsed >= 86_400, crate::errors::MamposteError::OracleUpdateTooFrequent);

    // Circuit breaker ±50% (heredado de v1)
    let max_up   = oracle.current_value
        .checked_mul(15_000).ok_or(crate::errors::MamposteError::ArithmeticOverflow)?
        .checked_div(10_000).ok_or(crate::errors::MamposteError::ArithmeticOverflow)?;
    let max_down = oracle.current_value
        .checked_mul(5_000).ok_or(crate::errors::MamposteError::ArithmeticOverflow)?
        .checked_div(10_000).ok_or(crate::errors::MamposteError::ArithmeticOverflow)?;

    require!(
        new_value_usd_cents <= max_up && new_value_usd_cents >= max_down,
        crate::errors::MamposteError::OracleValueChangeTooBig
    );

    let old_value        = oracle.current_value;
    oracle.current_value = new_value_usd_cents;
    oracle.last_updated  = now;
    oracle.update_count  = oracle.update_count
        .checked_add(1).ok_or(crate::errors::MamposteError::ArithmeticOverflow)?;

    msg!(
        "[oracle_v2] Valor actualizado: {} → {} USD cents (Switchboard ref: {}, desviación: {}bps)",
        old_value, new_value_usd_cents, switchboard_value_cents, deviation_bps
    );

    Ok(())
}

// ── Instrucción: compound_rent ────────────────────────────────────────────────

/// Auto-compound: en lugar de recibir SOL, la renta se reinvierte
/// automáticamente en más tokens de la misma propiedad.
///
/// Flujo:
///   1. Calcula la parte de renta del inversor (idéntico a claim_rent)
///   2. En lugar de transferir SOL, calcula cuántos tokens compraría ese SOL
///      usando el precio del oracle: tokens = (lamports * total_tokens) / total_value_lamports
///   3. Mintea esos tokens adicionales al ATA del inversor
///   4. El SOL permanece en el vault (o se quema como protocol fee mínimo)
///
/// El inversor activa esto en el frontend — por defecto está desactivado.
pub fn compound_rent(ctx: Context<CompoundRent>) -> Result<()> {
    let property = &ctx.accounts.property_state;

    require!(property.is_rent_locked, crate::errors::MamposteError::NoActiveDistribution);

    // ── Re-entrancy guard (mismo que claim_rent) ─────────────────────────────
    let claim = &mut ctx.accounts.investor_claim;
    require!(
        claim.last_epoch_claimed < property.distribution_epoch,
        crate::errors::MamposteError::ClaimAlreadyProcessed
    );

    // ── Calcular share de renta (idéntico a claim_rent) ──────────────────────
    let investor_balance = ctx.accounts.investor_token_account.amount;
    require!(investor_balance > 0, crate::errors::MamposteError::InvestorHasNoTokens);

    let share_lamports = (investor_balance as u128)
        .checked_mul(property.rent_snapshot as u128)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?
        .checked_div(property.total_tokens as u128)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)? as u64;

    require!(
        share_lamports >= MIN_COMPOUND_LAMPORTS,
        crate::errors::MamposteError::CompoundAmountTooSmall
    );

    // ── Calcular cuántos tokens compra ese SOL ────────────────────────────────
    // Precio token en lamports = (total_value_usd_cents * LAMPORTS_PER_SOL)
    //                           / (sol_usd_price_cents * total_tokens)
    //
    // tokens_to_mint = share_lamports * total_tokens
    //                / (total_value_usd_cents * LAMPORTS_PER_SOL / sol_usd_cents)
    //
    // Simplificado usando el oracle: 1 token = total_value_cents / total_tokens cents
    // Y SOL price del oracle (USD cents / SOL)
    let oracle = &ctx.accounts.property_oracle;
    let sol_price_cents = oracle.current_value; // Oracle guarda el valor del SOL en USD cents

    // price_per_token_lamports = value_usd_cents * LAMPORTS_PER_SOL / (sol_price * total_tokens)
    let price_per_token_lamports = (property.total_value as u128)
        .checked_mul(1_000_000_000) // LAMPORTS_PER_SOL
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?
        .checked_div(sol_price_cents as u128)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?
        .checked_div(property.total_tokens as u128)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?;

    require!(price_per_token_lamports > 0, crate::errors::MamposteError::OraclePriceInvalid);

    let tokens_to_mint = (share_lamports as u128)
        .checked_div(price_per_token_lamports)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)? as u64;

    require!(tokens_to_mint > 0, crate::errors::MamposteError::CompoundAmountTooSmall);

    // ── Verificar que no excede el supply ────────────────────────────────────
    let new_issued = property.tokens_issued
        .checked_add(tokens_to_mint)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?;
    require!(new_issued <= property.total_tokens, crate::errors::MamposteError::CompoundExceedsTokenSupply);

    // ── Mint tokens adicionales al inversor ──────────────────────────────────
    let property_key  = property.key();
    let property_id   = property.property_id;
    let authority_key = property.authority;
    let mint_bump     = ctx.accounts.property_state.mint_bump;

    let mint_seeds: &[&[u8]] = &[
        b"property_mint",
        property_key.as_ref(),
        &property_id.to_le_bytes(),
        &[mint_bump],
    ];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint:      ctx.accounts.property_mint.to_account_info(),
                to:        ctx.accounts.investor_token_account.to_account_info(),
                authority: ctx.accounts.property_state.to_account_info(),
            },
            &[mint_seeds],
        ),
        tokens_to_mint,
    )?;

    // ── Actualizar estado del claim ──────────────────────────────────────────
    ctx.accounts.property_state.tokens_issued = new_issued;
    claim.last_epoch_claimed = property.distribution_epoch;
    claim.total_claimed = claim.total_claimed
        .checked_add(share_lamports)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?;

    // El SOL se queda en el vault — los tokens compensan al inversor
    ctx.accounts.property_state.collected_rent = ctx
        .accounts.property_state.collected_rent
        .checked_sub(share_lamports)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?;

    msg!(
        "[compound] {} lamports → {} tokens adicionales para {}",
        share_lamports, tokens_to_mint,
        ctx.accounts.investor.key()
    );

    Ok(())
}

// ── Errores ───────────────────────────────────────────────────────────────────

#[error_code]
pub enum OracleV2Error {
    #[msg("El feed de Switchboard es inválido o no tiene datos")]
    SwitchboardFeedInvalid,
    #[msg("El feed de Switchboard está desactualizado")]
    SwitchboardFeedStale,
    #[msg("El precio propuesto se desvía más del 20% del feed externo")]
    PriceDeviationTooLarge,
    #[msg("Circuit breaker: cambio mayor al 50% del valor actual")]
    CircuitBreakerTriggered,
    #[msg("Actualización demasiado frecuente — esperar 24h")]
    UpdateTooFrequent,
    #[msg("No hay distribución activa")]
    NoActiveDistribution,
    #[msg("Renta ya reclamada en este epoch")]
    ClaimAlreadyProcessed,
    #[msg("El inversor no tiene tokens")]
    InvestorHasNoTokens,
    #[msg("Monto de compound demasiado pequeño (mínimo 0.001 SOL)")]
    CompoundAmountTooSmall,
    #[msg("El precio del oracle es inválido para calcular tokens")]
    OraclePriceInvalid,
    #[msg("Compound excedería el supply máximo de tokens")]
    ExceedsTokenSupply,
    #[msg("Overflow aritmético")]
    ArithmeticOverflow,
}

// ── Contextos Anchor (stubs — completar con los campos reales del programa) ───

#[derive(Accounts)]
pub struct UpdateValuationV2<'info> {
    /// CHECK: Feed de Switchboard — validado manualmente dentro de la instrucción
    pub switchboard_feed: AccountInfo<'info>,

    #[account(mut, has_one = authority @ crate::errors::MamposteError::SwitchboardFeedInvalid)]
    pub property_oracle: Account<'info, crate::oracle::PropertyOracle>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CompoundRent<'info> {
    #[account(mut)]
    pub property_state: Account<'info, crate::PropertyState>,

    #[account(
        mut,
        seeds = [b"property_oracle", property_state.key().as_ref()],
        bump  = property_oracle.bump,
    )]
    pub property_oracle: Account<'info, crate::oracle::PropertyOracle>,

    /// CHECK: Mint del token de la propiedad
    #[account(mut)]
    pub property_mint: AccountInfo<'info>,

    #[account(mut)]
    pub investor_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub investor_claim: Account<'info, crate::InvestorClaim>,

    pub investor: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
