# TÉRMINOS Y CONDICIONES DE USO — PLATAFORMA MAMPOSTERA
## Mampostera Technologies S.A.S.
### Versión 1.0 | Vigencia: Marzo 2026

---

## CLÁUSULA 1 — ACEPTACIÓN DE TÉRMINOS

Al acceder, registrarse o utilizar la plataforma Mampostera (en adelante "la Plataforma"), el usuario (en adelante "el Usuario") declara haber leído, comprendido y aceptado en su totalidad los presentes Términos y Condiciones, así como la Política de Privacidad y la Política de KYC/AML vigentes. Si el Usuario no está de acuerdo con alguno de estos términos, deberá abstenerse de utilizar la Plataforma.

---

## CLÁUSULA 2 — DEFINICIONES

Para los efectos de los presentes Términos:

**"Token RWA"**: Unidad de participación fraccionada en los derechos económicos de una Sociedad por Acciones Simplificada (S.A.S.) propietaria de un bien inmueble específico, representada mediante un token SPL en la red Solana.

**"dNFT"**: Token No Fungible dinámico emitido bajo el estándar Token-2022 de Solana, que representa la totalidad de la participación económica en una S.A.S. propietaria de un inmueble, con metadatos actualizables mediante el Oracle Notarial.

**"Programa Anchor"**: El contrato inteligente desplegado en la red Solana que gestiona todas las transacciones de la Plataforma, identificado por el Program ID publicado en el explorador oficial.

**"Oracle Notarial"**: Sistema de actualización trimestral del valor comercial de los inmuebles, respaldado por avalúos realizados por peritos inscritos en la Lonja de Propiedad Raíz de Colombia.

**"Marketplace P2P"**: Módulo de la Plataforma que permite transacciones de compraventa de Tokens RWA directamente entre usuarios, mediante contratos inteligentes con custodia en escrow on-chain.

**"KYC"**: Proceso de Verificación de Identidad del Cliente (Know Your Customer), realizado mediante pruebas criptográficas de conocimiento cero (ZK-proofs) on-chain, sin almacenamiento de datos personales en servidores centralizados.

---

## CLÁUSULA 3 — NATURALEZA JURÍDICA DE LOS TOKENS

**3.1** Los Tokens RWA y los dNFTs emitidos a través de la Plataforma NO constituyen: valores en el sentido de la Ley 964 de 2005, instrumentos del mercado de valores supervisados por la Superintendencia Financiera de Colombia, títulos representativos de dominio sobre bienes inmuebles, ni participaciones en un fondo de inversión colectiva.

**3.2** Los Tokens RWA representan exclusivamente derechos económicos sobre las utilidades distribuibles de una S.A.S. específica, según lo estipulado en el pacto de accionistas correspondiente, el cual se encuentra vinculado criptográficamente al Token mediante el hash SHA-256 de la escritura pública almacenado en el `NotarialRecord` PDA on-chain.

**3.3** La adquisición de Tokens RWA confiere al titular el derecho a recibir distribuciones proporcionales de las rentas generadas por el inmueble subyacente, en los términos establecidos en el pacto de accionistas de la S.A.S. correspondiente.

---

## CLÁUSULA 4 — ELEGIBILIDAD Y KYC

**4.1** El acceso a las funcionalidades de inversión de la Plataforma está restringido a personas naturales o jurídicas que: (i) sean mayores de 18 años o tengan capacidad jurídica plena; (ii) no se encuentren incluidas en listas de sanciones internacionales (OFAC SDN, ONU, UE); (iii) hayan completado satisfactoriamente el proceso de KYC on-chain mediante prueba ZK verificada por el sistema Light Protocol integrado en el Programa Anchor.

**4.2** La Plataforma se reserva el derecho de revocar el estado KYC de cualquier usuario sin previo aviso en caso de: (i) detección de actividades inusuales o sospechosas según los criterios de la UIAF; (ii) inclusión posterior en listas de sanciones; (iii) provisión de información falsa o documentos fraudulentos durante el proceso de KYC; (iv) orden de autoridad competente.

**4.3** La revocación del KYC se ejecuta mediante la instrucción `revoke_investor` del Programa Anchor, quedando constancia inmutable de la misma en la blockchain de Solana.

---

## CLÁUSULA 5 — RIESGOS TECNOLÓGICOS Y DE BLOCKCHAIN

**5.1 Irreversibilidad de transacciones:** Todas las transacciones ejecutadas en la red Solana mediante el Programa Anchor son irreversibles e inmutables una vez confirmadas. La Plataforma no puede cancelar, modificar ni revertir ninguna transacción on-chain bajo ninguna circunstancia.

**5.2 Riesgo de wallet:** El Usuario es el único responsable de la custodia de sus claves privadas o credenciales de WebAuthn. La pérdida de acceso a la wallet implica la pérdida permanente del acceso a los Tokens RWA asociados. Mampostera no ofrece servicios de recuperación de wallets.

**5.3 Riesgo de protocolo:** La Plataforma opera sobre infraestructura de terceros (Solana, Hyperlane, Light Protocol, Civic Pass) que pueden estar sujetos a fallos, actualizaciones incompatibles o discontinuación del servicio. Mampostera no es responsable por los fallos de estos protocolos subyacentes.

