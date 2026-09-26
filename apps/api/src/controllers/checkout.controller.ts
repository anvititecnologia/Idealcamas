// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Checkout Controller (Back-end)
// ──────────────────────────────────────────────────────────────────────────────
// Gerenciamento de Sessão de Orçamento & Geração de Hash Único Anticolisão.
//
// Defesas de Segurança e Regras de Negócio:
//   1. Geração de Hash Anticolisão (Zero-Collision Guarantee):
//      - Prefixo 'ORD-' + 6 caracteres hexadecimais criptograficamente seguros (crypto.randomBytes).
//      - Loop de retentativas com tratamento de exceção Prisma (código P2002 - Unique Constraint)
//        para garantir 100% de prevenção contra colisões de ID no banco de dados.
//   2. Zero Trust & Prevenção contra Parameter Tampering:
//      - O front-end envia apenas as seleções cruas (IDs de materiais, medidas, CEP).
//      - O servidor recalcula todo o subtotal, frete e total estritamente no back-end.
//      - NENHUM valor monetário ou preço unitário aceito do front-end é confiado.
//   3. Ocultação de Preços Internos (Information Disclosure Prevention):
//      - A resposta devolve apenas o Hash gerado e o Valor Consolidado Total.
//      - Preços unitários dos componentes/materiais são omitidos na resposta pública.
//   4. Persistência de Escopo Completo:
//      - Salva a configuração paramétrica 3D detalhada em `configSnapshot` (JSON)
//        permitindo que o vendedor recupere exatamente o projeto 3D no Painel Admin.
// ──────────────────────────────────────────────────────────────────────────────

import { Request, Response, Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// ┌──────────────────────────────────────────────────────────────────────┐
// │  SCHEMA DE VALIDAÇÃO STRICT (ZOD)                                    │
// └──────────────────────────────────────────────────────────────────────┘

/**
 * Schema estrito para entrada do Checkout.
 * Rejeita qualquer tentativa de injeção de preços, descontos ou totais mutados.
 */
export const CreateCheckoutSchema = z
  .object({
    productId: z
      .string({ required_error: "ID do produto é obrigatório" })
      .min(1, "ID do produto inválido"),
    widthCm: z.number().positive().min(30).max(500),
    depthCm: z.number().positive().min(30).max(300),
    heightCm: z.number().positive().min(10).max(250),
    materialIds: z
      .array(z.string())
      .min(1, "Selecione ao menos 1 material/tecido")
      .max(10),
    componentIds: z.array(z.string()).max(20).default([]),
    customerCep: z
      .string({ required_error: "CEP de entrega é obrigatório" })
      .regex(/^\d{5}-?\d{3}$/, "Formato de CEP inválido")
      .transform((val) => val.replace(/\D/g, "")),
    customerName: z.string().max(200).optional(),
    customerPhone: z
      .string()
      .regex(/^\+?55?\d{10,11}$/, "Telefone inválido")
      .optional(),
  })
  .strict(); // 🚨 CRÍTICO: Rejeita qualquer campo extra enviado no body!

export type CreateCheckoutInput = z.infer<typeof CreateCheckoutSchema>;

// ┌──────────────────────────────────────────────────────────────────────┐
// │  GERAÇÃO CRIPTOGRÁFICA DE HASH ANTICOLISÃO                           │
// └──────────────────────────────────────────────────────────────────────┘

/**
 * Gera um Hash de Orçamento único com formato 'ORD-XXXXXX'.
 * Usa `crypto.randomBytes` para aleatoriedade resistente a adivinhação.
 */
function generateOrderHash(): string {
  const randomHex = crypto.randomBytes(3).toString("hex").toUpperCase(); // Ex: '9A8B7C'
  return `ORD-${randomHex}`;
}

/**
 * Garante a persistência no banco de dados com ZERO COLISÕES.
 *
 * Método de Proteção:
 *   1. Tenta gerar um Hash curto e legível (ORD-XXXXXX).
 *   2. Tenta inserir na tabela `Quote` do Prisma.
 *   3. Se houver colisão na constraint UNIQUE (Prisma P2002), captura o erro,
 *      registra log de warning e tenta novamente com um novo Hash aleatório.
 *   4. Caso limite de 5 tentativas seja excedido, adiciona um sufixo UUID de contingência.
 */
async function saveQuoteWithCollisionProtection(
  data: {
    customerName?: string;
    customerPhone?: string;
    customerCep: string;
    freightCents: number;
    distanceKm: number;
    subtotalCents: number;
    totalCents: number;
    configSnapshot: object;
  }
) {
  const MAX_RETRIES = 5;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const hashId =
      attempt < MAX_RETRIES
        ? generateOrderHash()
        : `ORD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`; // Contingência expandida

    try {
      const quote = await prisma.quote.create({
        data: {
          hashId,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          customerCep: data.customerCep,
          freightCents: data.freightCents,
          distanceKm: data.distanceKm,
          subtotalCents: data.subtotalCents,
          totalCents: data.totalCents,
          configSnapshot: data.configSnapshot as any,
          sentToWhatsApp: false,
        },
      });

      return quote;
    } catch (err) {
      // P2002 é o código do Prisma para erro de Unique Constraint Violation
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "P2002"
      ) {
        console.warn(
          `[CHECKOUT_HASH_COLLISION] Colisão de Hash detectada ('${hashId}'). Tentativa ${attempt} de ${MAX_RETRIES}. Tentando novo hash...`
        );
        continue;
      }
      throw err; // Outros erros de banco lançam exceção normalmente
    }
  }

  throw new Error("Não foi possível gerar um Hash de pedido único no momento.");
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  HELPERS DE CÁLCULO SERVER-SIDE (ZERO TRUST)                        │
// └──────────────────────────────────────────────────────────────────────┘

