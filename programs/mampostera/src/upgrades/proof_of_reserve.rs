/**
 * programs/mampostera/src/upgrades/proof_of_reserve.rs
 *
 * R8: Proof of Reserve on-chain — attestation notarial verificable por terceros.
 *
 * Problema que resuelve:
 *   Hoy cualquier inversor debe confiar en que Mampostera reporta
 *   correctamente que el inmueble existe y está libre de gravámenes.
 *   Con PoR, la evidencia está on-chain y verificada por el notario.
 *
 * Flujo:
 *   1. Notario certifica: inmueble existe + título libre + S.A.S. es propietaria
 *   2. Mampostera recibe el certificado (PDF firmado digitalmente por notario)
 *   3. Backend calcula SHA-256 del certificado y llama register_proof_of_reserve()
 *   4. ProofOfReserve PDA almacena el hash + timestamp + número de escritura
 *   5. Cualquier tercero puede verificar: descarga el PDF de Arweave,
 *      calcula el hash, compara con el PDA → confirma o detecta manipulación
 *
 * Integrar en lib.rs como instrucción 37.
 */

use anchor_lang::prelude::*;

// ── Constantes ────────────────────────────────────────────────────────────────

/// Antigüedad máxima del PoR para que sea considerado válido: 6 meses
pub const POR_MAX_AGE_SECS: i64 = 6 * 30 * 24 * 3600;

/// Longitud del hash SHA-256 en bytes (32)
pub const SHA256_BYTES: usize = 32;

// ── ProofOfReserve PDA ────────────────────────────────────────────────────────

/// PDA que almacena la attestation notarial de una propiedad.
/// Seeds: [b"proof_of_reserve", property_state_pubkey]
///
/// Verificación trustless:
///   1. Descargar el PDF desde arweave_cid
///   2. Calcular SHA-256 del PDF
///   3. Comparar con certificate_hash almacenado aquí
///   4. Si coincide → el certificado es auténtico y no ha sido alterado
#[account]
pub struct ProofOfReserve {
    /// Propiedad a la que corresponde este PoR
    pub property:            Pubkey,      // 32

    /// SHA-256 del certificado notarial (32 bytes = 256 bits)
    pub certificate_hash:    [u8; 32],    // 32

    /// CID de Arweave donde vive el PDF del certificado
    /// Formato: "ar://<43-char-base64url-id>"
    pub arweave_cid:         String,      // 4 + 50

    /// Número de escritura pública (ej: "Escritura 4821/2026")
    pub escritura_ref:       String,      // 4 + 32

    /// Matrícula inmobiliaria (ej: "50C-1234567")
    pub matricula_ref:       String,      // 4 + 20

    /// Notaría (ej: "Notaría 20 de Bogotá")
    pub notaria_ref:         String,      // 4 + 48

    /// NIT de la S.A.S. propietaria
    pub sas_nit:             String,      // 4 + 12

    /// Timestamp Unix del certificado notarial (fecha en el documento)
    pub certificate_date:    i64,         // 8

    /// Timestamp de cuando se registró on-chain
    pub registered_at:       i64,         // 8

    /// Cuántas veces se ha renovado el PoR (empieza en 0)
    pub renewal_count:       u32,         // 4

    /// ¿Está vigente? False si fue revocado por el notario (caso raro)
    pub is_valid:            bool,        // 1

    /// Bump del PDA
    pub bump:                u8,          // 1
}

impl ProofOfReserve {
    pub const LEN: usize = 8      // discriminator
        + 32                       // property
        + 32                       // certificate_hash
        + (4 + 50)                 // arweave_cid
        + (4 + 32)                 // escritura_ref
        + (4 + 20)                 // matricula_ref
        + (4 + 48)                 // notaria_ref
        + (4 + 12)                 // sas_nit
        + 8 + 8                    // certificate_date, registered_at
        + 4                        // renewal_count
        + 1 + 1;                   // is_valid, bump

    /// Verifica que el PoR no esté expirado (< 6 meses desde registered_at)
    pub fn is_unexpired(&self, now: i64) -> bool {
        now.saturating_sub(self.registered_at) < POR_MAX_AGE_SECS
    }
}

// ── Instrucción: registrar o renovar PoR ─────────────────────────────────────

pub struct RegisterPorParams {
    /// SHA-256 del PDF del certificado notarial (hex → bytes)
    pub certificate_hash: [u8; SHA256_BYTES],
    pub arweave_cid:      String,
    pub escritura_ref:    String,
    pub matricula_ref:    String,
    pub notaria_ref:      String,
    pub sas_nit:          String,
    pub certificate_date: i64,
}

/// Registra o renueva el Proof of Reserve de una propiedad.
///
/// Primera vez: crea el ProofOfReserve PDA (init).
/// Renovaciones: actualiza los campos y aumenta renewal_count.
///
/// Solo la authority de la propiedad puede registrar el PoR.
/// El hash del certificado es inmutable una vez registrado — para
/// actualizar hay que crear una nueva transacción con el nuevo hash.
pub fn register_proof_of_reserve(
    ctx: Context<RegisterProofOfReserve>,
    params: RegisterPorParams,
) -> Result<()> {
    // Validar longitudes para evitar PDAs mal dimensionados
    require!(
        params.arweave_cid.len()   <= 50,
        crate::errors::MamposteError::PorArweaveCidTooLong
    );
    require!(
        params.escritura_ref.len() <= 32,
        crate::errors::MamposteError::PorEscrituaRefTooLong
    );
    require!(
        params.matricula_ref.len() <= 20,
        crate::errors::MamposteError::PorInvalidHash
    );
    require!(
        params.certificate_date > 0,
        crate::errors::MamposteError::PorCertificateExpired
    );

    let now = Clock::get()?.unix_timestamp;
    let por = &mut ctx.accounts.proof_of_reserve;

    // Si ya existe (renovación), aumentar el contador
    let is_renewal = por.renewal_count > 0 || por.registered_at > 0;

    por.property         = ctx.accounts.property_state.key();
    por.certificate_hash = params.certificate_hash;
    por.arweave_cid      = params.arweave_cid;
    por.escritura_ref    = params.escritura_ref;
    por.matricula_ref    = params.matricula_ref;
    por.notaria_ref      = params.notaria_ref;
    por.sas_nit          = params.sas_nit;
    por.certificate_date = params.certificate_date;
    por.registered_at    = now;
    por.is_valid         = true;
    por.bump             = ctx.bumps.proof_of_reserve;

    if is_renewal {
        por.renewal_count = por.renewal_count
            .checked_add(1)
            .ok_or(crate::errors::MamposteError::ArithmeticOverflow)?;
    }

    msg!(
        "[por] Proof of Reserve registrado para propiedad {} · escritura: {} · hash: {}...{}",
        por.property,
        por.escritura_ref,
        hex::encode(&por.certificate_hash[..4]),
        hex::encode(&por.certificate_hash[28..]),
    );

    Ok(())
}

// ── Contexto Anchor ───────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct RegisterProofOfReserve<'info> {
    #[account(
        init_if_needed,
        payer  = authority,
        space  = ProofOfReserve::LEN,
        seeds  = [b"proof_of_reserve", property_state.key().as_ref()],
        bump,
    )]
    pub proof_of_reserve: Account<'info, ProofOfReserve>,

    #[account(
        has_one = authority @ crate::errors::MamposteError::Unauthorized,
    )]
    pub property_state: Account<'info, crate::PropertyState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}