**5.4 Riesgo de smart contract:** A pesar de las auditorías de seguridad realizadas, los contratos inteligentes pueden contener vulnerabilidades no identificadas. Los fondos depositados en el Programa Anchor están sujetos a este riesgo inherente.

---

## CLÁUSULA 6 — COMISIONES Y TARIFAS

**6.1** La Plataforma cobra las siguientes comisiones, deducidas automáticamente por el Programa Anchor:

| Operación | Comisión | Mecanismo |
|---|---|---|
| Transferencia secundaria de dNFT | 1% del valor transferido | Token-2022 TransferFeeConfig (automático) |
| Aceptación de oferta en Marketplace P2P | 0.5% del precio de venta | Instrucción `accept_offer` |
| Patrocinio de gas por Paymaster | Costo real de la transacción | Deducido de `rent_balance` del SmartAccount |
| Liquidación de colateral en mora | 5% del valor del dNFT | Instrucción `liquidate_collateral` |

**6.2** El 80% de las comisiones por transferencia de dNFT se destina a la reserva de liquidez del protocolo (`ProtocolTreasury` PDA), y el 20% restante al fondo de operaciones de Mampostera Technologies S.A.S.

---

## CLÁUSULA 7 — NATURALEZA DEL SERVICIO Y LIMITACIÓN DE RESPONSABILIDAD EN EL MARKETPLACE P2P

**7.1 Rol de Facilitador Tecnológico**

Mampostera Technologies S.A.S. actúa exclusivamente como facilitador tecnológico de infraestructura blockchain para la conexión entre vendedores y compradores de Tokens RWA. En ningún caso actúa como intermediario financiero, corredor de valores, agente inmobiliario, market maker, ni como contraparte principal de ninguna transacción.

**7.2 Ausencia de Garantía de Liquidez**

LA PLATAFORMA NO GARANTIZA, EN NINGUNA CIRCUNSTANCIA, LA LIQUIDEZ INMEDIATA, MEDIATA O FUTURA DE LOS TOKENS RWA. El Usuario reconoce que:

a) La posibilidad de vender depende exclusivamente de la existencia de compradores al precio ofrecido.

b) Mampostera no tiene obligación de comprar, readquirir, rescatar ni encontrar compradores bajo ninguna circunstancia.

c) El precio de venta es determinado exclusivamente por la oferta y la demanda. El valor del Oracle Notarial es referencia informativa y no constituye precio garantizado.

d) Las transacciones P2P son directamente entre pares mediante contratos inteligentes. Una vez ejecutadas on-chain, son irreversibles.

e) El servicio puede estar sujeto a congestión de red, fallos técnicos o discontinuación.

**7.3 Divulgación de Riesgos Específicos**

| Riesgo | Descripción | Mitigación |
|--------|-------------|------------|
| Iliquidez | No existe garantía de encontrar comprador | Horizonte mínimo recomendado: 24 meses |
| Volatilidad de precio | El valor del inmueble puede bajar | Diversificación en múltiples propiedades |
| Riesgo regulatorio | Cambios normativos pueden afectar la plataforma | Estructura legal S.A.S. por propiedad |
| Riesgo de smart contract | Vulnerabilidades de código | Auditorías externas certificadas |
| Riesgo cross-chain | Fallos en puentes Hyperlane | ISM Multisig 3/5 validadores |
| Riesgo de oracle | Avalúos pueden no reflejar el mercado real | Actualización trimestral con peritos certificados |

**7.4 No Constituye Asesoramiento Financiero**

Ninguna información en la Plataforma constituye asesoramiento financiero, de inversión, tributario o legal. El Usuario debe consultar asesores especializados antes de invertir.

**7.5 Cumplimiento Regulatorio del Usuario**

El Usuario es exclusiva y totalmente responsable del cumplimiento de sus obligaciones tributarias, cambiarias y regulatorias. El KYC on-chain no exonera de obligaciones fiscales independientes ante la DIAN u otras autoridades.

**7.6 Jurisdicción y Ley Aplicable**

Los presentes términos se rigen por la legislación de la República de Colombia. Las controversias se someten al Centro de Arbitraje y Conciliación de la Cámara de Comercio de Bogotá, bajo sus reglas de arbitraje, con sede en Bogotá D.C.

---

## CLÁUSULA 8 — PROPIEDAD INTELECTUAL Y LICENCIA

El código fuente del Programa Anchor de Mampostera se publica bajo licencia MIT. Las marcas, logos y materiales de marketing son propiedad exclusiva de Mampostera Technologies S.A.S. El Usuario obtiene una licencia limitada, no exclusiva e intransferible para usar la Plataforma según estos Términos.

---

## CLÁUSULA 9 — MODIFICACIONES

Mampostera se reserva el derecho de modificar estos Términos con 30 días de aviso previo publicado en la Plataforma. El uso continuado de la Plataforma después del plazo de aviso constituye aceptación de los nuevos términos. Las modificaciones que afecten el Programa Anchor on-chain quedarán registradas inmutablemente en la blockchain.

---

*Mampostera Technologies S.A.S. | NIT: [Por asignar] | Bogotá D.C., Colombia*
*Versión 1.0 — Marzo 2026. Documento revisado por asesor legal especializado en fintech y blockchain Colombia.*