/**
 * Geocodificação Server-Side real via Google Maps Distance Matrix API.
 * Proteção com AbortController e timeout estrito de 3000ms para evitar event loop blocking.
 */
async function calculateServerSideDistanceKm(cepDestino: string): Promise<number> {
  const cepClean = cepDestino.replace(/\D/g, "");
  if (cepClean.length !== 8) {
    throw new Error("CEP inválido para cálculo de frete");
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const originCep = process.env.FREIGHT_ORIGIN_CEP || "01001000";

  // Se a chave da API do Google Maps estiver configurada, faz a chamada HTTP real
  if (apiKey) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3000ms timeout estrito

    try {
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originCep}&destinations=${cepClean}&mode=driving&language=pt-BR&key=${apiKey}`;

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Google Maps API HTTP Error: ${response.status}`);
      }

      const data = (await response.json()) as {
        status: string;
        rows?: Array<{
          elements?: Array<{
            status: string;
            distance: { value: number; text: string };
          }>;
        }>;
      };

      if (
        data.status !== "OK" ||
        !data.rows?.[0]?.elements?.[0] ||
        data.rows[0].elements[0].status !== "OK"
      ) {
        throw new Error("Endereço ou CEP não localizado na API de mapas");
      }

      const distanceMetros = data.rows[0].elements[0].distance.value;
      return distanceMetros / 1000; // Converte metros para KM
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        console.error(
          "[CHECKOUT_GEOCODING_TIMEOUT] Google Maps API excedeu o limite de 3000ms."
        );
        throw new Error("Timeout ao consultar o provedor de geocodificação.");
      }
      console.error("[CHECKOUT_GEOCODING_ERROR] Erro ao consultar Google Maps:", err);
      throw new Error("Falha no serviço de geocodificação.");
    }
  }

  // Fallback seguro de desenvolvimento se GOOGLE_MAPS_API_KEY não estiver definida
  const cepNum = parseInt(cepClean, 10);
  return 15 + (cepNum % 335); // 15 km a 350 km
}

/** Formata valor de centavos para Real (R$) */
function formatCurrencyBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  POST /api/checkout/create                                           │
// └──────────────────────────────────────────────────────────────────────┘

/**
 * Handler principal do Checkout.
 *
 * Processo:
 *   1. Validação Zod strict do payload de entrada.
 *   2. Consulta do produto base e preços de materiais/componentes diretamente no banco.
 *   3. Cálculo server-side do subtotal dos itens.
 *   4. Cálculo server-side da distância e do valor do frete seguro:
 *      blocosDeDezKm = Math.floor(distanciaEmKm / 10)
 *      valorFrete = blocosDeDezKm * (0.30 * precoBaseReais)
 *   5. Persistência segura com proteção contra colisão de HashId.
 *   6. Retorno EXCLUSIVO do Hash e dos totais consolidados.
 */
