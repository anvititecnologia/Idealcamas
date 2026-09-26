// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — WhatsAppRedirect (Utility)
// ──────────────────────────────────────────────────────────────────────────────
// Função Utilitária para Transição Segura ao WhatsApp do Vendedor.
//
// Regras de Negócio e Segurança:
//   1. O texto formatado DEVE conter obrigatoriamente o Hash do sistema (ex: ORD-9A8B7C).
//   2. Formato exigido:
//      "Olá! Montei um orçamento na Ideal Camas. Segue o código do meu projeto: ORD-9A8B7C. Valor total estimado (com frete): R$ X.XXX,XX."
//   3. Prevenção contra Engenharia Social:
//      - O vendedor utiliza o Hash no Painel Admin para puxar o orçamento real do banco.
//      - Alterações de valores, medidas ou tecidos feitas manualmente no chat do WhatsApp
//        serão desconsideradas, pois o contrato da venda se baseia no Hash salvo no banco.
// ──────────────────────────────────────────────────────────────────────────────

export interface WhatsAppRedirectOptions {
  /** Número do WhatsApp do vendedor ou central (ex: "5511999999999") */
  sellerPhone: string;
  /** Hash do pedido gerado pelo servidor (ex: "ORD-9A8B7C") */
  hashId: string;
  /** Valor total estimado já formatado (ex: "R$ 1.850,00") */
  totalFormatado: string;
  /** Nome do cliente (opcional) */
  customerName?: string;
  /** Mensagem customizada adicional (opcional) */
  customMessage?: string;
}

/**
 * Normaliza o número de telefone removendo caracteres não numéricos.
 * Garante o código de país 55 (Brasil) caso não esteja presente.
 */
export function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

/**
 * Formata a mensagem oficial em conformidade com o formato exigido.
 *
 * Exemplo de saída:
 * "Olá! Montei um orçamento na Ideal Camas. Segue o código do meu projeto: ORD-9A8B7C. Valor total estimado (com frete): R$ 1.850,00."
 */
export function formatWhatsAppMessage(options: WhatsAppRedirectOptions): string {
  const { hashId, totalFormatado, customerName } = options;

  const greeting = customerName ? `Olá! Me chamo ${customerName.trim()}.` : "Olá!";

  const message = `${greeting} Montei um orçamento na Ideal Camas. Segue o código do meu projeto: ${hashId}. Valor total estimado (com frete): ${totalFormatado}.`;

  return message;
}

/**
 * Gera a URL dinâmica completa para a API do WhatsApp (wa.me ou api.whatsapp.com).
 *
 * Utiliza encodeURIComponent para garantir suporte a acentos, espaços e quebras de linha.
 */
export function formatWhatsAppRedirectUrl(options: WhatsAppRedirectOptions): string {
  const phone = normalizePhoneNumber(options.sellerPhone);
  const text = formatWhatsAppMessage(options);
  const encodedText = encodeURIComponent(text);

  return `https://api.whatsapp.com/send?phone=${phone}&text=${encodedText}`;
}

/**
 * Executa o redirecionamento direto abrindo o WhatsApp em uma nova aba do navegador.
 *
 * @param options Parâmetros para formatação da mensagem e número do vendedor.
 * @param openInNewTab Se true (padrão), abre em window.open; caso contrário, altera window.location.href.
 */
export function redirectToWhatsApp(
  options: WhatsAppRedirectOptions,
  openInNewTab = true
): void {
  const url = formatWhatsAppRedirectUrl(options);

  if (typeof window !== "undefined") {
    if (openInNewTab) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = url;
    }
  }
}
