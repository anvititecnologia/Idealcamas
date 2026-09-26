// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Admin Dashboard Page
// ──────────────────────────────────────────────────────────────────────────────
// Página inicial do painel Admin com KPIs e resumos.
// ──────────────────────────────────────────────────────────────────────────────

import {
  Package,
  FileText,
  TrendingUp,
  Users,
} from "lucide-react";

// ── KPI Cards placeholder (dados virão da API na Fase 3) ──
const STATS = [
  {
    label: "Produtos Ativos",
    value: "—",
    change: "",
    icon: Package,
    color: "bg-amber-800/10 text-amber-800",
  },
  {
    label: "Orçamentos Hoje",
    value: "—",
    change: "",
    icon: FileText,
    color: "bg-emerald-700/10 text-emerald-700",
  },
  {
    label: "Receita Estimada",
    value: "—",
    change: "",
    icon: TrendingUp,
    color: "bg-blue-700/10 text-blue-700",
  },
  {
    label: "Vendedores Ativos",
    value: "—",
    change: "",
    icon: Users,
    color: "bg-stone-600/10 text-stone-600",
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="group rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-stone-400">
                    {stat.label}
                  </p>
                  <p className="mt-2 text-2xl font-bold text-stone-800">
                    {stat.value}
                  </p>
                  {stat.change && (
                    <p className="mt-1 text-xs font-medium text-emerald-600">
                      {stat.change}
                    </p>
                  )}
                </div>
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${stat.color}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Placeholder: Últimos Orçamentos & Atividade ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-stone-700">
            Últimos Orçamentos
          </h3>
          <div className="mt-4 flex h-48 items-center justify-center rounded-lg border-2 border-dashed border-stone-200">
            <p className="text-sm text-stone-400">
              Dados serão exibidos após integração com a API
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-stone-700">
            Atividade Recente
          </h3>
          <div className="mt-4 flex h-48 items-center justify-center rounded-lg border-2 border-dashed border-stone-200">
            <p className="text-sm text-stone-400">
              Audit trail será exibido aqui
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
