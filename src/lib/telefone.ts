/**
 * Utilitários compartilhados (cliente e servidor) para normalização e
 * comparação de telefones brasileiros na prevenção de clientes duplicados.
 */

/**
 * Mantém apenas dígitos e remove DDI +55 (quando 12 ou 13 dígitos) e
 * zero inicial de DDD (quando 11 ou 12 dígitos).
 */
export function normalizarTelefone(raw: string | null | undefined): string {
  let digits = (raw || "").replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  if ((digits.length === 11 || digits.length === 12) && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits;
}

/**
 * Gera chave canônica para comparação de duplicidade por telefone.
 * Trata o 9º dígito opcional em celulares BR (ex.: 14998042724 == 1498042724).
 * Retorna "" se o número tiver menos de 8 dígitos válidos.
 */
export function chaveComparacaoTelefone(raw: string | null | undefined): string {
  const digits = normalizarTelefone(raw);
  if (digits.length < 8) return "";
  if (digits.length === 11 && digits[2] === "9") {
    return digits.slice(0, 2) + digits.slice(3);
  }
  return digits;
}

/**
 * Compara dois telefones levando em conta formatação, DDI +55, zero de DDD
 * e 9º dígito opcional de celular.
 */
export function telefonesIguais(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const ka = chaveComparacaoTelefone(a);
  const kb = chaveComparacaoTelefone(b);
  return ka.length >= 8 && ka === kb;
}
