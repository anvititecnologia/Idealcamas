// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Freight Controller (Back-end)
// ──────────────────────────────────────────────────────────────────────────────
// Motor de Cálculo de Frete "Cego" para o Front-end.
//
// Defesas de Segurança e Regras de Negócio:
//   1. Validação Zod .strict(): Aceita APENAS cepDestino e cartId.
//      Qualquer parâmetro mutado pelo cliente (ex: distancia, valorFrete)
//      é rejeitado com HTTP 400 imediato (prevenção contra Parameter Tampering).
//   2. Geocodificação Server-Side: Distância obtida estritamente no servidor
//      (integração / simulação segura com Google Maps Distance Matrix API).
//   3. Matemática do Frete no Servidor (Zero Trust):
//      - blocosDeDezKm = Math.floor(distanciaEmKm / 10)
//      - valorFrete = blocosDeDezKm * (0.30 * precoBaseDoProduto)
//   4. Tratamento de Exceções Opaque: Falhas na API de mapas ou CEPs inválidos
//      retornam erro genérico sem vazar stack traces ou detalhes internos.
// ──────────────────────────────────────────────────────────────────────────────

import { Request, Response, Router } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// ┌──────────────────────────────────────────────────────────────────────┐
// │  SCHEMA DE VALIDAÇÃO STRICT (Zero Parameter Tampering)               │
// └──────────────────────────────────────────────────────────────────────┘

/**
 * Schema estrito para solicitação de frete.
 *
 * DEFESA: O uso de .strict() garante que se o atacante tentar injetar
 * campos como `distancia: 0`, `valorFrete: 0` ou `precoBase: 1`,
 * o Zod lançará um erro de validação imediatamente (HTTP 400).
 */
export const CalculateFreightSchema = z
  .object({
    cepDestino: z
      .string({
        required_error: "CEP de destino é obrigatório",
        invalid_type_error: "CEP de destino deve ser uma string",
      })
      .regex(/^\d{5}-?\d{3}$/, "Formato de CEP inválido (esperado: 00000-000 ou 00000000)")
      .transform((val) => val.replace(/\D/g, "")), // Normaliza apenas dígitos (8 caracteres)
    cartId: z
      .string({
        required_error: "ID do carrinho é obrigatório",
        invalid_type_error: "ID do carrinho deve ser uma string",
      })
      .min(1, "ID do carrinho não pode ser vazio"),
  })
  .strict(); // 🚨 CRÍTICO: Rejeita qualquer propriedade não mapeada!

export type CalculateFreightInput = z.infer<typeof CalculateFreightSchema>;

// ┌──────────────────────────────────────────────────────────────────────┐
// │  CONFIGURAÇÃO E CONSTANTES DE FRETE                                 │
// └──────────────────────────────────────────────────────────────────────┘

// CEP da fábrica/centro de distribuição (Ideal Camas - Origem)
const CEP_ORIGEM_FABRICA = process.env.FREIGHT_ORIGIN_CEP || "01001000";

// Chave da API do Google Maps (armazenada de forma segura nas variáveis de ambiente)
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// ┌──────────────────────────────────────────────────────────────────────┐
// │  INTEGRAÇÃO GOOGLE MAPS / GEOCODIFICAÇÃO SERVER-SIDE                 │
// └──────────────────────────────────────────────────────────────────────┘

interface DistanceMatrixResult {
  distanciaEmKm: number;
  duracaoTexto: string;
}

/**
 * Obtém a distância real em KM entre a fábrica e o CEP de destino.
 *
 * Em ambiente de produção: Faz chamada HTTP segura ao Google Maps Distance Matrix API.
 * Em desenvolvimento/testes sem chave: Simula o cálculo de distância baseado em hash do CEP.
 *
 * @throws Error com detalhes genéricos em caso de falha de conexão ou CEP não encontrado.
 */
