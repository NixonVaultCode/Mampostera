/**
 * programs/mampostera/src/upgrades/security.rs
 *
 * FASE 0 — Blockers mainnet:
 *   R1: Squads Protocol multisig 3/5 como authority del programa
 *   R2: TimelockProposal PDA — 48h antes de ejecutar cambios críticos
 *   R3: Transferir upgrade authority (ver README_DEPLOY.md)
 *
 * Integrar en lib.rs:
 *   1. Añadir `pub mod upgrades;` al inicio
 *   2. Las instrucciones propose_critical_op y execute_critical_op
 *      se añaden como instrucciones 33 y 34 del programa
 *
 * Cargo.toml additions:
 *   [dependencies]
 *   squads-multisig = { version = "0.3", features = ["cpi"] }
 */

use anchor_lang::prelude::*;
use anchor_lang::system_program;

// ── Constantes de seguridad ────────────────────────────────────────────────────

/// 48 horas en segundos — ventana de reacción ante oracle manipulation
pub const TIMELOCK_DELAY_SECS: i64 = 48 * 3600;

/// Threshold del multisig Squads: 3 de 5 firmantes
pub const MULTISIG_THRESHOLD: u8 = 3;

// ── Tipos de operaciones que requieren timelock ───────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum OperationType {
    UpdateValuation,      // Oracle notarial — riesgo de manipulación de precio
    ToggleProperty,       // Pausar/activar propiedad — afecta liquidez de inversores
    ApproveKycBatch,      // Aprobar múltiples KYC — riesgo de bypass de compliance
    UpdateProtocolFee,    // Cambiar fee de mercado — afecta a todos los usuarios
    UpdateLtvParams,      // Cambiar parámetros de préstamo — riesgo sistémico
    EmergencyPause,       // Pausar todo el protocolo — acción de emergencia
}

// ── TimelockProposal PDA ──────────────────────────────────────────────────────

/// PDA que representa una operación crítica pendiente de ejecución.
/// Seeds: [b"timelock", proposer_pubkey, operation_hash (8 bytes)]
///
/// Flujo:
///   1. Authority llama propose_critical_op() → crea TimelockProposal
///   2. Espera 48 horas (o menos en emergencias con override multisig)
///   3. Authority llama execute_critical_op() → verifica timelock → ejecuta
///   4. Cualquier firmante del multisig puede llamar cancel_critical_op()
#[account]
pub struct TimelockProposal {
    /// Tipo de operación a ejecutar
    pub operation_type:    OperationType,

    /// Payload serializado de la operación (máx 256 bytes)
    /// Para UpdateValuation: new_value_usd_cents (u64, 8 bytes)
    /// Para ToggleProperty: property_pubkey (32 bytes) + new_state (bool, 1 byte)
    pub payload:           [u8; 256],

    /// Longitud real del payload (evita leer bytes basura)
    pub payload_len:       u16,

    /// Pubkey de la propiedad afectada (si aplica)
    pub target_property:   Option<Pubkey>,

    /// Quién propuso la operación
    pub proposed_by:       Pubkey,

    /// Timestamp Unix cuando se propuso
    pub proposed_at:       i64,

    /// Timestamp Unix mínimo para ejecutar = proposed_at + TIMELOCK_DELAY_SECS
    pub execute_at:        i64,

    /// Si fue cancelado por el multisig
    pub is_cancelled:      bool,

    /// Si ya fue ejecutado (evita replay)
    pub is_executed:       bool,

    /// Bump del PDA para signing
    pub bump:              u8,
}

impl TimelockProposal {
    pub const LEN: usize = 8   // discriminator
        + 1 + 1                // operation_type (enum) + padding
        + 256                  // payload
        + 2                    // payload_len
        + 1 + 32               // Option<Pubkey>
        + 32                   // proposed_by
        + 8                    // proposed_at
        + 8                    // execute_at
        + 1                    // is_cancelled
        + 1                    // is_executed
        + 1;                   // bump
}

// ── Instrucción: proponer operación crítica ───────────────────────────────────

