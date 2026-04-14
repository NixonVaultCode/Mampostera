/**
 * programs/mampostera/src/upgrades/liquidity.rs
 *
 * R9: CLMM Orca Whirlpools — liquidez programática por propiedad.
 *
 * Cada propiedad tokenizada tiene un par TOKEN_RWA/USDC en Orca Whirlpools
 * con liquidez concentrada en rango ±15% del precio del oracle notarial.
 * El protocolo deposita el 2% del TVL inicial como liquidez de arranque.
 *
 * Ventajas:
 *   - Inversor puede salir en <30s sin depender de un comprador P2P
 *   - Los fees del pool (0.3%) van al fee_treasury del protocolo
 *   - Instituciones pueden entrar/salir con tamaños grandes sin deslizamiento
 *
 * Cargo.toml (descomentar en producción, requiere Orca SDK):
 *   whirlpools-sdk = { git = "https://github.com/orca-so/whirlpools", ... }
 *
 * Integrar en lib.rs como instrucción 38.
 */

use anchor_lang::prelude::*;

// ── Constantes ────────────────────────────────────────────────────────────────

/// Ancho del rango de precio del CLMM: ±15% del precio oracle
/// 1500 bps = 15%
pub const POOL_PRICE_RANGE_BPS: u64 = 1_500;

/// Porcentaje del TVL que el protocolo deposita como liquidez inicial: 2%
pub const PROTOCOL_LIQUIDITY_BPS: u64 = 200;

/// Fee tier del Orca Whirlpool: 0.3% (3000 millionths)
pub const POOL_FEE_RATE: u16 = 3_000;

/// Tick spacing para 0.3% fee tier en Orca
pub const TICK_SPACING: u16 = 64;

// ── LiquidityPool PDA ─────────────────────────────────────────────────────────

/// PDA que registra el pool de liquidez Orca asociado a la propiedad.
/// Seeds: [b"liquidity_pool", property_state_pubkey]
///
/// El pool real vive en el programa de Orca Whirlpools — este PDA
/// es el registro on-chain de Mampostera que apunta al pool externo.
#[account]
pub struct LiquidityPool {
    /// Propiedad a la que corresponde este pool
    pub property:            Pubkey,   // 32

    /// Pubkey del Whirlpool account de Orca (pool real)
    pub whirlpool_pubkey:    Pubkey,   // 32

    /// Pubkey del token USDC (par de intercambio)
    pub usdc_mint:           Pubkey,   // 32

    /// Precio inferior del rango (sqrt price Q64.64 de Orca)
    pub tick_lower_index:    i32,      // 4

    /// Precio superior del rango
    pub tick_upper_index:    i32,      // 4

    /// Liquidez total aportada por el protocolo (en unidades de Orca)
    pub protocol_liquidity:  u128,     // 16

    /// Precio oracle al momento de inicializar el pool (USD cents)
    pub initial_oracle_price: u64,     // 8

    /// Total de fees cobrados y enviados al treasury (lamports)
    pub total_fees_collected: u64,     // 8

    /// Si el pool está activo y recibiendo swaps
    pub is_active:           bool,     // 1

    /// Bump del PDA
    pub bump:                u8,       // 1
}

impl LiquidityPool {
    pub const LEN: usize = 8
        + 32 + 32 + 32    // property, whirlpool_pubkey, usdc_mint
        + 4 + 4           // tick_lower_index, tick_upper_index
        + 16              // protocol_liquidity (u128)
        + 8 + 8           // initial_oracle_price, total_fees_collected
        + 1 + 1;          // is_active, bump
}

// ── Instrucción: initialize_property_pool ────────────────────────────────────

