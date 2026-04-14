# 📋 Legal Tech: Vinculación del Token SPL con una SAS/LLC — Mampostera

## Marco Legal Colombiano

### 1. Estructura Societaria Recomendada

**Tipo de entidad:** Sociedad por Acciones Simplificada (SAS) — Ley 1258 de 2008

Cada propiedad en Mampostera se encapsula en una **SAS dedicada** (Single-Purpose Vehicle):

```
MAMPOSTERA PROPIEDAD BOGOTA CR7 SAS
NIT: [número asignado por DIAN]
Objeto social: "Tenencia, administración y arrendamiento del inmueble
               ubicado en Cra 7 #45-12, Bogotá D.C."
Capital social: $120.000.000 COP representado en 1.000.000 acciones
```

### 2. Vinculación Token SPL ↔ Acción SAS

El nexo jurídico se establece mediante **tres capas**:

#### Capa 1 — Metadatos inmutables on-chain

El mint del token SPL incluye metadatos bajo el estándar **Token Metadata Program (Metaplex)**:

```json
{
  "name": "MAMP-CR7-BOG-001",
  "symbol": "MAMP",
  "description": "Fracción de propiedad — Cra 7 #45-12, Bogotá",
  "external_url": "https://mampostera.co/property/cr7-bog-001",
  "attributes": [
    { "trait_type": "entity_type",    "value": "SAS" },
    { "trait_type": "entity_name",    "value": "MAMPOSTERA PROPIEDAD BOGOTA CR7 SAS" },
    { "trait_type": "nit",            "value": "901.XXX.XXX-X" },
    { "trait_type": "registro_camara","value": "CAMARA DE COMERCIO BOGOTA #XXXXXXX" },
    { "trait_type": "inmueble_matricula", "value": "50C-XXXXXXX" },
    { "trait_type": "notaria",        "value": "Notaría 20 de Bogotá — Escritura #XXXX/2025" },
    { "trait_type": "total_acciones", "value": "1000000" },
    { "trait_type": "tokens_per_accion", "value": "1" },
    { "trait_type": "apy_objetivo",   "value": "8.5%" },
    { "trait_type": "legal_doc_sha256", "value": "<hash inmutable del PDF de escritura>" },
    { "trait_type": "jurisdiction",   "value": "Colombia — Ley 1258/2008" }
  ],
  "properties": {
    "files": [
      {
        "uri": "ipfs://Qm...",
        "type": "application/pdf",
        "description": "Escritura pública SAS + certificado matrícula inmobiliaria"
      }
    ]
  }
}
```

#### Capa 2 — Pacto de accionistas vinculante

El estatuto de la SAS incluye una **cláusula de tokenización**:

> *"Las acciones de la Sociedad son representadas digitalmente por tokens SPL en la red Solana,
> identificados por la dirección de mint [DIRECCIÓN_MINT]. La transferencia de tokens implica
> la transferencia de los derechos económicos proporcionales (dividendos de arrendamiento) y
> los derechos políticos (voto proporcional en asamblea). El registro on-chain en la dirección
> del programa Mampostera ([PROGRAM_ID]) tiene el mismo valor probatorio que el libro de acciones
> físico conforme al artículo 130 del Código de Comercio y la Ley 527 de 1999 sobre mensajes
> de datos."*

#### Capa 3 — Hash inmutable en el PropertyState PDA

El campo `legal_doc_hash` en el programa Anchor almacena el **SHA-256 del PDF notarial**:

```rust
// En PropertyState on-chain:
legal_doc_hash: "a3f8e12d4b9c6071..." // SHA-256 del PDF en IPFS
ipfs_cid:       "QmYwAPJzv5CZsnA..."  // Documento accesible públicamente
```

Cualquier tenedor de tokens puede verificar en cualquier momento que el documento
no ha sido alterado calculando `SHA-256(PDF_descargado) == legal_doc_hash_on_chain`.

---

### 3. Cumplimiento Regulatorio Colombiano

#### UIAF (Unidad de Información y Análisis Financiero)
- KYC obligatorio para inversiones > 10 SMLMV (~$50 USD a tasa 2025)
- **Implementación:** Civic Pass on-chain + reporte automático vía API UIAF
- Cada Gateway Token de Civic almacena hash de verificación (no datos personales)

#### Superintendencia Financiera de Colombia
- Los tokens de Mampostera se estructuran como **valores representativos de derechos económicos**
- Marco: Decreto 1235 de 2020 (sandbox regulatorio FinTech)
- Límite por inversionista no calificado: $50.000.000 COP/año

#### Registro Nacional de Valores (RNVE)
- Exención aplicable para ofertas < 500 inversionistas o < 5.000 SMMLV
- Inscripción voluntaria recomendada para propiedades > $1.000.000.000 COP

#### DIAN — Aspectos tributarios
- Rendimientos de arrendamiento: retención en la fuente 3.5% (art. 401 ET)
- Los dividendos distribuidos en SOL se valoran al precio de mercado en la fecha de distribución
- Obligación de declarar activos en el exterior si el inversor tiene tokens > 2.000 UVT

---

### 4. Proceso de Incorporación de una Propiedad

```
1. Constitución SAS (Notaría + Cámara de Comercio)
          ↓
2. Transferencia del inmueble a la SAS (Escritura pública)
          ↓
3. Generación del PDF notarial definitivo
          ↓
4. SHA-256(PDF) → legal_doc_hash
          ↓
5. Upload PDF a IPFS → ipfs_cid
          ↓
6. initialize_property on-chain (program Mampostera)
          ↓
7. Metadatos Metaplex → freeze (inmutables)
          ↓
8. KYC gating con Civic Pass activo
          ↓
9. Oferta de tokens a inversionistas
```

---

### 5. Plantilla de Cláusula para Escritura Pública

```
CLÁUSULA DÉCIMA SÉPTIMA — TOKENIZACIÓN DE ACCIONES

Las acciones de la presente Sociedad por Acciones Simplificada son objeto
de representación digital mediante tokens fungibles en la red de cadena de
bloques Solana (https://solana.com), bajo el estándar SPL Token.

El programa inteligente que gestiona la emisión, transferencia y distribución
de rendimientos se identifica con la dirección pública: [PROGRAM_ID].

El mint del token se identifica con la dirección: [MINT_PUBKEY].

La presente escritura pública, con NIT [NIT_SAS], se encuentra disponible
de forma permanente e inmutable en la red IPFS bajo el identificador de
contenido (CID): [IPFS_CID], cuya integridad se puede verificar mediante
el resumen criptográfico SHA-256: [LEGAL_DOC_HASH], almacenado de forma
inmutable en el programa on-chain referenciado en el párrafo anterior.

El tenedor de cualquier cantidad de tokens asociados al mint referenciado
ostenta derechos económicos proporcionales a su participación sobre el total
de [TOTAL_TOKENS] tokens emitidos, incluyendo el derecho al cobro proporcional
de cánones de arrendamiento del inmueble con matrícula inmobiliaria número
[MATRICULA_INMOBILIARIA], ubicado en [DIRECCIÓN_PREDIO], municipio de
[MUNICIPIO], departamento de [DEPARTAMENTO], República de Colombia.

La presente cláusula tiene plena validez y efecto jurídico conforme a la
Ley 527 de 1999 sobre comercio electrónico y mensajes de datos, y el
Decreto 1235 de 2020 del Ministerio de Hacienda y Crédito Público.
```

---

*Mampostera — Hackathon Solana 2025 · Legal Tech Framework v1.0*
*Este documento es orientativo. Consulte con un abogado especializado en derecho societario y FinTech colombiano antes de implementar.*
