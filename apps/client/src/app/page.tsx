// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Home Page (Catálogo 3D + Personalização + Checkout)
// ──────────────────────────────────────────────────────────────────────────────
// Entrypoint do cliente. Monta:
//   1. CartProvider (estado global do orçamento)
//   2. ModelViewer 3D (personalização visual)
//   3. Painel de configurações (dimensões, materiais, componentes)
//   4. Checkout seguro → WhatsApp com Hash
// ──────────────────────────────────────────────────────────────────────────────

"use client";

import { useState, useCallback, useEffect } from "react";
import { CartProvider, useCartStore } from "../store/CartStore";
import { ModelViewer } from "../components/ModelViewer";

// ┌──────────────────────────────────────────────────────────────────────┐
// │  TIPOS AUXILIARES                                                    │
// └──────────────────────────────────────────────────────────────────────┘

interface MaterialOption {
  id: string;
  name: string;
  color: string;
  label: string;
}

interface ComponentOption {
  id: string;
  name: string;
  label: string;
  description: string;
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  CATÁLOGO MOCK (será substituído por dados reais da API)            │
// └──────────────────────────────────────────────────────────────────────┘

const DEMO_MODEL_URL = "/models/sofa-demo.glb";

const MATERIAL_OPTIONS: MaterialOption[] = [
  { id: "mat-linho-cru", name: "Linho Cru", color: "#d4c5a9", label: "Linho Cru" },
  { id: "mat-veludo-grafite", name: "Veludo Grafite", color: "#4a4a4a", label: "Veludo Grafite" },
  { id: "mat-suede-terracota", name: "Suede Terracota", color: "#c4724e", label: "Suede Terracota" },
  { id: "mat-couro-cognac", name: "Couro Cognac", color: "#8b5a2b", label: "Couro Cognac" },
  { id: "mat-algodao-marfim", name: "Algodão Marfim", color: "#f5f0e1", label: "Algodão Marfim" },
];

const COMPONENT_OPTIONS: ComponentOption[] = [
  { id: "comp-braco-madeira", name: "Braço de Madeira", label: "Braço Madeira", description: "Apoio de braço em madeira maciça" },
  { id: "comp-pes-metal", name: "Pés Metálicos", label: "Pés Metal", description: "Pés em aço escovado" },
  { id: "comp-almofada-extra", name: "Almofada Extra", label: "Almofada Extra", description: "Almofada decorativa avulsa" },
];

// ┌──────────────────────────────────────────────────────────────────────┐
// │  COMPONENTE INTERNO — Conteúdo Principal                            │
// │  (deve ser filho de CartProvider para acessar o contexto)           │
// └──────────────────────────────────────────────────────────────────────┘

function HomeContent() {
  const cart = useCartStore();
  const [cepInput, setCepInput] = useState("");

  // ── Inicializar produto na montagem (após o DOM estar pronto) ──
  useEffect(() => {
    cart.setProduct("prod-sofa-01", "Sofá Modular Premium", "sofa-modular-premium", 189900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Material overrides para o ModelViewer 3D ──
  const materialOverrides = cart.selectedMaterials.length > 0
    ? {
      "sofa-body": {
        color: MATERIAL_OPTIONS.find((m) => m.id === cart.selectedMaterials[0]?.id)?.color || "#d4c5a9",
      },
    }
    : undefined;

  // ── CEP handler ──
  const handleCepChange = useCallback(
    (value: string) => {
      const digits = value.replace(/\D/g, "").slice(0, 8);
      const formatted = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
      setCepInput(formatted);
      cart.setCustomerCep(digits);
    },
    [cart]
  );

  // ── Checkout handler ──
  const handleCheckout = useCallback(async () => {
    const result = await cart.submitCheckout();
    if (result) {
      window.open(result.whatsAppUrl, "_blank", "noopener,noreferrer");
    }
  }, [cart]);

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      {/* ── HEADER ── */}
      <header className="sticky top-0 z-50 border-b border-stone-200 bg-white/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-700 text-sm font-bold text-white">
              IC
            </div>
            <span className="text-lg font-semibold text-stone-800">Ideal Camas</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm font-medium text-stone-600 md:flex">
            <a href="#catalogo" className="transition-colors hover:text-amber-700">Catálogo</a>
            <a href="#personalizar" className="transition-colors hover:text-amber-700">Personalizar</a>
            <a href="#orcamento" className="transition-colors hover:text-amber-700">Orçamento</a>
          </nav>
        </div>
      </header>

      {/* ── HERO / MODELO 3D ── */}
      <section id="catalogo" className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-stone-800 md:text-4xl">
            {cart.productName || "Sofá Modular Premium"}
          </h1>
          <p className="mt-2 text-stone-500">
            Configure cada detalhe em 3D. Arraste para girar, scroll para aproximar.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <ModelViewer
            modelUrl={DEMO_MODEL_URL}
            materialOverrides={materialOverrides}
            height={520}
            autoRotate
            showShadow
            backgroundColor="#faf8f5"
          />
        </div>
      </section>

      {/* ── PAINEL DE PERSONALIZAÇÃO ── */}
      <section id="personalizar" className="mx-auto w-full max-w-7xl px-6 pb-10">
        <div className="grid gap-8 lg:grid-cols-3">
          {/* ── DIMENSÕES ── */}
          <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-stone-800">
              <svg className="h-5 w-5 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
              Dimensões
            </h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="dim-width" className="mb-1 block text-sm font-medium text-stone-600">
                  Largura Total (cm)
                </label>
                <input
                  id="dim-width"
                  type="number"
                  min={120}
                  max={300}
                  step={5}
                  value={cart.dimensions.widthCm}
                  onChange={(e) => cart.setDimensions({ widthCm: Number(e.target.value) })}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-600/20"
                />
              </div>
              <div>
                <label htmlFor="dim-depth" className="mb-1 block text-sm font-medium text-stone-600">
                  Profundidade (cm)
                </label>
                <input
                  id="dim-depth"
                  type="number"
                  min={70}
                  max={120}
                  step={5}
                  value={cart.dimensions.depthCm}
                  onChange={(e) => cart.setDimensions({ depthCm: Number(e.target.value) })}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-600/20"
                />
              </div>
              <div>
                <label htmlFor="dim-height" className="mb-1 block text-sm font-medium text-stone-600">
                  Altura do Assento (cm)
                </label>
                <input
                  id="dim-height"
                  type="number"
                  min={35}
                  max={55}
                  step={1}
                  value={cart.dimensions.heightCm}
                  onChange={(e) => cart.setDimensions({ heightCm: Number(e.target.value) })}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-600/20"
                />
              </div>
            </div>
          </div>

          {/* ── MATERIAIS / TECIDOS ── */}
          <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-stone-800">
              <svg className="h-5 w-5 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" />
              </svg>
              Tecidos &amp; Materiais
            </h2>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {MATERIAL_OPTIONS.map((mat) => {
                const isSelected = cart.selectedMaterials.some((m) => m.id === mat.id);
                return (
                  <button
                    key={mat.id}
                    type="button"
                    onClick={() => cart.toggleMaterial({ id: mat.id, name: mat.name })}
                    className={`flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition-all ${isSelected
                        ? "border-amber-600 bg-amber-50 shadow-md"
                        : "border-stone-200 bg-stone-50 hover:border-stone-300"
                      }`}
                  >
                    <div
                      className="h-10 w-10 rounded-full border-2 border-white shadow-inner"
                      style={{ backgroundColor: mat.color }}
                    />
                    <span className="text-xs font-medium text-stone-700">{mat.label}</span>
                  </button>
                );
              })}
            </div>
            {cart.selectedMaterials.length === 0 && (
              <p className="mt-3 text-xs text-amber-700">⚠ Selecione ao menos um tecido</p>
            )}
          </div>

          {/* ── COMPONENTES ADICIONAIS ── */}
          <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-stone-800">
              <svg className="h-5 w-5 text-amber-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.384 3.175c-.474.28-1.066-.117-1.066-.658V5.655a1.5 1.5 0 011.342-1.492l6.375-.795a1.5 1.5 0 011.666 1.48v3.902m-6.917 9.42l2.59-1.527m0 0l5.384-3.176a1.5 1.5 0 000-2.582l-5.384-3.175a1.5 1.5 0 00-1.59 0L6.42 10.48" />
              </svg>
              Adicionais
            </h2>

            <div className="space-y-3">
              {COMPONENT_OPTIONS.map((comp) => {
                const isSelected = cart.selectedComponents.some((c) => c.id === comp.id);
                return (
                  <button
                    key={comp.id}
                    type="button"
                    onClick={() => cart.toggleComponent({ id: comp.id, name: comp.name })}
                    className={`flex w-full items-start gap-3 rounded-xl border-2 p-3 text-left transition-all ${isSelected
                        ? "border-amber-600 bg-amber-50"
                        : "border-stone-200 bg-stone-50 hover:border-stone-300"
                      }`}
                  >
                    <div
                      className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-colors ${isSelected ? "border-amber-600 bg-amber-600 text-white" : "border-stone-300"
                        }`}
                    >
                      {isSelected && (
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-stone-800">{comp.label}</p>
                      <p className="text-xs text-stone-500">{comp.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── CHECKOUT / ORÇAMENTO ── */}
      <section id="orcamento" className="mx-auto w-full max-w-7xl px-6 pb-16">
        <div className="rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
          <h2 className="mb-6 text-xl font-bold text-stone-800">Finalizar Orçamento</h2>

          <div className="grid gap-6 md:grid-cols-2">
            {/* ── Dados do Cliente ── */}
            <div className="space-y-4">
              <div>
                <label htmlFor="customer-name" className="mb-1 block text-sm font-medium text-stone-600">
                  Seu Nome
                </label>
                <input
                  id="customer-name"
                  type="text"
                  value={cart.customerName}
                  onChange={(e) => cart.setCustomerInfo(e.target.value, cart.customerPhone)}
                  placeholder="João Silva"
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-600/20"
                />
              </div>
              <div>
                <label htmlFor="customer-phone" className="mb-1 block text-sm font-medium text-stone-600">
                  Seu WhatsApp
                </label>
                <input
                  id="customer-phone"
                  type="tel"
                  value={cart.customerPhone}
                  onChange={(e) => cart.setCustomerInfo(cart.customerName, e.target.value)}
                  placeholder="(11) 99999-9999"
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-600/20"
                />
              </div>
              <div>
                <label htmlFor="customer-cep" className="mb-1 block text-sm font-medium text-stone-600">
                  CEP para Entrega
                </label>
                <input
                  id="customer-cep"
                  type="text"
                  value={cepInput}
                  onChange={(e) => handleCepChange(e.target.value)}
                  placeholder="01234-567"
                  maxLength={9}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-600/20"
                />
              </div>
            </div>

            {/* ── Resumo ── */}
            <div className="flex flex-col justify-between rounded-xl bg-stone-50 p-6">
              <div>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-stone-500">
                  Resumo da Configuração
                </h3>
                <ul className="space-y-2 text-sm text-stone-700">
                  <li className="flex justify-between">
                    <span>Dimensões</span>
                    <span className="font-medium">
                      {cart.dimensions.widthCm} × {cart.dimensions.depthCm} × {cart.dimensions.heightCm} cm
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>Tecido(s)</span>
                    <span className="font-medium">
                      {cart.selectedMaterials.map((m) => m.name).join(", ") || "—"}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>Adicionais</span>
                    <span className="font-medium">
                      {cart.selectedComponents.map((c) => c.name).join(", ") || "—"}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span>CEP</span>
                    <span className="font-medium">{cepInput || "—"}</span>
                  </li>
                </ul>
              </div>

              {/* ── Resultado do Checkout (quando retorna do servidor) ── */}
              {cart.checkoutResult && (
                <div className="mt-4 rounded-lg bg-green-50 p-4 text-sm">
                  <p className="font-bold text-green-800">
                    Código: {cart.checkoutResult.hashId}
                  </p>
                  <p className="text-green-700">
                    Subtotal: {cart.checkoutResult.subtotalFormatado}
                  </p>
                  <p className="text-green-700">
                    Frete: {cart.checkoutResult.freightFormatado}
                  </p>
                  <p className="mt-1 text-lg font-bold text-green-900">
                    Total: {cart.checkoutResult.totalFormatado}
                  </p>
                </div>
              )}

              {/* ── Mensagem de Erro ── */}
              {cart.errorMessage && (
                <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {cart.errorMessage}
                </div>
              )}
            </div>
          </div>

          {/* ── Botão de Ação ── */}
          <div className="mt-8 flex justify-end">
            <button
              type="button"
              onClick={handleCheckout}
              disabled={cart.checkoutStatus === "submitting"}
              className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-8 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:bg-green-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cart.checkoutStatus === "submitting" ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Processando...
                </>
              ) : (
                <>
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                  </svg>
                  Enviar Orçamento via WhatsApp
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="mt-auto border-t border-stone-200 bg-white py-6">
        <div className="mx-auto max-w-7xl px-6 text-center text-xs text-stone-400">
          © {new Date().getFullYear()} Ideal Camas. Todos os preços são calculados em servidor seguro e confirmados via código Hash.
        </div>
      </footer>
    </div>
  );
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  EXPORT DEFAULT — Envolve tudo no CartProvider                      │
// └──────────────────────────────────────────────────────────────────────┘

export default function Home() {
  return (
    <CartProvider>
      <HomeContent />
    </CartProvider>
  );
}
