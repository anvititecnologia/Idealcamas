// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — CartStore (Client-Side State Management)
// ──────────────────────────────────────────────────────────────────────────────
// Gerenciamento de Estado do Carrinho & Personalizações Paramétricas 3D.
//
// Recursos:
//   ✔ Armazena as escolhas paramétricas do usuário no ModelViewer 3D na memória
//   ✔ Suporta React Context / Custom Hook (Zustand-like pattern sem dependências extras)
//   ✔ Comunicação com a API de Checkout (/api/checkout/create)
//   ✔ Integração com a função utilitária WhatsAppRedirect
// ──────────────────────────────────────────────────────────────────────────────

"use client";

import { useState, useCallback, useMemo, createContext, useContext, ReactNode } from "react";
import { formatWhatsAppRedirectUrl } from "../utils/WhatsAppRedirect";

// ┌──────────────────────────────────────────────────────────────────────┐
// │  TIPOS                                                              │
// └──────────────────────────────────────────────────────────────────────┘

export interface DimensionsState {
  widthCm: number;
  depthCm: number;
  heightCm: number;
}

export interface MaterialSelection {
  id: string;
  name: string;
}

export interface ComponentSelection {
  id: string;
  name: string;
}

export interface CheckoutResult {
  hashId: string;
  totalCents: number;
  totalFormatado: string;
  freightCents: number;
  freightFormatado: string;
  subtotalCents: number;
  subtotalFormatado: string;
  status: string;
  whatsAppUrl: string;
}

export type CheckoutStatus = "idle" | "submitting" | "success" | "error";

export interface CartStoreState {
  // Produto Base
  productId: string | null;
  productName: string | null;
  productSlug: string | null;
  basePriceCents: number;

  // Medidas Paramétricas
  dimensions: DimensionsState;

  // Personalizações
  selectedMaterials: MaterialSelection[];
  selectedComponents: ComponentSelection[];

  // Entrega
  customerCep: string;
  customerName: string;
  customerPhone: string;

  // Estado do Checkout
  checkoutStatus: CheckoutStatus;
  checkoutResult: CheckoutResult | null;
  errorMessage: string | null;

