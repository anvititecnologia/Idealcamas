// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Admin Topbar
// ──────────────────────────────────────────────────────────────────────────────
// Barra superior do painel administrativo.
// Mostra breadcrumbs dinâmicos e ações rápidas.
// ──────────────────────────────────────────────────────────────────────────────

"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Bell, Search, ChevronRight, Home } from "lucide-react";

// ┌──────────────────────────────────────────────────────────────────────┐
// │  MAPA DE LABELS PARA BREADCRUMBS                                   │
// └──────────────────────────────────────────────────────────────────────┘

const ROUTE_LABELS: Record<string, string> = {
  admin: "Admin",
  dashboard: "Dashboard",
  products: "Produtos",
  materials: "Materiais",
  components: "Componentes",
  uploads: "Uploads 3D",
  quotes: "Orçamentos",
  reports: "Relatórios",
  users: "Usuários",
  audit: "Auditoria",
  settings: "Configurações",
  new: "Novo",
  edit: "Editar",
};

// ┌──────────────────────────────────────────────────────────────────────┐
// │  COMPONENTE                                                         │
// └──────────────────────────────────────────────────────────────────────┘

export function Topbar() {
  const pathname = usePathname();

  // Gerar breadcrumbs a partir do pathname
  const segments = pathname.split("/").filter(Boolean);
  const breadcrumbs = segments.map((segment, index) => {
    const href = "/" + segments.slice(0, index + 1).join("/");
    const label = ROUTE_LABELS[segment] || segment;
    const isLast = index === segments.length - 1;

    return { label, href, isLast };
  });

  // Título da página = último segmento
  const pageTitle =
    breadcrumbs.length > 0
      ? breadcrumbs[breadcrumbs.length - 1].label
      : "Dashboard";

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-stone-200 bg-white/80 px-6 backdrop-blur-md">
      {/* ── Lado Esquerdo: Breadcrumbs ── */}
      <div className="flex flex-col">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 text-xs text-stone-400">
          <Link
            href="/admin/dashboard"
            className="flex items-center transition-colors hover:text-stone-600"
          >
            <Home className="h-3.5 w-3.5" />
          </Link>

          {breadcrumbs.slice(1).map((crumb) => (
            <span key={crumb.href} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-stone-300" />
              {crumb.isLast ? (
                <span className="font-medium text-stone-600">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="transition-colors hover:text-stone-600"
                >
                  {crumb.label}
                </Link>
              )}
            </span>
          ))}
        </nav>

        {/* Título da Página */}
        <h2 className="text-lg font-semibold tracking-tight text-stone-800">
          {pageTitle}
        </h2>
      </div>

      {/* ── Lado Direito: Ações ── */}
      <div className="flex items-center gap-2">
        {/* Busca Rápida */}
        <button
          className="flex h-9 items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 text-sm text-stone-400 transition-all duration-200 hover:border-stone-300 hover:bg-white hover:text-stone-600"
          title="Buscar (Ctrl+K)"
        >
          <Search className="h-4 w-4" />
          <span className="hidden md:inline">Buscar...</span>
          <kbd className="hidden rounded bg-stone-200/80 px-1.5 py-0.5 text-[10px] font-semibold text-stone-500 md:inline">
            ⌘K
          </kbd>
        </button>

        {/* Notificações */}
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-stone-400 transition-all duration-200 hover:border-stone-300 hover:bg-white hover:text-stone-600"
          title="Notificações"
        >
          <Bell className="h-4 w-4" />
          {/* Indicador de notificação */}
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white" />
        </button>
      </div>
    </header>
  );
}
