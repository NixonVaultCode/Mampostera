#!/usr/bin/env ts-node
/**
 * MAMPOSTERA — Deploy seguro a Devnet
 * Uso: yarn deploy:devnet
 *
 * Seguridad:
 * - Nunca hardcodea keypairs ni secrets
 * - Lee wallet desde variable de entorno o ruta estándar
 * - Verifica balance antes de deployar
 * - Imprime URL de Explorer para verificación
 */

import {
  Connection,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ─── Configuración ────────────────────────────────────────────────────────────

const CLUSTER   = "devnet";
const RPC_URL   = process.env.SOLANA_RPC_URL || clusterApiUrl(CLUSTER);
const WALLET    = process.env.ANCHOR_WALLET  ||
  path.join(process.env.HOME!, ".config", "solana", "id.json");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[mampostera-deploy] ${msg}`);
}

function run(cmd: string): string {
  log(`$ ${cmd}`);
  return execSync(cmd, { encoding: "utf-8", stdio: ["inherit", "pipe", "inherit"] });
}

// ─── Pre-flight checks ────────────────────────────────────────────────────────

async function preflight() {
  log("Verificando entorno antes de deployar...");

  // 1. Verificar que existe la wallet
  if (!fs.existsSync(WALLET)) {
    throw new Error(
      `Wallet no encontrada en ${WALLET}.\n` +
      `Crea una con: solana-keygen new --outfile ${WALLET}`
    );
  }
  log(`✅ Wallet: ${WALLET}`);

  // 2. Verificar balance mínimo (necesita ~2 SOL para deploy)
  const conn    = new Connection(RPC_URL, "confirmed");
  const address = run("solana address").trim();
  const balance = await conn.getBalance(new PublicKey(address));
  const solBalance = balance / LAMPORTS_PER_SOL;

  log(`✅ Address: ${address}`);
  log(`✅ Balance: ${solBalance.toFixed(4)} SOL`);

  if (solBalance < 2) {
    log("⚠️  Balance bajo. Obteniendo SOL del faucet...");
    run(`solana airdrop 2 --url ${CLUSTER}`);
    // Esperar confirmación
    await new Promise(r => setTimeout(r, 3000));
    const newBalance = await conn.getBalance(new PublicKey(address));
    log(`✅ Nuevo balance: ${(newBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  }

  // 3. Verificar que anchor está instalado
  try {
    const anchorVersion = run("anchor --version");
    log(`✅ ${anchorVersion.trim()}`);
  } catch {
    throw new Error("Anchor CLI no encontrado. Instala con: avm install latest && avm use latest");
  }
}

// ─── Build & Deploy ───────────────────────────────────────────────────────────

async function deploy() {
  await preflight();

  log("Compilando programa...");
  run("anchor build");
  log("✅ Build exitoso");

  // Obtener Program ID generado
  const programId = run(
    "solana address -k target/deploy/mampostera-keypair.json"
  ).trim();
  log(`✅ Program ID: ${programId}`);

  // Actualizar declare_id! si cambió
  log("Actualizando Program ID en código...");
  const libPath = path.join("programs", "mampostera", "src", "lib.rs");
  let libContent = fs.readFileSync(libPath, "utf-8");
  libContent = libContent.replace(
    /declare_id!\(".*?"\)/,
    `declare_id!("${programId}")`
  );
  fs.writeFileSync(libPath, libContent);

  // También en Anchor.toml
  let anchorToml = fs.readFileSync("Anchor.toml", "utf-8");
  anchorToml = anchorToml.replace(
    /mampostera = ".*?"/g,
    `mampostera = "${programId}"`
  );
  fs.writeFileSync("Anchor.toml", anchorToml);

  // Re-compilar con el Program ID correcto
  log("Recompilando con Program ID correcto...");
  run("anchor build");

  // Deploy
  log(`Deployando en ${CLUSTER}...`);
  run(`anchor deploy --provider.cluster ${CLUSTER}`);

  log("=".repeat(60));
  log("✅ DEPLOY EXITOSO");
  log(`Program ID: ${programId}`);
  log(`Explorer: https://explorer.solana.com/address/${programId}?cluster=${CLUSTER}`);
  log("=".repeat(60));

  // Guardar el Program ID en un archivo para uso del frontend
  const envPath = path.join("frontend", ".env.local");
  const envContent = `NEXT_PUBLIC_PROGRAM_ID=${programId}
NEXT_PUBLIC_SOLANA_NETWORK=${CLUSTER}
NEXT_PUBLIC_RPC_ENDPOINT=${RPC_URL}
`;
  fs.writeFileSync(envPath, envContent);
  log(`✅ Variables de entorno guardadas en frontend/.env.local`);
}

deploy().catch(err => {
  console.error("[ERROR]", err.message);
  process.exit(1);
});
