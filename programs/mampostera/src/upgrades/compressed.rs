/**
 * programs/mampostera/src/upgrades/compressed.rs
 *
 * R15: Light Protocol compressed accounts — InvestorProfile con 99.95% menos storage.
 *
 * Problema: con 1M inversores, el storage de InvestorProfile PDAs normales
 * costaría ~$200,000 USD en rent. Con Light Protocol compressed state,
 * el mismo millón de perfiles cuesta ~$100 USD.
 *
 * Modelo:
 *   - InvestorProfile normal → ~0.002 SOL/perfil = $200K para 1M usuarios
 *   - InvestorProfile comprimido → ~0.000001 SOL/perfil = $100 para 1M usuarios
 *
 * Light Protocol almacena los datos off-chain en un Merkle tree on-chain.
 * La validez se demuestra con ZK-proofs (ya presente en nuestra arquitectura ZK).
 *
 * Instrucción 42: register_investor_compressed()
 *   Crea un InvestorProfile usando compressed state de Light Protocol.
 *   Compatible con la instrucción existente register_investor_profile()
 *   — el frontend puede elegir qué instrucción usar según el contexto.
 *
 * Cargo.toml — añadir cuando Light Protocol esté estable en mainnet:
 *   [dependencies]
 *   light-sdk           = { version = "0.6", features = ["anchor"] }
 *   light-hasher        = "0.6"
 *   light-merkle-tree   = "0.6"
 *
 * Integrar en lib.rs:
 *   pub mod compressed; (dentro de pub mod upgrades)
 *   Instrucción 42 en el #[program] block
 */

use anchor_lang::prelude::*;

// ── Constantes ────────────────────────────────────────────────────────────────

/// Número máximo de hojas en el Merkle tree de inversores
/// 2^20 = 1,048,576 inversores por árbol (extensible con múltiples árboles)
pub const MERKLE_TREE_DEPTH: u8  = 20;
pub const MAX_INVESTORS_PER_TREE: u64 = 1 << 20;

/// Costo estimado de rent por leaf en Light Protocol: ~0.000001 SOL
pub const COMPRESSED_LEAF_RENT_LAMPORTS: u64 = 1_000;

// ── InvestorProfileCompressed ─────────────────────────────────────────────────

/// Representación comprimida de un InvestorProfile.
/// Este struct vive en el state comprimido de Light Protocol —
/// no ocupa una account de Solana directamente.
///
/// El hash de esta estructura se almacena como una hoja en el Merkle tree.
/// Para verificar que un inversor tiene KYC aprobado, se proporciona
/// un Merkle proof junto con el state comprimido.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InvestorProfileLeaf {
    /// Wallet del inversor
    pub investor:    Pubkey,
    /// Estado KYC: 0=Pending, 1=Approved, 2=Revoked
    pub kyc_status:  u8,
    /// Timestamp de aprobación
    pub approved_at: i64,
    /// Hash del documento de identidad (para cumplimiento, sin datos personales)
    pub identity_hash: [u8; 32],
}

impl InvestorProfileLeaf {
    pub const LEN: usize = 32 + 1 + 8 + 32; // = 73 bytes

    /// Calcula el hash SHA-256 de este leaf para el Merkle tree
    pub fn hash(&self) -> [u8; 32] {
        use anchor_lang::solana_program::hash::{hash, hashv};
        let data = self.try_to_vec().unwrap_or_default();
        hash(&data).to_bytes()
    }
}

// ── CompressedInvestorRegistry PDA ───────────────────────────────────────────

/// PDA que actúa como raíz del Merkle tree de inversores comprimidos.
/// Seeds: [b"compressed_registry"]
///
/// En producción con Light Protocol: este PDA sería reemplazado por
/// el account de la State Merkle Tree del Light Protocol SDK.
/// Esta implementación es el scaffolding para la integración.
#[account]
pub struct CompressedInvestorRegistry {
    /// Raíz actual del Merkle tree (actualizada en cada insert)
    pub merkle_root:       [u8; 32],   // 32
    /// Número de inversores registrados
    pub leaf_count:        u64,        // 8
    /// Número de árbol (para manejar overflow con múltiples árboles)
    pub tree_index:        u8,         // 1
    /// Profundidad del árbol
    pub tree_depth:        u8,         // 1
    /// Bump del PDA
    pub bump:              u8,         // 1
}