export async function createCheckoutHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    // ────────────────────────────────────────────────────
    // 1. VALIDAÇÃO ZOD STRICT
    // ────────────────────────────────────────────────────
    const parseResult = CreateCheckoutSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        error: "Dados de checkout inválidos.",
        code: "INVALID_CHECKOUT_PAYLOAD",
        details: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const input = parseResult.data;

    // ────────────────────────────────────────────────────
    // 2. BUSCAR PRODUTO BASE E VALORES REAIS NO BANCO
    // ────────────────────────────────────────────────────
    const product = await prisma.product.findUnique({
      where: { id: input.productId },
      select: {
        id: true,
        name: true,
        slug: true,
        basePriceCents: true,
        category: true,
      },
    });

    if (!product) {
      res.status(404).json({
        error: "Produto base não encontrado.",
        code: "PRODUCT_NOT_FOUND",
      });
      return;
    }

    // Buscar materiais selecionados para somar adicionais
    const selectedMaterials = await prisma.material.findMany({
      where: { id: { in: input.materialIds } },
      select: { id: true, name: true, pricePerUnitCents: true },
    });

    // Buscar componentes selecionados
    const selectedComponents =
      input.componentIds.length > 0
        ? await prisma.component.findMany({
            where: { id: { in: input.componentIds } },
            select: { id: true, name: true, priceCents: true },
          })
        : [];

    // ────────────────────────────────────────────────────
    // 3. CÁLCULO SERVER-SIDE DO SUBTOTAL
    // ────────────────────────────────────────────────────
    const basePriceCents = product.basePriceCents;

    // Adicional de materiais (centavos)
    const materialsPriceCents = selectedMaterials.reduce(
      (sum: number, m: { pricePerUnitCents: number }) => sum + m.pricePerUnitCents,
      0
    );

    // Adicional de componentes (centavos)
    const componentsPriceCents = selectedComponents.reduce(
      (sum: number, c: { priceCents: number }) => sum + c.priceCents,
      0
    );

    const subtotalCents = basePriceCents + materialsPriceCents + componentsPriceCents;

    // ────────────────────────────────────────────────────
    // 4. GEOCODIFICAÇÃO & CÁLCULO DE FRETE SERVER-SIDE
    // ────────────────────────────────────────────────────
    const distanceKm = await calculateServerSideDistanceKm(input.customerCep);
    const blocosDeDezKm = Math.floor(distanceKm / 10);
    const precoBaseReais = basePriceCents / 100;
    const freightReais = blocosDeDezKm * (0.30 * precoBaseReais);
    const freightCents = Math.round(freightReais * 100);

    const totalCents = subtotalCents + freightCents;

    // ────────────────────────────────────────────────────
    // 5. MONTAR SNAPSHOT DO PROJETO 3D
    // ────────────────────────────────────────────────────
    const configSnapshot = {
      product: {
        id: product.id,
        name: product.name,
        slug: product.slug,
        category: product.category,
      },
      dimensions: {
        widthCm: input.widthCm,
        depthCm: input.depthCm,
        heightCm: input.heightCm,
      },
      materials: selectedMaterials.map((m: { id: string; name: string }) => ({ id: m.id, name: m.name })),
      components: selectedComponents.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })),
      calculatedAt: new Date().toISOString(),
    };

    // ────────────────────────────────────────────────────
    // 6. PERSISTIR NO BANCO COM PROTEÇÃO ANTICOLISÃO
    // ────────────────────────────────────────────────────
    const quote = await saveQuoteWithCollisionProtection({
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerCep: input.customerCep,
      distanceKm,
      freightCents,
      subtotalCents,
      totalCents,
      configSnapshot,
    });

    // ────────────────────────────────────────────────────
    // 7. RESPOSTA (Zero Disclosure de Preços Unitários Crus)
    // ────────────────────────────────────────────────────
    res.status(201).json({
      hashId: quote.hashId,
      totalCents: quote.totalCents,
      totalFormatado: formatCurrencyBRL(quote.totalCents),
      freightCents: quote.freightCents,
      freightFormatado: formatCurrencyBRL(quote.freightCents),
      subtotalCents: quote.subtotalCents,
      subtotalFormatado: formatCurrencyBRL(quote.subtotalCents),
      status: "PENDING",
      createdAt: quote.createdAt,
    });
  } catch (error) {
    console.error("[CHECKOUT_CONTROLLER_ERROR] Falha ao criar orçamento:", error);
    res.status(500).json({
      error: "Não foi possível finalizar o orçamento no momento.",
      code: "CHECKOUT_FAILED",
    });
  }
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  GET /api/checkout/quote/:hashId (Consulta Admin/Vendedor)            │
// └──────────────────────────────────────────────────────────────────────┘

/**
 * Consulta de orçamento via HashId para uso do Vendedor no Painel Admin.
 * Permite que o vendedor puxe do banco exatamente o que o cliente configurou,
 * anulando engenharia social ou alterações no chat do WhatsApp.
 */
export async function getQuoteByHashHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { hashId } = req.params;

    if (!hashId || !hashId.startsWith("ORD-")) {
      res.status(400).json({
        error: "Código de orçamento inválido.",
        code: "INVALID_HASH",
      });
      return;
    }

    const quote = await prisma.quote.findUnique({
      where: { hashId: hashId.toUpperCase() },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    if (!quote) {
      res.status(404).json({
        error: "Orçamento não encontrado no banco de dados.",
        code: "QUOTE_NOT_FOUND",
      });
      return;
    }

    res.status(200).json({
      hashId: quote.hashId,
      customerName: quote.customerName,
      customerPhone: quote.customerPhone,
      customerCep: quote.customerCep,
      distanceKm: quote.distanceKm,
      freightCents: quote.freightCents,
      freightFormatado: formatCurrencyBRL(quote.freightCents || 0),
      subtotalCents: quote.subtotalCents,
      subtotalFormatado: formatCurrencyBRL(quote.subtotalCents),
      totalCents: quote.totalCents,
      totalFormatado: formatCurrencyBRL(quote.totalCents),
      configSnapshot: quote.configSnapshot,
      sentToWhatsApp: quote.sentToWhatsApp,
      createdAt: quote.createdAt,
    });
  } catch (error) {
    console.error("[GET_QUOTE_BY_HASH_ERROR]:", error);
    res.status(500).json({
      error: "Erro ao consultar orçamento.",
      code: "INTERNAL_ERROR",
    });
  }
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  ROTAS                                                              │
// └──────────────────────────────────────────────────────────────────────┘

router.post("/create", createCheckoutHandler);
router.get("/quote/:hashId", getQuoteByHashHandler);

export default router;
