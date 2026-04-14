// =============================================================================
//  MAMPOSTERA — Módulo Mercado Secundario P2P
//  Fase 2b | Swap atómico de tokens SPL contra SOL via escrow PDA
//
//  Flujo:
//  1. Vendedor llama create_offer(price_per_token, amount) →
//       tokens bloqueados en escrow PDA
//  2. Comprador llama accept_offer() →
//       SOL transferido al vendedor + tokens al comprador (atómico)
//  3. Vendedor puede cancel_offer() para recuperar tokens si nadie compró
//
//  Seguridad:
//  - Escrow PDA es el custodio de los tokens — nadie más puede sacarlos
//  - Transferencia atómica: o ambas ocurren o ninguna
//  - KYC verificado para el comprador antes de aceptar
//  - Fee del 0.5% para Mampostera en cada transacción secundaria
//  - Precio mínimo: 1 lamport por token para evitar ofertas basura
//  - Offer expiry: opcional, si el slot actual > expiry → cancelable por cualquiera
// =============================================================================

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Token, TokenAccount, Transfer as SplTransfer},
};

use crate::errors::MamposteError;
use crate::kyc::{InvestorProfile, KycStatus};

// ─── Constantes ───────────────────────────────────────────────────────────────

/// Fee de Mampostera: 0.5% = 50 basis points
pub const MARKET_FEE_BPS: u64 = 50;
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Precio mínimo: 1 lamport por token con 6 decimales
pub const MIN_PRICE_PER_TOKEN: u64 = 1;
/// Mínimo de tokens por oferta: 1 token completo
pub const MIN_OFFER_AMOUNT: u64 = 1_000_000; // 1 token con 6 dec

/// Slots de vida máxima de una oferta (~7 días a ~400ms/slot)
pub const MAX_OFFER_DURATION_SLOTS: u64 = 1_512_000;

// ─── Instrucciones ────────────────────────────────────────────────────────────