async function getDistanceBetweenCeps(
  cepOrigem: string,
  cepDestino: string
): Promise<DistanceMatrixResult> {
  // Se a chave da API estiver disponível em produção, utilizar a API real
  if (GOOGLE_MAPS_API_KEY) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3000ms strict timeout

    try {
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${cepOrigem}&destinations=${cepDestino}&mode=driving&language=pt-BR&key=${GOOGLE_MAPS_API_KEY}`;

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Google Maps API HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        status: string;
        rows?: Array<{
          elements?: Array<{
            status: string;
            distance: { value: number; text: string };
            duration: { text: string };
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

      const element = data.rows[0].elements[0];
      const distanciaEmMetros = element.distance.value; // Valor numérico em metros
      const duracaoTexto = element.duration.text; // Ex: "45 min"

      return {
        distanciaEmKm: distanciaEmMetros / 1000,
        duracaoTexto,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        console.error("[FREIGHT_MAPS_TIMEOUT] Google Maps Distance Matrix API excedeu o limite de 3000ms");
        throw new Error("Timeout no provedor de geocodificação");
      }
      // Log interno para monitoramento (não exposto ao cliente)
      console.error("[FREIGHT_MAPS_ERROR] Erro ao consultar Google Maps API:", error);
      throw new Error("Falha no provedor de geocodificação");
    }
  }

  // ── SIMULAÇÃO SEGURA SERVER-SIDE (Desenvolvimento / Fallback sem API Key) ──
  // Valida estruturalmente se o CEP possui 8 dígitos
  if (cepDestino.length !== 8) {
    throw new Error("CEP inválido para entrega");
  }

  // Algoritmo determinístico de simulação baseado nos dígitos do CEP de destino
  const cepNumeric = parseInt(cepDestino, 10);
  if (isNaN(cepNumeric)) {
    throw new Error("CEP contém caracteres não numéricos");
  }

  // Simula distância entre 15 km e 350 km
  const distanciaSimuladaKm = 15 + (cepNumeric % 335);

  return {
    distanciaEmKm: distanciaSimuladaKm,
    duracaoTexto: `${Math.round(distanciaSimuladaKm / 60 * 60)} min`,
  };
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  CALCULADORA DE FRETE SERVER-SIDE (REGRAS DE NEGÓCIO)               │
// └──────────────────────────────────────────────────────────────────────┘

interface FreightCalculationOutput {
  valorFreteCents: number;
  valorFreteFormatado: string;
  distanciaEmKm: number;
  blocosDeDezKm: number;
  prazoEstimadoDias: number;
}

/**
 * Executa a matemática estrita do cálculo de frete:
 *
 * Formula solicitada:
 *   blocosDeDezKm = Math.floor(distanciaEmKm / 10)
 *   valorFrete = blocosDeDezKm * (0.30 * precoBaseDoProduto)
 *
 * @param distanciaEmKm Distância calculada server-side
 * @param precoBaseCents Preço base do produto retornado do banco em centavos
 */
function calculateFreightValue(
  distanciaEmKm: number,
  precoBaseCents: number
): FreightCalculationOutput {
  // 1. Número de blocos completos de 10 km
  const blocosDeDezKm = Math.floor(distanciaEmKm / 10);

  // 2. Preço base em reais para aplicação do fator 0.30
  const precoBaseReais = precoBaseCents / 100;

  // 3. Cálculo do frete em reais: blocosDeDezKm * (0.30 * precoBaseDoProduto)
  const valorFreteReais = blocosDeDezKm * (0.30 * precoBaseReais);

  // 4. Conversão para centavos (evita imprecisão de ponto flutuante em transações)
  const valorFreteCents = Math.round(valorFreteReais * 100);

  // 5. Prazo estimado: 2 dias base + 1 dia extra a cada 50km
  const prazoEstimadoDias = 2 + Math.floor(distanciaEmKm / 50);

  // 6. Formatação em BRL (R$)
  const valorFreteFormatado = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valorFreteCents / 100);

  return {
    valorFreteCents,
    valorFreteFormatado,
    distanciaEmKm: Number(distanciaEmKm.toFixed(1)),
    blocosDeDezKm,
    prazoEstimadoDias,
  };
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  POST /api/freight/calculate                                         │
// └──────────────────────────────────────────────────────────────────────┘

/**
 * Handler principal da rota de cálculo de frete.
 *
 * Passos de execução:
 *   1. Validação estrita do payload (Zod .strict())
 *   2. Busca do carrinho/orçamento no banco de dados para obter o precoBase do produto real
 *   3. Geocodificação server-side (distância em KM)
 *   4. Aplicação da matemática de negócio no servidor
 *   5. Retorno do resultado calculado
 *
 * Tratamento de erros:
 *   Qualquer exceção não prevista ou erro da API externa é capturado e retornado
 *   como uma mensagem genérica opaca: "Não foi possível calcular o frete para esta região".
 */
export async function calculateFreightHandler(req: Request, res: Response): Promise<void> {
  try {
    // ────────────────────────────────────────────────────
    // 1. VALIDAÇÃO ZOD STRICT (Barra Parameter Tampering)
    // ────────────────────────────────────────────────────
    const parseResult = CalculateFreightSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        error: "Parâmetros inválidos para cálculo de frete.",
        code: "INVALID_FREIGHT_PAYLOAD",
        details: parseResult.error.flatten().fieldErrors,
      });
      return;
    }

    const { cepDestino, cartId } = parseResult.data;

    // ────────────────────────────────────────────────────
    // 2. BUSCAR PREÇO BASE DO PRODUTO NO BANCO DE DADOS
    // ────────────────────────────────────────────────────
    // Tenta localizar a Quote/Carrinho ou usa fallback do produto no banco
    let precoBaseCents = 0;

    const quote = await prisma.quote.findUnique({
      where: { id: cartId },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    if (quote && quote.items.length > 0) {
      // Soma o preço base dos produtos do carrinho
      precoBaseCents = quote.items.reduce(
        (sum: number, item: { product: { basePriceCents: number }; quantity: number }) =>
          sum + item.product.basePriceCents * item.quantity,
        0
      );
    } else {
      // Se cartId for o ID direto do Produto (consulta rápida de frete na página do produto)
      const product = await prisma.product.findUnique({
        where: { id: cartId },
        select: { basePriceCents: true },
      });

      if (product) {
        precoBaseCents = product.basePriceCents;
      } else {
        // Se nem Quote nem Product forem encontrados com o ID informado
        res.status(404).json({
          error: "Carrinho ou produto não encontrado.",
          code: "CART_NOT_FOUND",
        });
        return;
      }
    }

    // ────────────────────────────────────────────────────
    // 3. GEOCODIFICAÇÃO E DISTÂNCIA SERVER-SIDE
    // ────────────────────────────────────────────────────
    const { distanciaEmKm } = await getDistanceBetweenCeps(
      CEP_ORIGEM_FABRICA,
      cepDestino
    );

    // ────────────────────────────────────────────────────
    // 4. MATEMÁTICA SERVER-SIDE DO FRETE
    // ────────────────────────────────────────────────────
    const resultadoCalculo = calculateFreightValue(distanciaEmKm, precoBaseCents);

    // Opcional: Atualizar os dados de frete na Quote se for um orçamento persistido
    if (quote) {
      await prisma.quote.update({
        where: { id: cartId },
        data: {
          customerCep: cepDestino,
          distanceKm: distanciaEmKm,
          freightCents: resultadoCalculo.valorFreteCents,
          totalCents: quote.subtotalCents + resultadoCalculo.valorFreteCents,
        },
      });
    }

    // ────────────────────────────────────────────────────
    // 5. RESPOSTA DE SUCESSO
    // ────────────────────────────────────────────────────
    res.status(200).json({
      cepDestino,
      distanciaKm: resultadoCalculo.distanciaEmKm,
      blocosDeDezKm: resultadoCalculo.blocosDeDezKm,
      valorFreteCents: resultadoCalculo.valorFreteCents,
      valorFreteFormatado: resultadoCalculo.valorFreteFormatado,
      prazoEstimadoDias: resultadoCalculo.prazoEstimadoDias,
    });
  } catch (error) {
    // ────────────────────────────────────────────────────
    // TRATAMENTO DE ERROS OPACO (Zero Leakage)
    // ────────────────────────────────────────────────────
    // Registra a stack trace internamente no console/log do servidor para debugging
    console.error("[FREIGHT_CONTROLLER_ERROR] Falha ao processar cálculo de frete:", error);

    // Retorna mensagem estritamente genérica e opaca ao cliente front-end
    res.status(400).json({
      error: "Não foi possível calcular o frete para esta região",
      code: "FREIGHT_CALCULATION_FAILED",
    });
  }
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  DEFINIÇÃO DA ROTA                                                  │
// └──────────────────────────────────────────────────────────────────────┘

router.post("/calculate", calculateFreightHandler);

export default router;
