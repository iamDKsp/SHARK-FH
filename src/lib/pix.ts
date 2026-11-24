/**
 * Utilitários puros para normalização e validação de chaves Pix
 * (compatível com servidor e cliente).
 */

export type PixTipoChave = "CNPJ" | "CPF" | "EMAIL" | "PHONE" | "EVP";

export const PIX_TIPOS: { id: PixTipoChave; label: string; exemplo: string }[] = [
  { id: "CNPJ", label: "CNPJ", exemplo: "54.240.232/0001-46" },
  { id: "CPF", label: "CPF", exemplo: "123.456.789-00" },
  { id: "PHONE", label: "Telefone", exemplo: "(11) 99999-8888" },
  { id: "EMAIL", label: "E-mail", exemplo: "financeiro@empresa.com" },
  { id: "EVP", label: "Chave aleatória (EVP)", exemplo: "123e4567-e89b-12d3-a456-426614174000" },
];

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMAIL_RE = /[^\s()<>]+@[^\s()<>]+\.[^\s()<>]+/;

/** Remove anotações entre parênteses usadas no campo antigo, ex.: "(Banco Santander)". */
function semParenteses(valor: string): string {
  return (valor || "").replace(/\([^)]*\)/g, " ").trim();
}

export function ehTipoChavePix(valor: unknown): valor is PixTipoChave {
  return valor === "CNPJ" || valor === "CPF" || valor === "EMAIL" || valor === "PHONE" || valor === "EVP";
}

/** Detecta automaticamente o tipo de chave Pix a partir de um texto livre. */
export function detectarTipoChavePix(bruto: string): PixTipoChave {
  const limpo = semParenteses(bruto);
  if (EMAIL_RE.test(limpo)) return "EMAIL";
  if (UUID_RE.test(limpo)) return "EVP";

  const digitos = limpo.replace(/\D/g, "");
  if (digitos.length === 14) return "CNPJ";
  if (limpo.startsWith("+") || digitos.length === 12 || digitos.length === 13 || digitos.length === 10) {
    return "PHONE";
  }
  if (digitos.length === 11) {
    // Heurística: 11 dígitos com formato de CPF (pontos/traço) => CPF; caso contrário, se parecer celular com 9 => PHONE
    if (/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(limpo)) return "CPF";
    if (/^[1-9]{2}9\d{8}$/.test(digitos)) return "PHONE";
    return "CPF";
  }
  return "CNPJ";
}

export interface ChavePixLimpa {
  key: string;
  keyType: PixTipoChave;
}

/**
 * Extrai e normaliza a chave Pix no formato exigido pelo protocolo
 * `payment_info` / `pix_static_code` do WhatsApp.
 */
export function limparChavePix(bruto: string, tipoInformado?: PixTipoChave | string): ChavePixLimpa | null {
  const limpo = semParenteses(bruto);
  if (!limpo) return null;

  const keyType: PixTipoChave = ehTipoChavePix(tipoInformado) ? tipoInformado : detectarTipoChavePix(limpo);

  if (keyType === "EMAIL") {
    const m = limpo.match(EMAIL_RE);
    return m ? { key: m[0].trim().toLowerCase(), keyType } : null;
  }

  if (keyType === "EVP") {
    const m = limpo.match(UUID_RE);
    return m ? { key: m[0].trim().toLowerCase(), keyType } : null;
  }

  const digitos = limpo.replace(/\D/g, "");
  if (keyType === "CNPJ") {
    return digitos.length === 14 ? { key: digitos, keyType } : null;
  }

  if (keyType === "CPF") {
    return digitos.length === 11 ? { key: digitos, keyType } : null;
  }

  // PHONE — formato E.164 (+55...)
  if (digitos.length === 10 || digitos.length === 11) {
    return { key: `+55${digitos}`, keyType };
  }
  if (digitos.length >= 12 && digitos.length <= 15) {
    return { key: `+${digitos}`, keyType };
  }
  return null;
}

/** Formata a chave Pix para exibição humana na pré-visualização. */
export function formatarChavePixExibicao(key: string, keyType: PixTipoChave): string {
  if (keyType === "CNPJ" && key.length === 14) {
    return key.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (keyType === "CPF" && key.length === 11) {
    return key.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return key;
}
