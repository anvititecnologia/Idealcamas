// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Auth Controller (Back-end)
// ──────────────────────────────────────────────────────────────────────────────
// Autenticação do painel Admin com defesas em camadas:
//
//   1. Rate Limiting implacável: 5 tentativas / 15 min por IP
//   2. Validação Zod .strict() no payload de login
//   3. Verificação de credenciais com Argon2 (resistente a side-channel)
//   4. JWT gerado e enviado EXCLUSIVAMENTE via Set-Cookie HttpOnly
//   5. Audit trail para login/logout (IP, user-agent, timestamp)
//   6. Mensagens de erro opacas (não revelam se email existe)
//
// IMPORTANTE: O token JWT NUNCA é retornado no body da resposta.
// ──────────────────────────────────────────────────────────────────────────────

import { Request, Response, Router } from "express";
import jwt from "jsonwebtoken";
import argon2 from "argon2";
import rateLimit from "express-rate-limit";
import { PrismaClient } from "@prisma/client";
import { LoginSchema } from "@idealcamas/shared";
import { createAuditLog } from "../services/audit.service";

const prisma = new PrismaClient();
const router = Router();

// ┌──────────────────────────────────────────────────────────────────────┐
// │  CONFIGURAÇÃO                                                       │
// └──────────────────────────────────────────────────────────────────────┘

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

/**
 * Duração do cookie em segundos.
 * Corresponde ao JWT_EXPIRES_IN para manter sincronia.
 */
function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 8 * 3600; // fallback: 8h

  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "s": return value;
    case "m": return value * 60;
    case "h": return value * 3600;
    case "d": return value * 86400;
    default: return 8 * 3600;
  }
}

const COOKIE_MAX_AGE_SECONDS = parseExpiresIn(JWT_EXPIRES_IN);

// ┌──────────────────────────────────────────────────────────────────────┐
// │  RATE LIMITING — DEFESA ANTI BRUTE-FORCE                           │
// └──────────────────────────────────────────────────────────────────────┘

/**
 * Rate limiter implacável para a rota de login.
 *
 * Configuração:
 *   - 5 tentativas por IP a cada 15 minutos
 *   - Após atingir o limite, o IP é bloqueado até o window expirar
 *   - O header Retry-After é enviado para informar o tempo de espera
 *
 * DEFESA: Anula ataques de força bruta e credential stuffing.
 * O atacante precisa de >15min por batch de 5 tentativas,
 * tornando ataques automatizados impraticáveis.
 */
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5,                    // 5 tentativas
  standardHeaders: true,     // Envia RateLimit-* headers
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Conta TODAS as tentativas (inclui sucesso)
  keyGenerator: (req: Request) => {
    // Usa o IP real (considerando proxy reverso)
    const forwarded = req.headers["x-forwarded-for"];
    return typeof forwarded === "string"
      ? forwarded.split(",")[0].trim()
      : req.socket.remoteAddress || "unknown";
  },
  handler: (_req: Request, res: Response) => {
    // ── Mensagem opaca — não revela detalhes internos ──
    res.status(429).json({
      error: "Muitas tentativas de login. Tente novamente em alguns minutos.",
      code: "AUTH_RATE_LIMITED",
    });
  },
});

// ┌──────────────────────────────────────────────────────────────────────┐
// │  HELPERS                                                            │
// └──────────────────────────────────────────────────────────────────────┘

/** Extrai o IP real do request */
function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  return typeof forwarded === "string"
    ? forwarded.split(",")[0].trim()
    : req.socket.remoteAddress || "unknown";
}

/**
 * Define o cookie de sessão com todas as flags de segurança.
 *
 * Flags:
 *   - HttpOnly: JavaScript não pode ler o cookie (mitiga XSS)
 *   - Secure: Só trafega via HTTPS (ativo em produção)
 *   - SameSite=Strict: Não é enviado em requests cross-origin (mitiga CSRF)
 *   - Path=/: Disponível em todas as rotas
 *   - Max-Age: Expiração sincronizada com o JWT
 */
function setSessionCookie(res: Response, token: string): void {
  res.cookie("session_token", token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS * 1000, // Express espera milliseconds
  });
}

