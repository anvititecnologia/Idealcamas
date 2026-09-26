// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Admin Sidebar
// ──────────────────────────────────────────────────────────────────────────────
// Navegação lateral do backoffice com paleta terrosa/neutra.
// Respeita RBAC: itens restritos são ocultados automaticamente.
// ──────────────────────────────────────────────────────────────────────────────

"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth, type UserRole } from "@admin/contexts/AuthContext";
import {
  LayoutDashboard,
  Package,
  Palette,
  Puzzle,
  FileUp,
  FileText,
  BarChart3,
  Settings,
  Users,
  ClipboardList,
  LogOut,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

// ┌──────────────────────────────────────────────────────────────────────┐
// │  TIPOS                                                              │
// └──────────────────────────────────────────────────────────────────────┘

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[]; // Quais roles podem ver este item
  badge?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  NAVEGAÇÃO                                                          │
// └──────────────────────────────────────────────────────────────────────┘

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Geral",
    items: [
      {
        label: "Dashboard",
        href: "/admin/dashboard",
        icon: LayoutDashboard,
        roles: ["FABRICANTE", "VENDEDOR"],
      },
      {
        label: "Orçamentos",
        href: "/admin/quotes",
        icon: FileText,
        roles: ["FABRICANTE", "VENDEDOR"],
      },
      {
        label: "Relatórios",
        href: "/admin/reports",
        icon: BarChart3,
        roles: ["FABRICANTE", "VENDEDOR"],
      },
    ],
  },
  {
    title: "Catálogo",
    items: [
      {
        label: "Produtos",
        href: "/admin/products",
        icon: Package,
        roles: ["FABRICANTE"],
      },
      {
        label: "Materiais",
        href: "/admin/materials",
        icon: Palette,
        roles: ["FABRICANTE"],
      },
      {
        label: "Componentes",
        href: "/admin/components",
        icon: Puzzle,
        roles: ["FABRICANTE"],
      },
      {
        label: "Uploads 3D",
        href: "/admin/uploads",
        icon: FileUp,
        roles: ["FABRICANTE"],
      },
    ],
  },
  {
    title: "Sistema",
    items: [
      {
        label: "Usuários",
        href: "/admin/users",
        icon: Users,
        roles: ["FABRICANTE"],
      },
      {
        label: "Auditoria",
        href: "/admin/audit",
        icon: ClipboardList,
        roles: ["FABRICANTE"],
      },
      {
        label: "Configurações",
        href: "/admin/settings",
        icon: Settings,
        roles: ["FABRICANTE"],
      },
    ],
  },
];

// ┌──────────────────────────────────────────────────────────────────────┐
// │  COMPONENTE                                                         │
// └──────────────────────────────────────────────────────────────────────┘

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout, isFabricante } = useAuth();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-stone-200 bg-stone-50">
      {/* ── Logo ── */}
      <div className="flex h-16 items-center gap-3 border-b border-stone-200 px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-800 shadow-sm">
          <span className="text-sm font-bold text-amber-50">IC</span>
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-stone-800">
            Ideal Camas
          </h1>
          <p className="text-[10px] font-medium uppercase tracking-widest text-stone-400">
            Backoffice
          </p>
        </div>
      </div>

      {/* ── Navegação ── */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4 scrollbar-thin">
        {NAV_GROUPS.map((group) => {
          // Filtrar itens por RBAC
          const visibleItems = group.items.filter((item) =>
            user ? item.roles.includes(user.role) : false
          );

          if (visibleItems.length === 0) return null;

          return (
            <div key={group.title}>
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
                {group.title}
              </p>
              <ul className="space-y-0.5">
                {visibleItems.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(item.href + "/");

                  const Icon = item.icon;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`
                          group flex items-center gap-3 rounded-lg px-3 py-2.5
                          text-sm font-medium transition-all duration-200
                          ${
                            isActive
                              ? "bg-amber-800/10 text-amber-900 shadow-sm"
                              : "text-stone-600 hover:bg-stone-100 hover:text-stone-800"
                          }
                        `}
                      >
                        <Icon
                          className={`h-[18px] w-[18px] flex-shrink-0 transition-colors ${
                            isActive
                              ? "text-amber-800"
                              : "text-stone-400 group-hover:text-stone-600"
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                        {item.badge && (
                          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* ── Rodapé: Usuário + Logout ── */}
      <div className="border-t border-stone-200 p-3">
        {/* Badge de role */}
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-stone-100 px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-800/15">
            <ShieldCheck className="h-4 w-4 text-amber-800" />
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-xs font-semibold text-stone-700">
              {user?.name || "Usuário"}
            </p>
            <p className="truncate text-[10px] text-stone-400">
              {isFabricante ? "Fabricante" : "Vendedor"}
            </p>
          </div>
        </div>

        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-stone-500 transition-all duration-200 hover:bg-red-50 hover:text-red-700"
        >
          <LogOut className="h-[18px] w-[18px]" />
          <span>Sair</span>
        </button>
      </div>
    </aside>
  );
}