  // Ações
  setProduct: (id: string, name: string, slug: string, basePriceCents: number) => void;
  setDimensions: (dimensions: Partial<DimensionsState>) => void;
  setMaterials: (materials: MaterialSelection[]) => void;
  toggleMaterial: (material: MaterialSelection) => void;
  setComponents: (components: ComponentSelection[]) => void;
  toggleComponent: (component: ComponentSelection) => void;
  setCustomerCep: (cep: string) => void;
  setCustomerInfo: (name: string, phone: string) => void;
  resetCart: () => void;
  submitCheckout: (apiUrl?: string, sellerPhone?: string) => Promise<CheckoutResult | null>;
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  ESTADO INICIAL                                                     │
// └──────────────────────────────────────────────────────────────────────┘

const DEFAULT_DIMENSIONS: DimensionsState = {
  widthCm: 140,
  depthCm: 90,
  heightCm: 85,
};

const INITIAL_STATE = {
  productId: null,
  productName: null,
  productSlug: null,
  basePriceCents: 0,
  dimensions: DEFAULT_DIMENSIONS,
  selectedMaterials: [],
  selectedComponents: [],
  customerCep: "",
  customerName: "",
  customerPhone: "",
  checkoutStatus: "idle" as CheckoutStatus,
  checkoutResult: null,
  errorMessage: null,
};

// ┌──────────────────────────────────────────────────────────────────────┐
// │  HOOK CUSTOMIZADO DE GERENCIAMENTO DE ESTADO                        │
// └──────────────────────────────────────────────────────────────────────┘

export function useCartStoreState(): CartStoreState {
  const [productId, setProductId] = useState<string | null>(INITIAL_STATE.productId);
  const [productName, setProductName] = useState<string | null>(INITIAL_STATE.productName);
  const [productSlug, setProductSlug] = useState<string | null>(INITIAL_STATE.productSlug);
  const [basePriceCents, setBasePriceCents] = useState<number>(INITIAL_STATE.basePriceCents);

  const [dimensions, setDimensionsState] = useState<DimensionsState>(INITIAL_STATE.dimensions);
  const [selectedMaterials, setSelectedMaterials] = useState<MaterialSelection[]>(INITIAL_STATE.selectedMaterials);
  const [selectedComponents, setSelectedComponents] = useState<ComponentSelection[]>(INITIAL_STATE.selectedComponents);

  const [customerCep, setCustomerCep] = useState<string>(INITIAL_STATE.customerCep);
  const [customerName, setCustomerName] = useState<string>(INITIAL_STATE.customerName);
  const [customerPhone, setCustomerPhone] = useState<string>(INITIAL_STATE.customerPhone);

  const [checkoutStatus, setCheckoutStatus] = useState<CheckoutStatus>(INITIAL_STATE.checkoutStatus);
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(INITIAL_STATE.checkoutResult);
  const [errorMessage, setErrorMessage] = useState<string | null>(INITIAL_STATE.errorMessage);

  // ── Ações ──

  const setProduct = useCallback((id: string, name: string, slug: string, priceCents: number) => {
    setProductId(id);
    setProductName(name);
    setProductSlug(slug);
    setBasePriceCents(priceCents);
  }, []);

  const setDimensions = useCallback((partial: Partial<DimensionsState>) => {
    setDimensionsState((prev) => ({ ...prev, ...partial }));
  }, []);

  const setMaterials = useCallback((materials: MaterialSelection[]) => {
    setSelectedMaterials(materials);
  }, []);

  const toggleMaterial = useCallback((material: MaterialSelection) => {
    setSelectedMaterials((prev) => {
      const exists = prev.some((m) => m.id === material.id);
      return exists ? prev.filter((m) => m.id !== material.id) : [...prev, material];
    });
  }, []);

  const setComponents = useCallback((components: ComponentSelection[]) => {
    setSelectedComponents(components);
  }, []);

  const toggleComponent = useCallback((component: ComponentSelection) => {
    setSelectedComponents((prev) => {
      const exists = prev.some((c) => c.id === component.id);
      return exists ? prev.filter((c) => c.id !== component.id) : [...prev, component];
    });
  }, []);

  const setCustomerInfo = useCallback((name: string, phone: string) => {
    setCustomerName(name);
    setCustomerPhone(phone);
  }, []);

  const resetCart = useCallback(() => {
    setProductId(INITIAL_STATE.productId);
    setProductName(INITIAL_STATE.productName);
    setProductSlug(INITIAL_STATE.productSlug);
    setBasePriceCents(INITIAL_STATE.basePriceCents);
    setDimensionsState(INITIAL_STATE.dimensions);
    setSelectedMaterials(INITIAL_STATE.selectedMaterials);
    setSelectedComponents(INITIAL_STATE.selectedComponents);
    setCustomerCep(INITIAL_STATE.customerCep);
    setCustomerName(INITIAL_STATE.customerName);
    setCustomerPhone(INITIAL_STATE.customerPhone);
    setCheckoutStatus(INITIAL_STATE.checkoutStatus);
    setCheckoutResult(INITIAL_STATE.checkoutResult);
    setErrorMessage(INITIAL_STATE.errorMessage);
  }, []);

  /**
   * Finaliza o Orçamento no servidor e gera a URL dinâmica do WhatsApp
   */
  const submitCheckout = useCallback(
    async (
      apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
      sellerPhone = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "5511999999999"
    ): Promise<CheckoutResult | null> => {
      if (!productId) {
        setErrorMessage("Nenhum produto selecionado para orçamento.");
        setCheckoutStatus("error");
        return null;
      }

      if (!customerCep || customerCep.replace(/\D/g, "").length !== 8) {
        setErrorMessage("Informe um CEP válido com 8 dígitos.");
        setCheckoutStatus("error");
        return null;
      }

      if (selectedMaterials.length === 0) {
        setErrorMessage("Selecione ao menos um tecido ou material.");
        setCheckoutStatus("error");
        return null;
      }

      setCheckoutStatus("submitting");
      setErrorMessage(null);

      try {
        // Enviar payload limpo para o checkout.controller.ts
        const response = await fetch(`${apiUrl}/api/checkout/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId,
            widthCm: dimensions.widthCm,
            depthCm: dimensions.depthCm,
            heightCm: dimensions.heightCm,
            materialIds: selectedMaterials.map((m) => m.id),
            componentIds: selectedComponents.map((c) => c.id),
            customerCep,
            customerName: customerName || undefined,
            customerPhone: customerPhone || undefined,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || "Falha ao processar orçamento no servidor.");
        }

        const data = await response.json();

        // Formatar link dinâmico para transição segura ao WhatsApp
        const whatsAppUrl = formatWhatsAppRedirectUrl({
          sellerPhone,
          hashId: data.hashId,
          totalFormatado: data.totalFormatado,
          customerName,
        });

        const result: CheckoutResult = {
          hashId: data.hashId,
          totalCents: data.totalCents,
          totalFormatado: data.totalFormatado,
          freightCents: data.freightCents,
          freightFormatado: data.freightFormatado,
          subtotalCents: data.subtotalCents,
          subtotalFormatado: data.subtotalFormatado,
          status: data.status,
          whatsAppUrl,
        };

        setCheckoutResult(result);
        setCheckoutStatus("success");
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro inesperado no checkout.";
        setErrorMessage(msg);
        setCheckoutStatus("error");
        return null;
      }
    },
    [
      productId,
      dimensions,
      selectedMaterials,
      selectedComponents,
      customerCep,
      customerName,
      customerPhone,
    ]
  );

  return useMemo(
    () => ({
      productId,
      productName,
      productSlug,
      basePriceCents,
      dimensions,
      selectedMaterials,
      selectedComponents,
      customerCep,
      customerName,
      customerPhone,
      checkoutStatus,
      checkoutResult,
      errorMessage,
      setProduct,
      setDimensions,
      setMaterials,
      toggleMaterial,
      setComponents,
      toggleComponent,
      setCustomerCep,
      setCustomerInfo,
      resetCart,
      submitCheckout,
    }),
    [
      productId,
      productName,
      productSlug,
      basePriceCents,
      dimensions,
      selectedMaterials,
      selectedComponents,
      customerCep,
      customerName,
      customerPhone,
      checkoutStatus,
      checkoutResult,
      errorMessage,
      setProduct,
      setDimensions,
      setMaterials,
      toggleMaterial,
      setComponents,
      toggleComponent,
      setCustomerCep,
      setCustomerInfo,
      resetCart,
      submitCheckout,
    ]
  );
}

// ┌──────────────────────────────────────────────────────────────────────┐
// │  REACT CONTEXT PROVIDER (Para compartilhar estado globalmente)       │
// └──────────────────────────────────────────────────────────────────────┘

const CartStoreContext = createContext<CartStoreState | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const store = useCartStoreState();
  return <CartStoreContext.Provider value={store}> {children} </CartStoreContext.Provider>;
}

export function useCartStore(): CartStoreState {
  const context = useContext(CartStoreContext);
  if (!context) {
    throw new Error("useCartStore deve ser usado dentro de um CartProvider");
  }
  return context;
}
