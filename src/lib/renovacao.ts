/**
 * Utilitários puros para cálculo de datas e rótulos de renovação de empréstimos.
 * Funciona igualmente em Server Actions, Client Components e modo offline.
 */

export type FrequenciaRenovacao = "diario" | "semanal" | "quinzenal" | "mensal";

const FREQUENCIAS_VALIDAS = new Set<string>(["diario", "semanal", "quinzenal", "mensal"]);

export function normalizarFrequencia(freq?: string | null): FrequenciaRenovacao {
  const f = (freq ?? "").trim().toLowerCase();
  return FREQUENCIAS_VALIDAS.has(f) ? (f as FrequenciaRenovacao) : "mensal";
}

export function isFrequenciaValida(freq?: string | null): freq is FrequenciaRenovacao {
  return Boolean(freq && FREQUENCIAS_VALIDAS.has(freq.trim().toLowerCase()));
}

/** Converte Date ou string ISO em "YYYY-MM-DD" usando componentes UTC (evita shift de fuso). */
export function toIsoDateUTC(d: Date | string): string {
  if (typeof d === "string") {
    const match = d.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Faz parse estrito de "YYYY-MM-DD" para meia-noite UTC. Retorna null se inválida. */
export function parseIsoDateUTC(iso?: string | null): Date | null {
  if (!iso || typeof iso !== "string") return null;
  const trimmed = iso.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

/** Formata Date ou "YYYY-MM-DD" como "DD/MM/YYYY" em UTC. */
export function formatarDataBR(d: Date | string | null | undefined): string {
  if (!d) return "";
  const iso = toIsoDateUTC(d);
  if (!iso) return "";
  const [y, m, day] = iso.split("-");
  return `${day}/${m}/${y}`;
}

/** Soma N dias a uma data em UTC. */
export function addDiasUTC(base: Date | string, dias: number): Date {
  const iso = toIsoDateUTC(base);
  const dt = parseIsoDateUTC(iso) ?? new Date(base);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + dias));
}

/** Soma 1 mês em UTC, travando no último dia do mês alvo (ex: 31/01 -> 28/02). */
export function addMesUTC(base: Date | string, diaBase?: number | null): Date {
  const iso = toIsoDateUTC(base);
  const dt = parseIsoDateUTC(iso) ?? new Date(base);
  const currentYear = dt.getUTCFullYear();
  const currentMonth = dt.getUTCMonth();
  let nextYear = currentYear;
  let nextMonth = currentMonth + 1;
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear += 1;
  }
  const alvoDia =
    diaBase && diaBase >= 1 && diaBase <= 31 ? diaBase : dt.getUTCDate();
  const diasNoMes = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  const finalDay = Math.min(alvoDia, diasNoMes);
  return new Date(Date.UTC(nextYear, nextMonth, finalDay));
}

/**
 * Calcula a próxima data de vencimento de uma renovação de acordo com a frequência.
 * - diario: +1 dia
 * - semanal: +7 dias
 * - quinzenal: +15 dias
 * - mensal (padrão): +1 mês (respeitando diaBase se preservarDiaBase estiver ativo)
 */
export function calcularProximaDataRenovacao(
  dataBase: Date | string,
  frequencia?: string | null,
  options?: { diaBase?: number | null; preservarDiaBase?: boolean }
): Date {
  const freq = normalizarFrequencia(frequencia);
  if (freq === "diario") return addDiasUTC(dataBase, 1);
  if (freq === "semanal") return addDiasUTC(dataBase, 7);
  if (freq === "quinzenal") return addDiasUTC(dataBase, 15);
  return addMesUTC(dataBase, options?.preservarDiaBase ? options.diaBase : null);
}

export function labelPrazoRenovacao(frequencia?: string | null): string {
  switch (normalizarFrequencia(frequencia)) {
    case "diario":
      return "+1 dia";
    case "semanal":
      return "+7 dias";
    case "quinzenal":
      return "+15 dias";
    case "mensal":
    default:
      return "+30 dias";
  }
}

export function labelPrazoCurto(frequencia?: string | null): string {
  switch (normalizarFrequencia(frequencia)) {
    case "diario":
      return "+1d";
    case "semanal":
      return "+7d";
    case "quinzenal":
      return "+15d";
    case "mensal":
    default:
      return "+30d";
  }
}

export function labelFrequencia(frequencia?: string | null): string {
  switch (normalizarFrequencia(frequencia)) {
    case "diario":
      return "Diário";
    case "semanal":
      return "Semanal";
    case "quinzenal":
      return "Quinzenal";
    case "mensal":
    default:
      return "Mensal";
  }
}
