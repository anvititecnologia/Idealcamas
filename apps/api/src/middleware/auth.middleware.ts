// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Auth Middleware (JWT HttpOnly Cookie)
// ──────────────────────────────────────────────────────────────────────────────
// Protege rotas do Admin com JWT em HttpOnly + Secure cookies.
// Implementa RBAC para Fabricante vs Vendedor.
// ──────────────────────────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";

const JWT_SECRET = process.env.JWT_SECRET!;

interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

/**
 * Middleware de autenticação.
 * Extrai o JWT do cookie HttpOnly "session_token".
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.session_token;

  if (!token) {
    res.status(401).json({
      error: "Autenticação necessária",
      code: "AUTH_REQUIRED",
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;

    // Injetar dados do usuário no request
    (req as any).userId = decoded.userId;
    (req as any).userEmail = decoded.email;
    (req as any).userRole = decoded.role;

    next();
  } catch (err) {
    res.status(401).json({
      error: "Token inválido ou expirado",
      code: "AUTH_INVALID_TOKEN",
    });
  }
}

/**
 * Middleware RBAC — Restringe acesso por perfil.
 *
 * @example
 *   router.post("/products", requireAuth, requireRole("FABRICANTE"), createProduct);
 *   router.get("/quotes", requireAuth, requireRole("FABRICANTE", "VENDEDOR"), listQuotes);
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = (req as any).userRole as UserRole;

    if (!roles.includes(userRole)) {
      res.status(403).json({
        error: "Acesso negado para este perfil",
        code: "AUTH_FORBIDDEN",
        requiredRoles: roles,
      });
      return;
    }

    next();
  };
}
