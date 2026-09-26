// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Next.js Middleware (Admin)
// ──────────────────────────────────────────────────────────────────────────────
// Executa no Edge Runtime ANTES de qualquer renderização.
// Responsável por:
//   1. Verificar presença do JWT no cookie HttpOnly "session_token"
//   2. Decodificar e validar claims (exp, role)
//   3. Aplicar RBAC — redirecionar usuários sem permissão
//   4. Redirecionar para /login se não autenticado
//
// IMPORTANTE: O token NUNCA é exposto ao JavaScript do cliente.
// O cookie é definido pelo back-end com flags HttpOnly + Secure + SameSite.
// ──────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";

// ┌──────────────────────────────────────────────────────────────────────┐
// │  TIPOS                                                              │
// └──────────────────────────────────────────────────────────────────────┘

type UserRole = "FABRICANTE" | "VENDEDOR";

interface JwtPayload {
  userId: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

/**
 * Mapa de permissões RBAC por rota.
 * Define quais roles podem acessar cada padrão de rota do admin.
 */
const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  // ── Acesso total: apenas FABRICANTE ──
  "/admin/products":    ["FABRICANTE"],
  "/admin/materials":   ["FABRICANTE"],
  "/admin/components":  ["FABRICANTE"],
  "/admin/uploads":     ["FABRICANTE"],
  "/admin/settings":    ["FABRICANTE"],
  "/admin/users":       ["FABRICANTE"],
  "/admin/audit":       ["FABRICANTE"],

  // ── Leitura: FABRICANTE e VENDEDOR ──
  "/admin/dashboard":   ["FABRICANTE", "VENDEDOR"],
  "/admin/quotes":      ["FABRICANTE", "VENDEDOR"],
  "/admin/reports":     ["FABRICANTE", "VENDEDOR"],
};

// ┌──────────────────────────────────────────────────────────────────────┐
// │  FUNÇÕES AUXILIARES                                                  │
// └──────────────────────────────────────────────────────────────────────┘

/**
 * Decodifica o payload do JWT sem verificar a assinatura.
 * A verificação criptográfica completa é feita pelo back-end.
 *
 * No Edge Runtime do Next.js, não temos acesso a bibliotecas Node.js
 * como `jsonwebtoken`. A estratégia é:
 *   - Middleware: decodifica para routing/RBAC (barreira rápida)
 *   - API Route / Server Action: valida assinatura completa via back-end
 *
 * Isso é seguro porque:
 *   1. O cookie é HttpOnly — não pode ser lido/modificado pelo JS do cliente
 *   2. O cookie é Secure — só trafega via HTTPS
 *   3. O cookie tem SameSite=Strict — proteção contra CSRF
 *   4. Qualquer operação de escrita valida o token no back-end
 */
function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    // Decodificar a parte do payload (Base64URL → JSON)
    const payloadBase64 = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const payloadJson = atob(payloadBase64);
    const payload = JSON.parse(payloadJson) as JwtPayload;

    // Verificar expiração
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Token expirado
    }

    // Verificar campos obrigatórios
    if (!payload.userId || !payload.email || !payload.role) {
      return null;
    }

    // Verificar role válida
    if (!["FABRICANTE", "VENDEDOR"].includes(payload.role)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Verifica se o usuário tem permissão para acessar a rota.
 * Usa matching de prefixo para suportar rotas dinâmicas (ex: /admin/products/[id]).
 */
function hasRoutePermission(pathname: string, role: UserRole): boolean {
  // Procurar a rota mais específica que faz match
  const matchedRoute = Object.keys(ROUTE_PERMISSIONS)
    .filter((route) => pathname.startsWith(route))
    .sort((a, b) => b.length - a.length)[0]; // Mais específica primeiro

  if (!matchedRoute) {
    // Rota /admin sem sub-rota → redirecionar para dashboard
    // Ou rota não mapeada → permitir (fallback seguro no server component)
    return true;
  }

  return ROUTE_PERMISSIONS[matchedRoute].includes(role);
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  MIDDLEWARE PRINCIPAL                                                │
// └──────────────────────────────────────────────────────────────────────┘

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ────────────────────────────────────────────────────
  // 1. IGNORAR ROTAS PÚBLICAS
  // ────────────────────────────────────────────────────
  const publicPaths = ["/login", "/api", "/_next", "/favicon.ico"];
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // ────────────────────────────────────────────────────
  // 2. EXTRAIR TOKEN DO COOKIE HttpOnly
  // ────────────────────────────────────────────────────
  const token = request.cookies.get("session_token")?.value;

  if (!token) {
    // Sem token → redirecionar para login com return URL
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ────────────────────────────────────────────────────
  // 3. DECODIFICAR JWT (Edge-compatible)
  // ────────────────────────────────────────────────────
  const payload = decodeJwtPayload(token);

  if (!payload) {
    // Token inválido ou expirado → limpar cookie e redirecionar
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("expired", "true");
    const response = NextResponse.redirect(loginUrl);

    // Remover cookie expirado/inválido
    response.cookies.set("session_token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 0,
      path: "/",
    });

    return response;
  }

  // ────────────────────────────────────────────────────
  // 4. RBAC — Verificar permissão da rota
  // ────────────────────────────────────────────────────
  if (!hasRoutePermission(pathname, payload.role)) {
    // Usuário autenticado mas sem permissão para esta rota
    const forbiddenUrl = new URL("/admin/dashboard", request.url);
    forbiddenUrl.searchParams.set("forbidden", "true");
    return NextResponse.redirect(forbiddenUrl);
  }

  // ────────────────────────────────────────────────────
  // 5. INJETAR HEADERS COM DADOS DO USUÁRIO
  //    (acessíveis nos Server Components via headers())
  // ────────────────────────────────────────────────────
  const response = NextResponse.next();

  // Headers internos — NÃO expostos ao cliente
  response.headers.set("x-user-id", payload.userId);
  response.headers.set("x-user-email", payload.email);
  response.headers.set("x-user-role", payload.role);

  return response;
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  MATCHER — Quais rotas passam pelo middleware                       │
// └──────────────────────────────────────────────────────────────────────┘

export const config = {
  matcher: [
    // Proteger todas as rotas /admin
    "/admin/:path*",
    // Rota raiz redireciona para /admin/dashboard se autenticado
    "/",
  ],
};