impl CompressedInvestorRegistry {
    pub const LEN: usize = 8 + 32 + 8 + 1 + 1 + 1;
}

// ── Instrucción 42: register_investor_compressed ─────────────────────────────

/// Registra un InvestorProfile usando compressed state.
/// Costo: ~0.000001 SOL vs ~0.002 SOL del modelo normal.
///
/// En producción con Light Protocol SDK:
///   1. Se crea el leaf con los datos del inversor
///   2. Se inserta en el State Merkle Tree de Light Protocol
///   3. La raíz del árbol se actualiza en el registro PDA
///   4. El inversor puede demostrar su KYC con un Merkle proof
///
/// Para verificar KYC en otras instrucciones:
///   require!(verify_compressed_kyc(proof, leaf, registry.merkle_root))
pub fn register_investor_compressed(
    ctx: Context<RegisterInvestorCompressed>,
    identity_hash: [u8; 32],
) -> Result<()> {
    let registry = &mut ctx.accounts.compressed_registry;
    let now      = Clock::get()?.unix_timestamp;

    require!(
        registry.leaf_count < MAX_INVESTORS_PER_TREE,
        CompressedError::TreeFull
    );

    // Crear el leaf del inversor
    let leaf = InvestorProfileLeaf {
        investor:      ctx.accounts.investor.key(),
        kyc_status:    1, // Approved — la authority ya verificó off-chain
        approved_at:   now,
        identity_hash,
    };

    let leaf_hash = leaf.hash();

    // Actualizar la raíz del árbol (simulación — en producción usa Light SDK)
    // El hash de la nueva raíz incluye la raíz anterior + el nuevo leaf
    let new_root = {
        use anchor_lang::solana_program::hash::hashv;
        hashv(&[&registry.merkle_root, &leaf_hash]).to_bytes()
    };

    registry.merkle_root = new_root;
    registry.leaf_count  = registry.leaf_count
        .checked_add(1)
        .ok_or(CompressedError::ArithmeticOverflow)?;

    if registry.bump == 0 {
        registry.bump       = ctx.bumps.compressed_registry;
        registry.tree_index = 0;
        registry.tree_depth = MERKLE_TREE_DEPTH;
    }

    msg!(
        "[compressed] Inversor {} registrado · leaf #{} · root: {}...{}",
        ctx.accounts.investor.key(),
        registry.leaf_count,
        hex::encode(&new_root[..4]),
        hex::encode(&new_root[28..]),
    );

    Ok(())
}

// ── Helper: verificar KYC comprimido ─────────────────────────────────────────

/// Verifica que un InvestorProfile existe y tiene KYC=Approved
/// usando un Merkle proof contra la raíz almacenada en el registry.
///
/// En producción: usar Light Protocol's verify_compressed_account().
/// Esta implementación es el contrato de la interfaz para el MVP.
pub fn verify_compressed_kyc(
    proof_path:  &[[u8; 32]],
    leaf:        &InvestorProfileLeaf,
    root:        &[u8; 32],
) -> bool {
    if leaf.kyc_status != 1 { return false; } // No aprobado

    // Verificar el Merkle proof
    let mut current = leaf.hash();
    for sibling in proof_path {
        // Ordenar por valor para que el árbol sea determinista
        current = if current <= *sibling {
            anchor_lang::solana_program::hash::hashv(&[&current, sibling]).to_bytes()
        } else {
            anchor_lang::solana_program::hash::hashv(&[sibling, &current]).to_bytes()
        };
    }
    &current == root
}

// ── Contexto Anchor ───────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct RegisterInvestorCompressed<'info> {
    #[account(
        init_if_needed,
        payer  = authority,
        space  = CompressedInvestorRegistry::LEN,
        seeds  = [b"compressed_registry"],
        bump,
    )]
    pub compressed_registry: Account<'info, CompressedInvestorRegistry>,

    /// CHECK: El inversor que recibirá el perfil KYC comprimido
    pub investor: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ── Errores ───────────────────────────────────────────────────────────────────

#[error_code]
pub enum CompressedError {
    #[msg("El árbol de Merkle está lleno — crear un árbol nuevo (tree_index + 1)")]
    TreeFull,
    #[msg("El proof de Merkle no es válido")]
    InvalidMerkleProof,
    #[msg("Overflow aritmético")]
    ArithmeticOverflow,
}