/// Crea un TimelockProposal PDA para una operación crítica.
/// La operación no se ejecuta inmediatamente — espera TIMELOCK_DELAY_SECS.
///
/// Ejemplo de uso para update_valuation:
///   let payload = new_value_usd_cents.to_le_bytes();
///   propose_critical_op(OperationType::UpdateValuation, payload, Some(property_key))
pub fn propose_critical_op(
    ctx: Context<ProposeCriticalOp>,
    operation_type: OperationType,
    payload: Vec<u8>,
    target_property: Option<Pubkey>,
) -> Result<()> {
    require!(
        payload.len() <= 256,
        crate::errors::MamposteError::TimelockPayloadTooLarge
    );

    let now = Clock::get()?.unix_timestamp;
    let proposal = &mut ctx.accounts.timelock_proposal;

    proposal.operation_type  = operation_type;
    proposal.payload_len     = payload.len() as u16;
    proposal.target_property = target_property;
    proposal.proposed_by     = ctx.accounts.authority.key();
    proposal.proposed_at     = now;
    proposal.execute_at      = now
        .checked_add(TIMELOCK_DELAY_SECS)
        .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?;
    proposal.is_cancelled    = false;
    proposal.is_executed     = false;
    proposal.bump            = ctx.bumps.timelock_proposal;

    // Copiar payload al array fijo
    let mut payload_arr = [0u8; 256];
    payload_arr[..payload.len()].copy_from_slice(&payload);
    proposal.payload = payload_arr;

    msg!(
        "[timelock] Propuesta creada: {:?} — ejecutable en {} ({}h)",
        proposal.operation_type,
        proposal.execute_at,
        TIMELOCK_DELAY_SECS / 3600
    );

    Ok(())
}

// ── Instrucción: cancelar propuesta ──────────────────────────────────────────

/// Cancela un TimelockProposal antes de que sea ejecutado.
/// Solo puede llamarse mientras is_executed = false.
/// En la versión final, requerirá firma del multisig Squads.
pub fn cancel_critical_op(ctx: Context<CancelCriticalOp>) -> Result<()> {
    let proposal = &mut ctx.accounts.timelock_proposal;

    require!(!proposal.is_executed, crate::errors::MamposteError::ProposalAlreadyExecuted);
    require!(!proposal.is_cancelled, crate::errors::MamposteError::ProposalAlreadyCancelled);

    proposal.is_cancelled = true;

    msg!(
        "[timelock] Propuesta cancelada por {}",
        ctx.accounts.authority.key()
    );

    Ok(())
}

// ── Helper: verificar que el timelock expiró ─────────────────────────────────

/// Llamar al inicio de execute_* instrucciones para verificar el timelock.
/// Si el timelock no expiró, la instrucción falla con TimelockNotExpired.
///
/// Uso en update_valuation():
///   verify_timelock_expired(&proposal)?;
pub fn verify_timelock_expired(proposal: &TimelockProposal) -> Result<()> {
    require!(!proposal.is_cancelled, crate::errors::MamposteError::ProposalCancelled);
    require!(!proposal.is_executed, crate::errors::MamposteError::ProposalAlreadyExecuted);

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= proposal.execute_at,
        crate::errors::MamposteError::TimelockNotExpired
    );

    Ok(())
}

// ── Contextos Anchor ──────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(operation_type: OperationType, payload: Vec<u8>)]
pub struct ProposeCriticalOp<'info> {
    #[account(
        init,
        payer = authority,
        space = TimelockProposal::LEN,
        seeds = [
            b"timelock",
            authority.key().as_ref(),
            // Hash de los primeros 8 bytes del payload como discriminador único
            &payload.get(..8).unwrap_or(&[0u8; 8]).try_into().unwrap_or([0u8; 8]),
        ],
        bump
    )]
    pub timelock_proposal: Account<'info, TimelockProposal>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelCriticalOp<'info> {
    #[account(
        mut,
        has_one = proposed_by @ crate::errors::MamposteError::Unauthorized,
        // El PDA se cierra y los lamports van de vuelta a la authority
        close = authority,
    )]
    pub timelock_proposal: Account<'info, TimelockProposal>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

// Errores: ver crate::errors::MamposteError (centralizado en errors.rs)

// ── README de deploy: transferir upgrade authority ────────────────────────────
// IMPORTANTE: Ejecutar ANTES del deploy mainnet:
//
// 1. Crear multisig Squads (squad.so):
//    - 5 miembros: founder_1, founder_2, cto, legal, cold_storage
//    - Threshold: 3
//    - Guardar el multisig_pubkey
//
// 2. Transferir upgrade authority:
//    solana program set-upgrade-authority <PROGRAM_ID> \
//      --new-upgrade-authority <SQUADS_MULTISIG_PUBKEY> \
//      --keypair ~/.config/solana/id.json
//
// 3. Verificar:
//    solana program show <PROGRAM_ID>
//    # Debe mostrar: "Upgrade authority: <SQUADS_MULTISIG_PUBKEY>"
//
// 4. Documentar el multisig_pubkey en el whitepaper y en el frontend
//    para que cualquier inversor pueda verificar on-chain.
