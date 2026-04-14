/**
 * v2/db/schema.ts
 * Drizzle ORM — schema de la base de datos off-chain (Neon PostgreSQL).
 *
 * PRINCIPIO: Esta DB es un ÍNDICE, no la fuente de verdad.
 * La fuente de verdad sigue siendo el Programa Anchor on-chain.
 * Neon almacena: metadatos enriquecidos, imágenes, historial de precios,
 * datos de usuarios (no on-chain), y cache del indexador.
 *
 * Nunca reemplaza: PropertyState PDA, tokens, renta, KYC on-chain.
 */

import {
  pgTable, uuid, text, integer, bigint, boolean,
  timestamp, decimal, index, uniqueIndex, jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Properties (mirror del PropertyState PDA + metadatos enriquecidos) ────────

export const properties = pgTable("properties", {
  id:             uuid("id").defaultRandom().primaryKey(),

  // Mirror del PDA on-chain — se sincroniza del indexador
  onchainPubkey:  text("onchain_pubkey").notNull().unique(),
  mintPubkey:     text("mint_pubkey").notNull().unique(),
  propertyId:     bigint("property_id", { mode: "number" }).notNull(),
  authority:      text("authority").notNull(),

  // Metadatos enriquecidos (no están on-chain)
  name:           text("name").notNull(),
  description:    text("description"),
  city:           text("city").notNull().default("Bogotá"),
  neighborhood:   text("neighborhood"),
  country:        text("country").notNull().default("Colombia"),
  propertyType:   text("property_type").notNull().default("residencial"),
  imageUrls:      jsonb("image_urls").$type<string[]>().default([]),
  virtualTourUrl: text("virtual_tour_url"),
  areaM2:         decimal("area_m2", { precision: 10, scale: 2 }),
  rooms:          integer("rooms"),
  bathrooms:      integer("bathrooms"),

  // Financiero
  totalValueUsd:  bigint("total_value_usd", { mode: "number" }).notNull(),
  totalTokens:    bigint("total_tokens",    { mode: "number" }).notNull(),
  targetApy:      decimal("target_apy",     { precision: 5,  scale: 2 }).default("8.50"),

  // Legal
  legalDocHash:   text("legal_doc_hash").notNull(),
  ipfsCid:        text("ipfs_cid").notNull(),
  notariaRef:     text("notaria_ref"),     // "Escritura 4821/2026 Notaría 12 Bogotá"
  matriculaRef:   text("matricula_ref"),   // Matrícula inmobiliaria

  // Estado
  isActive:       boolean("is_active").notNull().default(true),
  isVerified:     boolean("is_verified").notNull().default(false),
  indexedAt:      timestamp("indexed_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  pubkeyIdx:   uniqueIndex("properties_pubkey_idx").on(t.onchainPubkey),
  cityIdx:     index("properties_city_idx").on(t.city),
  activeIdx:   index("properties_active_idx").on(t.isActive),
}));

// ── Price history (oracle notarial + valuaciones) ──────────────────────────────

export const priceHistory = pgTable("price_history", {
  id:          uuid("id").defaultRandom().primaryKey(),
  propertyId:  uuid("property_id").notNull().references(() => properties.id),
  valueUsd:    bigint("value_usd", { mode: "number" }).notNull(),
  source:      text("source").notNull().default("oracle_notarial"),
  docHash:     text("doc_hash"),
  recordedAt:  timestamp("recorded_at").notNull().defaultNow(),
}, (t) => ({
  propertyIdx: index("price_history_property_idx").on(t.propertyId),
  dateIdx:     index("price_history_date_idx").on(t.recordedAt),
}));

// ── Users (datos off-chain del inversor — la wallet es la fuente on-chain) ────

export const users = pgTable("users", {
  id:            uuid("id").defaultRandom().primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  privyUserId:   text("privy_user_id").unique(),

  // Perfil
  email:         text("email"),
  phoneE164:     text("phone_e164"),
  displayName:   text("display_name"),
  country:       text("country").default("CO"),
  language:      text("language").default("es"),

  // KYC off-chain (el on-chain es el authoritative)
  kycOffchainStatus: text("kyc_offchain_status").default("pending"),
  kycProvider:       text("kyc_provider"),

  // Notificaciones
  emailNotifications: boolean("email_notifications").default(true),
  smsNotifications:   boolean("sms_notifications").default(false),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  walletIdx: uniqueIndex("users_wallet_idx").on(t.walletAddress),
  privyIdx:  index("users_privy_idx").on(t.privyUserId),
}));

// ── Events (log de eventos indexados del programa Anchor) ─────────────────────

export const onchainEvents = pgTable("onchain_events", {
  id:          uuid("id").defaultRandom().primaryKey(),
  eventType:   text("event_type").notNull(),   // "RentDeposited", "TokensMinted", etc.
  signature:   text("signature").notNull().unique(),
  slot:        bigint("slot", { mode: "number" }).notNull(),
  blockTime:   timestamp("block_time"),
  propertyId:  uuid("property_id").references(() => properties.id),
  walletAddr:  text("wallet_addr"),
  amountLamports: bigint("amount_lamports", { mode: "number" }),
  rawData:     jsonb("raw_data"),
  indexedAt:   timestamp("indexed_at").notNull().defaultNow(),
}, (t) => ({
  sigIdx:      uniqueIndex("events_sig_idx").on(t.signature),
  typeIdx:     index("events_type_idx").on(t.eventType),
  propertyIdx: index("events_property_idx").on(t.propertyId),
  slotIdx:     index("events_slot_idx").on(t.slot),
}));

// ── Relations ─────────────────────────────────────────────────────────────────

export const propertiesRelations = relations(properties, ({ many }) => ({
  priceHistory: many(priceHistory),
  events:       many(onchainEvents),
}));

export const priceHistoryRelations = relations(priceHistory, ({ one }) => ({
  property: one(properties, {
    fields:     [priceHistory.propertyId],
    references: [properties.id],
  }),
}));

export const onchainEventsRelations = relations(onchainEvents, ({ one }) => ({
  property: one(properties, {
    fields:     [onchainEvents.propertyId],
    references: [properties.id],
  }),
}));

// ── Tipos inferidos ────────────────────────────────────────────────────────────

export type Property          = typeof properties.$inferSelect;
export type NewProperty       = typeof properties.$inferInsert;
export type PriceHistoryEntry = typeof priceHistory.$inferSelect;
export type User              = typeof users.$inferSelect;
export type OnchainEvent      = typeof onchainEvents.$inferSelect;