/// Vendedor crea una oferta y deposita tokens en el escrow PDA.
pub fn create_offer(
    ctx: Context<CreateOffer>,
    amount_tokens: u64,
    price_lamports_per_token: u64,
    expiry_slots: Option<u64>,
) -> Result<()> {
    // ── Validaciones ──────────────────────────────────────────────────────────
    require!(amount_tokens >= MIN_OFFER_AMOUNT, MamposteError::OfferAmountTooSmall);
    require!(
        price_lamports_per_token >= MIN_PRICE_PER_TOKEN,
        MamposteError::OfferPriceTooLow
    );

    // Verificar que el vendedor tenga suficientes tokens
    require!(
        ctx.accounts.seller_token_account.amount >= amount_tokens,
        MamposteError::InsufficientTokenBalance
    );

    // Validar expiración si se provee
    let current_slot = Clock::get()?.slot;
    let expiry = if let Some(slots) = expiry_slots {
        require!(slots > 0 && slots <= MAX_OFFER_DURATION_SLOTS, MamposteError::InvalidOfferExpiry);
        current_slot.checked_add(slots).ok_or(MamposteError::ArithmeticOverflow)?
    } else {
        u64::MAX // sin expiración
    };

    // Calcular total en SOL que pagará el comprador
    let total_price = (amount_tokens as u128)
        .checked_mul(price_lamports_per_token as u128)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(1_000_000) // ajustar por 6 decimales del token
        .ok_or(MamposteError::ArithmeticOverflow)? as u64;

    require!(total_price > 0, MamposteError::OfferPriceTooLow);

    // ── Inicializar estado de la oferta ───────────────────────────────────────
    let offer = &mut ctx.accounts.offer;
    offer.seller                  = ctx.accounts.seller.key();
    offer.property_mint           = ctx.accounts.property_mint.key();
    offer.amount_tokens           = amount_tokens;
    offer.price_lamports_per_token = price_lamports_per_token;
    offer.total_price_lamports    = total_price;
    offer.created_at_slot         = current_slot;
    offer.expiry_slot             = expiry;
    offer.is_active               = true;
    offer.bump                    = ctx.bumps.offer;
    offer.escrow_bump             = ctx.bumps.escrow_token_account;

    // ── Transferir tokens del vendedor al escrow PDA ──────────────────────────
    let cpi_accounts = SplTransfer {
        from:      ctx.accounts.seller_token_account.to_account_info(),
        to:        ctx.accounts.escrow_token_account.to_account_info(),
        authority: ctx.accounts.seller.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        amount_tokens,
    )?;

    emit!(OfferCreated {
        offer:                    ctx.accounts.offer.key(),
        seller:                   offer.seller,
        property_mint:            offer.property_mint,
        amount_tokens,
        price_lamports_per_token,
        total_price_lamports:     total_price,
        expiry_slot:              expiry,
        timestamp:                Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Comprador acepta la oferta. Swap atómico SOL ↔ tokens.
pub fn accept_offer(ctx: Context<AcceptOffer>) -> Result<()> {
    let offer = &mut ctx.accounts.offer;

    // ── Validaciones ──────────────────────────────────────────────────────────
    require!(offer.is_active, MamposteError::OfferNotActive);

    let current_slot = Clock::get()?.slot;
    require!(current_slot <= offer.expiry_slot, MamposteError::OfferExpired);

    // KYC: verificar que el comprador esté aprobado
    require!(
        ctx.accounts.buyer_kyc.status == KycStatus::Approved,
        MamposteError::InvestorNotApproved
    );

    // El comprador no puede ser el vendedor
    require!(
        ctx.accounts.buyer.key() != offer.seller,
        MamposteError::BuyerIsSeller
    );

    // ── Calcular fee de Mampostera ────────────────────────────────────────────
    let fee_lamports = (offer.total_price_lamports as u128)
        .checked_mul(MARKET_FEE_BPS as u128)
        .ok_or(MamposteError::ArithmeticOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(MamposteError::ArithmeticOverflow)? as u64;

    let seller_receives = offer
        .total_price_lamports
        .checked_sub(fee_lamports)
        .ok_or(MamposteError::ArithmeticOverflow)?;

    // ── 1. SOL del comprador → vendedor ──────────────────────────────────────
    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to:   ctx.accounts.seller.to_account_info(),
            },
        ),
        seller_receives,
    )?;

    // ── 2. SOL del comprador → fee treasury de Mampostera ────────────────────
    if fee_lamports > 0 {
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to:   ctx.accounts.fee_treasury.to_account_info(),
                },
            ),
            fee_lamports,
        )?;
    }

    // ── 3. Tokens del escrow → comprador (PDA firma) ──────────────────────────
    let offer_key     = ctx.accounts.offer.key();
    let escrow_seeds: &[&[u8]] = &[
        b"escrow",
        offer_key.as_ref(),
        &[offer.escrow_bump],
    ];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SplTransfer {
                from:      ctx.accounts.escrow_token_account.to_account_info(),
                to:        ctx.accounts.buyer_token_account.to_account_info(),
                authority: ctx.accounts.escrow_token_account.to_account_info(),
            },
            &[escrow_seeds],
        ),
        offer.amount_tokens,
    )?;

    // ── Marcar oferta como inactiva ───────────────────────────────────────────
    offer.is_active = false;

    emit!(OfferAccepted {
        offer:               ctx.accounts.offer.key(),
        seller:              offer.seller,
        buyer:               ctx.accounts.buyer.key(),
        amount_tokens:       offer.amount_tokens,
        total_price_lamports: offer.total_price_lamports,
        fee_lamports,
        seller_receives,
        timestamp:           Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Vendedor cancela la oferta y recupera sus tokens del escrow.
/// También cancela si la oferta está expirada (cualquiera puede llamarlo).
pub fn cancel_offer(ctx: Context<CancelOffer>) -> Result<()> {
    let offer = &ctx.accounts.offer;

    require!(offer.is_active, MamposteError::OfferNotActive);

    let current_slot = Clock::get()?.slot;
    let is_expired   = current_slot > offer.expiry_slot;
    let is_seller    = ctx.accounts.signer.key() == offer.seller;

    // Solo el vendedor puede cancelar, O cualquiera si está expirada
    require!(
        is_seller || is_expired,
        MamposteError::Unauthorized
    );

    // ── Devolver tokens del escrow → vendedor ─────────────────────────────────
    let offer_key     = ctx.accounts.offer.key();
    let escrow_seeds: &[&[u8]] = &[
        b"escrow",
        offer_key.as_ref(),
        &[offer.escrow_bump],
    ];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SplTransfer {
                from:      ctx.accounts.escrow_token_account.to_account_info(),
                to:        ctx.accounts.seller_token_account.to_account_info(),
                authority: ctx.accounts.escrow_token_account.to_account_info(),
            },
            &[escrow_seeds],
        ),
        ctx.accounts.escrow_token_account.amount,
    )?;

    ctx.accounts.offer.is_active = false;

    emit!(OfferCancelled {
        offer:     ctx.accounts.offer.key(),
        seller:    offer.seller,
        cancelled_by: ctx.accounts.signer.key(),
        reason:    if is_expired { "expired" } else { "seller_cancelled" }.to_string(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

// ─── Account contexts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CreateOffer<'info> {
    /// Estado de la oferta — PDA única por (vendedor, mint, slot)
    #[account(
        init,
        payer  = seller,
        space  = Offer::LEN,
        seeds  = [
            b"offer",
            seller.key().as_ref(),
            property_mint.key().as_ref(),
            &Clock::get()?.slot.to_le_bytes(),
        ],
        bump
    )]
    pub offer: Account<'info, Offer>,

    /// Cuenta escrow que custodia los tokens durante la oferta
    /// Es una TokenAccount PDA — el escrow PDA es su authority
    #[account(
        init,
        payer  = seller,
        token::mint      = property_mint,
        token::authority = escrow_token_account,
        seeds  = [b"escrow", offer.key().as_ref()],
        bump
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// Token account del vendedor (origen de los tokens)
    #[account(
        mut,
        associated_token::mint      = property_mint,
        associated_token::authority = seller,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    pub property_mint: Account<'info, anchor_spl::token::Mint>,

    #[account(mut)]
    pub seller: Signer<'info>,

    pub system_program:           Program<'info, System>,
    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent:                     Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AcceptOffer<'info> {
    #[account(
        mut,
        seeds = [
            b"offer",
            offer.seller.as_ref(),
            offer.property_mint.as_ref(),
            &offer.created_at_slot.to_le_bytes(),
        ],
        bump  = offer.bump,
        constraint = offer.is_active @ MamposteError::OfferNotActive,
    )]
    pub offer: Account<'info, Offer>,

    #[account(
        mut,
        seeds  = [b"escrow", offer.key().as_ref()],
        bump   = offer.escrow_bump,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// ATA del comprador — se crea si no existe
    #[account(
        init_if_needed,
        payer  = buyer,
        associated_token::mint      = property_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    pub property_mint: Account<'info, anchor_spl::token::Mint>,

    /// KYC del comprador — debe estar Approved
    #[account(
        seeds = [b"investor_kyc", buyer.key().as_ref()],
        bump  = buyer_kyc.bump,
    )]
    pub buyer_kyc: Account<'info, InvestorProfile>,

    /// CHECK: vendedor recibe SOL — validado por offer.seller
    #[account(mut, address = offer.seller @ MamposteError::Unauthorized)]
    pub seller: UncheckedAccount<'info>,

    /// CHECK: PDA treasury de Mampostera — recibe el fee
    #[account(
        mut,
        seeds = [b"fee_treasury"],
        bump,
    )]
    pub fee_treasury: UncheckedAccount<'info>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub system_program:           Program<'info, System>,
    pub token_program:            Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub rent:                     Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CancelOffer<'info> {
    #[account(
        mut,
        seeds = [
            b"offer",
            offer.seller.as_ref(),
            offer.property_mint.as_ref(),
            &offer.created_at_slot.to_le_bytes(),
        ],
        bump = offer.bump,
    )]
    pub offer: Account<'info, Offer>,

    #[account(
        mut,
        seeds  = [b"escrow", offer.key().as_ref()],
        bump   = offer.escrow_bump,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// ATA del vendedor (recibe tokens de vuelta)
    #[account(
        mut,
        associated_token::mint      = property_mint,
        associated_token::authority = seller,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    /// CHECK: dirección del vendedor para ATA constraint
    #[account(address = offer.seller)]
    pub seller: UncheckedAccount<'info>,

    pub property_mint: Account<'info, anchor_spl::token::Mint>,

    /// Quien firma — puede ser el vendedor o cualquiera si está expirada
    #[account(mut)]
    pub signer: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ─── Data structs ─────────────────────────────────────────────────────────────

