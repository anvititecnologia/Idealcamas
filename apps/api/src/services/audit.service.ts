// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Serviço de Auditoria Imutável
// ──────────────────────────────────────────────────────────────────────────────
// Registra operações críticas no AuditLog de forma imutável.
// Campos registrados: ação, entidade, valores antigo/novo, IP, user-agent.
// ──────────────────────────────────────────────────────────────────────────────

import { Request } from "express";
import { PrismaClient, AuditAction } from "@prisma/client";

const prisma = new PrismaClient();

interface AuditLogInput {
  action: AuditAction | string;
  entity: string;
  entityId: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  userId: string;
  req: Request;
}

/**
 * Registra uma entrada imutável na trilha de auditoria.
 * Nenhuma entry pode ser atualizada ou deletada — apenas inserida.
 */
export async function createAuditLog(input: AuditLogInput): Promise<void> {
  try {
    // Buscar email do usuário para snapshot
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    });

    if (!user) {
      console.error(`[AUDIT] Usuário ${input.userId} não encontrado para auditoria`);
      return;
    }

    // Extrair IP real (considerando proxy reverso)
    const forwarded = input.req.headers["x-forwarded-for"];
    const ipAddress =
      typeof forwarded === "string"
        ? forwarded.split(",")[0].trim()
        : input.req.socket.remoteAddress || "unknown";

    await prisma.auditLog.create({
      data: {
        action: input.action as AuditAction,
        entity: input.entity,
        entityId: input.entityId,
        field: input.field,
        oldValue: input.oldValue,
        newValue: input.newValue,
        userId: input.userId,
        userEmail: user.email,
        ipAddress,
        userAgent: input.req.headers["user-agent"]?.substring(0, 500),
      },
    });
  } catch (error) {
    // Auditoria NUNCA deve derrubar o request principal.
    // Mas deve gerar alerta para monitoramento.
    console.error("[AUDIT] Falha ao registrar auditoria:", error);
    // TODO: Enviar para serviço de alertas (Sentry, CloudWatch, etc.)
  }
}

/**
 * Helper: Registra alteração de preço com diff.
 * Chamada dedicada para rastrear mudanças financeiras.
 */
export async function auditPriceChange(params: {
  entity: string;
  entityId: string;
  field: string;
  oldPrice: number;
  newPrice: number;
  userId: string;
  req: Request;
}): Promise<void> {
  await createAuditLog({
    action: "PRICE_UPDATE",
    entity: params.entity,
    entityId: params.entityId,
    field: params.field,
    oldValue: JSON.stringify({ cents: params.oldPrice }),
    newValue: JSON.stringify({ cents: params.newPrice }),
    userId: params.userId,
    req: params.req,
  });
}