/** Limpa o cookie de sessão */
function clearSessionCookie(res: Response): void {
  res.cookie("session_token", "", {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  POST /api/auth/login                                               │
// └──────────────────────────────────────────────────────────────────────┘

/**
 * Fluxo de autenticação:
 *
 *   1. Validar payload com Zod .strict() (barrar campos extras)
 *   2. Buscar usuário por email (sem revelar se existe)
 *   3. Verificar senha com Argon2 (resistente a timing attacks)
 *   4. Verificar se a conta está ativa
 *   5. Gerar JWT com claims mínimos (userId, email, role)
 *   6. Enviar token via Set-Cookie HttpOnly
 *   7. Registrar login na trilha de auditoria
 *   8. Atualizar lastLoginAt e lastLoginIp
 *
 * DEFESA CONTRA TIMING ATTACKS:
 *   Se o email não existir, ainda executamos argon2.verify contra
 *   um hash dummy para garantir que o tempo de resposta seja
 *   indistinguível de uma senha incorreta com email válido.
 */
async function loginHandler(req: Request, res: Response): Promise<void> {
  const clientIp = getClientIp(req);

  // ────────────────────────────────────────────────────
  // 1. VALIDAR PAYLOAD (Zod .strict())
  // ────────────────────────────────────────────────────
  const parsed = LoginSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "Dados de login inválidos.",
      code: "AUTH_INVALID_PAYLOAD",
      details: parsed.error.flatten(),
    });
    return;
  }

  const { email, password } = parsed.data;

  // ────────────────────────────────────────────────────
  // 2. BUSCAR USUÁRIO
  // ────────────────────────────────────────────────────
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      role: true,
      isActive: true,
    },
  });

  // ────────────────────────────────────────────────────
  // 3. VERIFICAR SENHA (com proteção contra timing attack)
  // ────────────────────────────────────────────────────

  /**
   * DEFESA: Se o usuário não existe, verificamos contra um hash dummy.
   * Isso garante que o tempo de resposta seja o mesmo, impedindo que
   * um atacante descubra quais emails estão cadastrados.
   *
   * O hash dummy é um hash Argon2 pré-computado de uma string aleatória.
   */
  const DUMMY_HASH =
    "$argon2id$v=19$m=65536,t=3,p=4$c29tZXJhbmRvbXNhbHQ$YTVuT2NLaE9nZmVFSEx0L1FGVW5KNGJoTThDNzVxZ0E";

  const hashToVerify = user?.passwordHash || DUMMY_HASH;

  let passwordValid = false;
  try {
    passwordValid = await argon2.verify(hashToVerify, password);
  } catch {
    // Argon2 pode lançar se o hash for malformado (ex: dummy hash)
    // Nesse caso, o login simplesmente falha — sem revelar o motivo
    passwordValid = false;
  }

  // ── Credenciais inválidas (mensagem opaca) ──
  if (!user || !passwordValid) {
    res.status(401).json({
      error: "E-mail ou senha incorretos.",
      code: "AUTH_INVALID_CREDENTIALS",
    });
    return;
  }

  // ────────────────────────────────────────────────────
  // 4. VERIFICAR CONTA ATIVA
  // ────────────────────────────────────────────────────
  if (!user.isActive) {
    res.status(403).json({
      error: "Conta desativada. Entre em contato com o administrador.",
      code: "AUTH_ACCOUNT_DISABLED",
    });
    return;
  }

  // ────────────────────────────────────────────────────
  // 5. GERAR JWT COM CLAIMS MÍNIMOS
  // ────────────────────────────────────────────────────

  /**
   * O payload do JWT contém apenas o mínimo necessário:
   *   - userId: para buscar dados completos quando necessário
   *   - email: para auditoria rápida
   *   - role: para RBAC no middleware do Next.js
   *
   * NUNCA incluir: senha, dados pessoais, tokens de API, etc.
   */
  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
      issuer: "idealcamas-api",
      audience: "idealcamas-admin",
    }
  );

  // ────────────────────────────────────────────────────
  // 6. SET-COOKIE (ÚNICA forma de enviar o token)
  // ────────────────────────────────────────────────────
  setSessionCookie(res, token);

  // ────────────────────────────────────────────────────
  // 7. AUDIT TRAIL — Registrar login
  // ────────────────────────────────────────────────────
  await createAuditLog({
    action: "USER_LOGIN",
    entity: "users",
    entityId: user.id,
    newValue: JSON.stringify({
      ip: clientIp,
      userAgent: req.headers["user-agent"]?.substring(0, 200),
      timestamp: new Date().toISOString(),
    }),
    userId: user.id,
    req,
  });

  // ────────────────────────────────────────────────────
  // 8. ATUALIZAR lastLoginAt
  // ────────────────────────────────────────────────────
  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      lastLoginIp: clientIp,
    },
  });

  // ────────────────────────────────────────────────────
  // 9. RESPOSTA (sem o token no body!)
  // ────────────────────────────────────────────────────
  res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  POST /api/auth/logout                                              │
// └──────────────────────────────────────────────────────────────────────┘

async function logoutHandler(req: Request, res: Response): Promise<void> {
  // Extrair userId do token atual (se válido)
  const token = req.cookies?.session_token;
  let userId: string | null = null;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      userId = decoded.userId;
    } catch {
      // Token inválido/expirado — limpar cookie de qualquer forma
    }
  }

  // Limpar cookie
  clearSessionCookie(res);

  // Audit trail (se tínhamos um usuário válido)
  if (userId) {
    await createAuditLog({
      action: "USER_LOGOUT",
      entity: "users",
      entityId: userId,
      newValue: JSON.stringify({
        ip: getClientIp(req),
        timestamp: new Date().toISOString(),
      }),
      userId,
      req,
    });
  }

  res.status(200).json({ message: "Sessão encerrada." });
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  GET /api/auth/me                                                   │
// └──────────────────────────────────────────────────────────────────────┘

/**
 * Retorna os dados do usuário autenticado.
 * Usado pelo front-end para verificar se a sessão é válida.
 * A validação completa do JWT (assinatura) ocorre aqui.
 */
async function meHandler(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.session_token;

  if (!token) {
    res.status(401).json({ error: "Não autenticado.", code: "AUTH_REQUIRED" });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: "idealcamas-api",
      audience: "idealcamas-admin",
    }) as { userId: string; email: string; role: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      clearSessionCookie(res);
      res.status(401).json({
        error: "Sessão inválida.",
        code: "AUTH_INVALID_SESSION",
      });
      return;
    }

    res.status(200).json({ user });
  } catch {
    clearSessionCookie(res);
    res.status(401).json({
      error: "Sessão expirada.",
      code: "AUTH_EXPIRED",
    });
  }
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  ROTAS                                                              │
// └──────────────────────────────────────────────────────────────────────┘

router.post("/login", loginRateLimiter, loginHandler);
router.post("/logout", logoutHandler);
router.get("/me", meHandler);

export default router;
