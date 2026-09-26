// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Helper: Ler dados do usuário no Server Component
// ──────────────────────────────────────────────────────────────────────────────
// Lê os headers injetados pelo middleware do Next.js (x-user-id, x-user-role).
// Usado nos Server Components para passar dados ao AuthProvider client-side.
// ──────────────────────────────────────────────────────────────────────────────

import { headers } from "next/headers";
import type { AuthUser, UserRole } from "@admin/contexts/AuthContext";

const API_URL = process.env.API_URL || "http://localhost:3001";

/**
 * Lê os dados do usuário autenticado a partir dos headers do middleware.
 * Deve ser chamada APENAS em Server Components.
 *
 * Fluxo:
 *   1. Middleware decodifica JWT → injeta headers x-user-*
 *   2. Este helper lê os headers
 *   3. (Opcional) Busca dados completos da API para dados não contidos no JWT
 */
export async function getServerUser(): Promise<AuthUser | null> {
  const headersList = await headers();

  const userId = headersList.get("x-user-id");
  const userEmail = headersList.get("x-user-email");
  const userRole = headersList.get("x-user-role") as UserRole | null;

  if (!userId || !userEmail || !userRole) {
    return null;
  }

  // Dados mínimos do JWT (suficientes para RBAC no front)
  return {
    id: userId,
    email: userEmail,
    name: userEmail.split("@")[0], // Fallback — em produção, buscar da API
    role: userRole,
  };
}

/**
 * Fetch autenticado para o back-end.
 * Encaminha o cookie de sessão automaticamente (server-to-server).
 */
export async function fetchFromApi<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headersList = await headers();
  const cookieHeader = headersList.get("cookie") || "";

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader, // Encaminhar cookies do browser → API
      ...options.headers,
    },
    cache: "no-store", // Admin sempre busca dados frescos
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}
