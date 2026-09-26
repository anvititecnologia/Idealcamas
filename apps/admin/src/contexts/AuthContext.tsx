// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Contexto de Autenticação (Client-Side)
// ──────────────────────────────────────────────────────────────────────────────
// Fornece dados do usuário autenticado para componentes client-side.
// O JWT permanece EXCLUSIVAMENTE no cookie HttpOnly — este provider
// apenas recebe os dados já decodificados via Server Component → props.
// ──────────────────────────────────────────────────────────────────────────────

"use client";

import {
  createContext,
  useContext,
  useCallback,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

// ┌──────────────────────────────────────────────────────────────────────┐
// │  TIPOS                                                              │
// └──────────────────────────────────────────────────────────────────────┘

export type UserRole = "FABRICANTE" | "VENDEDOR";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isFabricante: boolean;
  isVendedor: boolean;
  logout: () => Promise<void>;
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  CONTEXT                                                            │
// └──────────────────────────────────────────────────────────────────────┘

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ┌──────────────────────────────────────────────────────────────────────┐
// │  PROVIDER                                                           │
// └──────────────────────────────────────────────────────────────────────┘

interface AuthProviderProps {
  children: ReactNode;
  /** Dados do usuário injetados pelo Server Component pai */
  initialUser: AuthUser | null;
}

export function AuthProvider({ children, initialUser }: AuthProviderProps) {
  const [user] = useState<AuthUser | null>(initialUser);
  const router = useRouter();

  const logout = useCallback(async () => {
    try {
      // Chamar API para invalidar sessão e limpar cookie
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include", // Envia o cookie HttpOnly
      });
    } catch (error) {
      console.error("Erro ao fazer logout:", error);
    } finally {
      // Redirecionar para login independente da resposta
      router.push("/login");
      router.refresh(); // Limpar cache do Next.js
    }
  }, [router]);

  const value: AuthContextType = {
    user,
    isAuthenticated: !!user,
    isFabricante: user?.role === "FABRICANTE",
    isVendedor: user?.role === "VENDEDOR",
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  HOOK                                                               │
// └──────────────────────────────────────────────────────────────────────┘

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth deve ser usado dentro de um <AuthProvider>");
  }
  return context;
}