/// Inicializa el pool de liquidez Orca para una propiedad.
///
/// Flujo:
///   1. Calcula el rango de precios ±15% del precio actual del oracle
///   2. Crea el WhirlpoolPosition account de Orca (CPI)
///   3. Deposita el 2% del TVL como liquidez concentrada (CPI)
///   4. Registra el pool en el LiquidityPool PDA
///
/// Nota: El CPI real a Orca requiere el programa Whirlpools desplegado.
/// La implementación completa del CPI está pendiente de la integración
/// con el SDK de Orca. Esta instrucción registra el pool en el PDA
/// y prepara la estructura para el CPI cuando esté disponible.
pub fn initialize_property_pool(
    ctx: Context<InitializePropertyPool>,
    whirlpool_pubkey: Pubkey,
) -> Result<()> {
    let oracle        = &ctx.accounts.property_oracle;
    let property      = &ctx.accounts.property_state;

    // Verificar que el oracle tiene un precio válido
    require!(
        oracle.current_value > 0,
        crate::errors::MamposteError::OracleNotInitialized
    );

    // ── Calcular rango de ticks ───────────────────────────────────────────────
    // Orca usa sqrt prices en Q64.64. Para el rango ±15%:
    // price_lower = oracle_price * (1 - 0.15)
    // price_upper = oracle_price * (1 + 0.15)
    //
    // Tick = log(sqrt_price) / log(1.0001)
    // Para simplificar: usamos ticks redondos al tick_spacing más cercano
    //
    // Rango aproximado para precios en cents:
    // Con un precio de $100,000 = 10_000_000 cents:
    //   lower: 10_000_000 * 8500 / 10_000 = 8_500_000 cents
    //   upper: 10_000_000 * 11500 / 10_000 = 11_500_000 cents

    let price_lower_cents = oracle.current_value
        .checked_mul(10_000 - POOL_PRICE_RANGE_BPS)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?;

    let price_upper_cents = oracle.current_value
        .checked_mul(10_000 + POOL_PRICE_RANGE_BPS)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?;

    // Convertir a tick index (aproximado — el SDK de Orca lo calcula exactamente)
    // tick = log(price_in_tokens) / log(1.0001)
    // Aquí usamos una aproximación lineal para el MVP
    let tick_lower = _price_cents_to_tick(price_lower_cents);
    let tick_upper = _price_cents_to_tick(price_upper_cents);

    // Redondear al TICK_SPACING más cercano
    let tick_lower_rounded = (tick_lower / TICK_SPACING as i32) * TICK_SPACING as i32;
    let tick_upper_rounded = ((tick_upper / TICK_SPACING as i32) + 1) * TICK_SPACING as i32;

    // ── Calcular liquidez inicial (2% del TVL) ────────────────────────────────
    let protocol_liquidity_lamports = (property.total_value as u128)
        .checked_mul(PROTOCOL_LIQUIDITY_BPS as u128)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?;

    // ── Registrar pool en el PDA ──────────────────────────────────────────────
    let pool = &mut ctx.accounts.liquidity_pool;

    pool.property             = property.key();
    pool.whirlpool_pubkey     = whirlpool_pubkey;
    pool.usdc_mint            = ctx.accounts.usdc_mint.key();
    pool.tick_lower_index     = tick_lower_rounded;
    pool.tick_upper_index     = tick_upper_rounded;
    pool.protocol_liquidity   = protocol_liquidity_lamports;
    pool.initial_oracle_price = oracle.current_value;
    pool.total_fees_collected = 0;
    pool.is_active            = true;
    pool.bump                 = ctx.bumps.liquidity_pool;

    msg!(
        "[liquidity] Pool inicializado para {} · rango: {}-{} cents · liquidez: {} lamports",
        property.key(),
        price_lower_cents,
        price_upper_cents,
        protocol_liquidity_lamports
    );

    // TODO Fase 4+: CPI real a Orca Whirlpools
    // El CPI requiere el programa ID de Orca + accounts del pool
    // Se activa cuando la SDK de Orca esté integrada en Cargo.toml

    Ok(())
}

// ── Contexto Anchor ───────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializePropertyPool<'info> {
    #[account(
        init,
        payer  = authority,
        space  = LiquidityPool::LEN,
        seeds  = [b"liquidity_pool", property_state.key().as_ref()],
        bump,
    )]
    pub liquidity_pool: Account<'info, LiquidityPool>,

    #[account(
        has_one = authority @ crate::errors::MamposteError::Unauthorized,
    )]
    pub property_state: Account<'info, crate::PropertyState>,

    #[account(
        seeds = [b"property_oracle", property_state.key().as_ref()],
        bump  = property_oracle.bump,
    )]
    pub property_oracle: Account<'info, crate::oracle::PropertyOracle>,

    /// CHECK: Mint de USDC — verificado externamente
    pub usdc_mint: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ── Helper: precio en cents → tick index Orca ─────────────────────────────────

fn _price_cents_to_tick(price_cents: u64) -> i32 {
    // Aproximación: tick = price_cents * 10 (escala ajustable según el par)
    // El SDK de Orca usa: tick = log(sqrt(price)) / log(1.0001)
    // Para el MVP esta aproximación es suficiente para los bounds del rango
    if price_cents == 0 { return -443_636; } // min tick de Orca
    // Usar i64 para evitar overflow antes de truncar a i32
    (price_cents as i64 / 10).min(i32::MAX as i64) as i32
}