#[account]
pub struct Offer {
    pub seller:                    Pubkey,  // 32
    pub property_mint:             Pubkey,  // 32
    pub amount_tokens:             u64,     // 8
    pub price_lamports_per_token:  u64,     // 8
    pub total_price_lamports:      u64,     // 8
    pub created_at_slot:           u64,     // 8
    pub expiry_slot:               u64,     // 8
    pub is_active:                 bool,    // 1
    pub bump:                      u8,      // 1
    pub escrow_bump:               u8,      // 1
}

impl Offer {
    pub const LEN: usize =
        8               // discriminator
        + 32 + 32       // seller, property_mint
        + 8 + 8 + 8     // amount_tokens, price_per_token, total_price
        + 8 + 8         // created_at_slot, expiry_slot
        + 1 + 1 + 1;    // is_active, bump, escrow_bump
}

// ─── Eventos ─────────────────────────────────────────────────────────────────

#[event]
pub struct OfferCreated {
    pub offer:                    Pubkey,
    pub seller:                   Pubkey,
    pub property_mint:            Pubkey,
    pub amount_tokens:            u64,
    pub price_lamports_per_token: u64,
    pub total_price_lamports:     u64,
    pub expiry_slot:              u64,
    pub timestamp:                i64,
}

#[event]
pub struct OfferAccepted {
    pub offer:                Pubkey,
    pub seller:               Pubkey,
    pub buyer:                Pubkey,
    pub amount_tokens:        u64,
    pub total_price_lamports: u64,
    pub fee_lamports:         u64,
    pub seller_receives:      u64,
    pub timestamp:            i64,
}

#[event]
pub struct OfferCancelled {
    pub offer:        Pubkey,
    pub seller:       Pubkey,
    pub cancelled_by: Pubkey,
    pub reason:       String,
    pub timestamp:    i64,
}
