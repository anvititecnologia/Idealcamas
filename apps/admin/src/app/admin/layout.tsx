// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Admin Layout (Server Component)
// ──────────────────────────────────────────────────────────────────────────────
// Layout raiz do painel Admin. Combina:
//   1. Leitura dos dados do usuário via Server Component (headers do middleware)
//   2. Injeção no AuthProvider client-side
//   3. Sidebar + Topbar + Conteúdo
// ──────────────────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerUser } from "@admin/lib/auth.server";
import { AuthProvider } from "@admin/contexts/AuthContext";
import { Sidebar } from "@admin/components/layout/Sidebar";
import { Topbar } from "@admin/components/layout/Topbar";

interface AdminLayoutProps {
  children: ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  // ── Ler dados do usuário (injetados pelo middleware via headers) ──
  const user = await getServerUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <AuthProvider initialUser={user}>
      <div className="flex min-h-screen bg-stone-100/50">
        {/* ── Sidebar fixa ── */}
        <Sidebar />

        {/* ── Área principal (offset da sidebar) ── */}
        <div className="ml-64 flex flex-1 flex-col">
          {/* ── Topbar sticky ── */}
          <Topbar />

          {/* ── Conteúdo da página ── */}
          <main className="flex-1 p-6">
            <div className="mx-auto max-w-7xl">{children}</div>
          </main>

          {/* ── Footer ── */}
          <footer className="border-t border-stone-200 bg-white px-6 py-3">
            <p className="text-center text-xs text-stone-400">
              Ideal Camas &copy; {new Date().getFullYear()} — Painel
              Administrativo
            </p>
          </footer>
        </div>
      </div>
    </AuthProvider>
  );
}
