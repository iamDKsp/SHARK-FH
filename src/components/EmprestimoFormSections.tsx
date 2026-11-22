"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Calendar,
  Wallet,
  Settings,
  FileText,
  CheckCircle2,
  Calculator,
  MessageSquare,
  X,
  Loader2,
  User,
} from "lucide-react";
import AtrasoField from "@/components/AtrasoField";
import type { TipoAtraso } from "@/lib/jurosAtraso";

export interface ParceiroOption {
  id: string;
  nome: string;
}

export type TipoPagamento =
  | "a_vista"
  | "a_vista_juros"
  | "juros_compostos"
  | "parcelado"
  | "parcela_juros_mes";

export type Frequencia = "diario" | "semanal" | "quinzenal" | "mensal";

export interface ParcelaSimulada {
  numero: number;
  valor: number;
  data_vencimento: string;
}

// Evita que 31/05 + 1 mês pule para Julho 01, travando no último dia do mês esperado (30/06).
export const addMonthsCapped = (date: Date, months: number) => {
  const d = new Date(date.valueOf());
  const expectedMonth = (d.getMonth() + months) % 12;
  d.setMonth(d.getMonth() + months);
  if (d.getMonth() !== (expectedMonth < 0 ? expectedMonth + 12 : expectedMonth)) {
    d.setDate(0);
  }
  return d;
};

function getHojeBrasiliaIso(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    const hoje = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
  }
}

function calcularVencimentoPrimeira(dataInicio: string, frequencia: Frequencia): string {
  if (!dataInicio) return "";
  const [year, month, day] = dataInicio.split("-").map(Number);
  if (!year || !month || !day) return "";
  let start = new Date(year, month - 1, day, 12, 0, 0); // meio-dia para evitar fuso
  if (frequencia === "diario") start.setDate(start.getDate() + 1);
  else if (frequencia === "semanal") start.setDate(start.getDate() + 7);
  else if (frequencia === "quinzenal") start.setDate(start.getDate() + 15);
  else if (frequencia === "mensal") start = addMonthsCapped(start, 1);

  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}

export const formatBRL = (val: number) => {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(val);
};

export const formatDataBr = (dateStr: string) => {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

export function getDescricaoTipoPagamento(tipoPagamento: TipoPagamento): string {
  switch (tipoPagamento) {
    case "a_vista":
      return "Pagamento único na data de vencimento. Ex: emprestou R$ 500 → recebe R$ 500. Sem juros e sem parcelas.";
    case "a_vista_juros":
      return "Pagamento único com juros simples. Ex: R$ 500 a 10% → recebe R$ 550 no vencimento. Quando usar: quer cobrar juros só no final.";
    case "juros_compostos":
      return "Juros compostos por período. Ex: R$ 200.000 a 10% por 3 meses → R$ 266.200 no vencimento. Quando usar: juros capitalizados a cada período.";
    case "parcelado":
      return "Parcelado em parcelas iguais (juros opcional). Ex: R$ 600 em 3x mensais. Quando usar: deseja receber em parcelas fixas.";
    case "parcela_juros_mes":
      return "Parcela mensal com juros por mês embutido em todas as parcelas. Ex: R$ 1.000 a 10% por 10 meses → 10x de R$ 200. Quando usar: quer receber principal + juros todo mês.";
  }
}

export function useEmprestimoFormState() {
  const [parceiroId, setParceiroId] = useState("");
  const [valor, setValor] = useState<number>(0);
  const [tipoPagamento, setTipoPagamento] = useState<TipoPagamento>("a_vista_juros");
  const [frequencia, setFrequenciaState] = useState<Frequencia>("mensal");
  const [taxaJuros, setTaxaJuros] = useState<number>(30); // default 30%
  const [periodos, setPeriodos] = useState<number>(3); // parcelas ou meses
  const [dataInicio, setDataInicioState] = useState<string>(() => getHojeBrasiliaIso());
  const [vencimentoPrimeira, setVencimentoPrimeira] = useState<string>(() =>
    calcularVencimentoPrimeira(getHojeBrasiliaIso(), "mensal")
  );
  const [categoria, setCategoria] = useState("Sem categoria");
  const [observacoes, setObservacoes] = useState("");
  const [enviarPdfWhatsapp, setEnviarPdfWhatsapp] = useState(true);
  const [vencimentoManual, setVencimentoManual] = useState(false);
  const [vencimentoManualData, setVencimentoManualData] = useState("");
  const [atrasoTipo, setAtrasoTipo] = useState<TipoAtraso>("nenhum");
  const [atrasoValor, setAtrasoValor] = useState<number>(0);

  // Recalcula automaticamente o vencimento da 1ª parcela ao alterar dataInicio ou frequencia
  const setDataInicio = useCallback(
    (novaData: string) => {
      setDataInicioState(novaData);
      if (novaData) {
        setVencimentoPrimeira(calcularVencimentoPrimeira(novaData, frequencia));
      }
    },
    [frequencia]
  );

  const setFrequencia = useCallback(
    (novaFreq: Frequencia) => {
      setFrequenciaState(novaFreq);
      if (dataInicio) {
        setVencimentoPrimeira(calcularVencimentoPrimeira(dataInicio, novaFreq));
      }
    },
    [dataInicio]
  );

  const parcelasSimuladas = useMemo<ParcelaSimulada[]>(() => {
    if (valor <= 0 || !dataInicio) return [];

    const addPeriod = (dateStr: string, index: number) => {
      const [year, month, day] = dateStr.split("-").map(Number);
      let d = new Date(year, month - 1, day, 12, 0, 0);
      if (frequencia === "diario") {
        d.setDate(d.getDate() + index);
      } else if (frequencia === "semanal") {
        d.setDate(d.getDate() + index * 7);
      } else if (frequencia === "quinzenal") {
        d.setDate(d.getDate() + index * 15);
      } else if (frequencia === "mensal") {
        d = addMonthsCapped(d, index);
      }
      const pad = (n: number) => n.toString().padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    const list: ParcelaSimulada[] = [];
    const safePeriodos = Math.max(1, Number(periodos) || 1);

    if (tipoPagamento === "a_vista") {
      const venc = addPeriod(dataInicio, 1);
      list.push({ numero: 1, valor, data_vencimento: venc });
    } else if (tipoPagamento === "a_vista_juros") {
      const venc = addPeriod(dataInicio, 1);
      const total = valor * (1 + taxaJuros / 100);
      list.push({ numero: 1, valor: Number(total.toFixed(2)), data_vencimento: venc });
    } else if (tipoPagamento === "juros_compostos") {
      const venc = addPeriod(dataInicio, safePeriodos);
      const total = valor * Math.pow(1 + taxaJuros / 100, safePeriodos);
      list.push({ numero: 1, valor: Number(total.toFixed(2)), data_vencimento: venc });
    } else if (tipoPagamento === "parcelado") {
      const total = valor * (1 + taxaJuros / 100);
      const valorParcela = Number((total / safePeriodos).toFixed(2));
      for (let i = 0; i < safePeriodos; i++) {
        list.push({
          numero: i + 1,
          valor: valorParcela,
          data_vencimento: addPeriod(vencimentoPrimeira, i),
        });
      }
    } else if (tipoPagamento === "parcela_juros_mes") {
      const valorParcela = Number(
        (valor / safePeriodos + valor * (taxaJuros / 100)).toFixed(2)
      );
      for (let i = 0; i < safePeriodos; i++) {
        list.push({
          numero: i + 1,
          valor: valorParcela,
          data_vencimento: addPeriod(vencimentoPrimeira, i),
        });
      }
    }

    return list;
  }, [valor, dataInicio, tipoPagamento, frequencia, taxaJuros, periodos, vencimentoPrimeira]);

  const dataVencimentoCalculada =
    parcelasSimuladas.length > 0
      ? parcelasSimuladas[parcelasSimuladas.length - 1].data_vencimento
      : vencimentoPrimeira;

  const dataVencimentoFinal =
    vencimentoManual && vencimentoManualData ? vencimentoManualData : dataVencimentoCalculada;

  const parcelasFinais = useMemo(
    () =>
      parcelasSimuladas.map((p) =>
        vencimentoManual && vencimentoManualData && parcelasSimuladas.length === 1
          ? { ...p, data_vencimento: vencimentoManualData }
          : p
      ),
    [parcelasSimuladas, vencimentoManual, vencimentoManualData]
  );

  const totalSimulado = useMemo(
    () => parcelasFinais.reduce((acc, p) => acc + p.valor, 0),
    [parcelasFinais]
  );

  return {
    parceiroId,
    setParceiroId,
    valor,
    setValor,
    tipoPagamento,
    setTipoPagamento,
    frequencia,
    setFrequencia,
    taxaJuros,
    setTaxaJuros,
    periodos,
    setPeriodos,
    dataInicio,
    setDataInicio,
    vencimentoPrimeira,
    setVencimentoPrimeira,
    categoria,
    setCategoria,
    observacoes,
    setObservacoes,
    enviarPdfWhatsapp,
    setEnviarPdfWhatsapp,
    vencimentoManual,
    setVencimentoManual,
    vencimentoManualData,
    setVencimentoManualData,
    atrasoTipo,
    setAtrasoTipo,
    atrasoValor,
    setAtrasoValor,
    parcelasSimuladas,
    dataVencimentoCalculada,
    dataVencimentoFinal,
    parcelasFinais,
    totalSimulado,
  };
}

export type EmprestimoFormState = ReturnType<typeof useEmprestimoFormState>;

interface EmprestimoCamposCompletosProps {
  state: EmprestimoFormState;
  parceiros: ParceiroOption[];
  showParceiroSection?: boolean;
  idPrefix?: string;
  clienteNomePreview?: string;
}

export function EmprestimoCamposCompletos({
  state,
  parceiros,
  showParceiroSection = false,
  idPrefix = "",
  clienteNomePreview,
}: EmprestimoCamposCompletosProps) {
  const {
    parceiroId,
    setParceiroId,
    valor,
    setValor,
    tipoPagamento,
    setTipoPagamento,
    frequencia,
    setFrequencia,
    taxaJuros,
    setTaxaJuros,
    periodos,
    setPeriodos,
    dataInicio,
    setDataInicio,
    vencimentoPrimeira,
    setVencimentoPrimeira,
    categoria,
    setCategoria,
    observacoes,
    setObservacoes,
    enviarPdfWhatsapp,
    setEnviarPdfWhatsapp,
    vencimentoManual,
    setVencimentoManual,
    vencimentoManualData,
    setVencimentoManualData,
    setAtrasoTipo,
    setAtrasoValor,
    dataVencimentoCalculada,
    parcelasFinais,
    totalSimulado,
  } = state;

  const id = (name: string) => `${idPrefix}${name}`;

  return (
    <div className="space-y-6">
      {/* Seção Opcional: Quem Emprestou (quando não há Seção 1 externa) */}
      {showParceiroSection && (
        <div className="premium-card bg-white border border-slate-200 shadow-md rounded-2xl relative overflow-hidden transition-shadow hover:shadow-lg">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-emerald-500"></div>
          <div className="p-6 md:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-50 rounded-xl">
                  <User className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-800 tracking-tight">
                    Origem do Empréstimo
                  </h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Defina quem emprestou o valor para este cliente.
                  </p>
                </div>
              </div>
              {clienteNomePreview && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold self-start sm:self-center">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate max-w-[220px]">Cliente: {clienteNomePreview}</span>
                </span>
              )}
            </div>

            <div className="space-y-2 max-w-md">
              <label
                htmlFor={id("parceiroId")}
                className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1"
              >
                Quem Emprestou? <span className="text-rose-500">*</span>
              </label>
              <select
                id={id("parceiroId")}
                name={id("parceiroId")}
                value={parceiroId}
                onChange={(e) => setParceiroId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 font-medium hover:border-emerald-400 transition-colors cursor-pointer"
              >
                <option value="">Eu (Administrador)</option>
                {parceiros.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome} (Parceiro)
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Seção 2: Valores e Modalidade */}
      <div className="premium-card bg-white border border-slate-200 shadow-md rounded-2xl relative overflow-hidden transition-shadow hover:shadow-lg">
        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-blue-500"></div>
        <div className="p-6 md:p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2.5 bg-blue-50 rounded-xl">
              <Wallet className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800 tracking-tight">
                Valores e Modalidade
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Defina o montante e a forma como será pago.
              </p>
            </div>
          </div>

          <div className="space-y-8">
            <div className="space-y-3">
              <label
                htmlFor={id("valorEmprestado")}
                className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-1"
              >
                Valor Principal <span className="text-rose-500">*</span>
              </label>
              <div className="relative group max-w-sm">
                <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                  <span className="text-sm font-black text-emerald-600">R$</span>
                </div>
                <input
                  type="number"
                  id={id("valorEmprestado")}
                  name={id("valorEmprestado")}
                  required
                  min="1"
                  step="any"
                  placeholder="0,00"
                  value={valor || ""}
                  onChange={(e) => setValor(Number(e.target.value))}
                  className="w-full bg-emerald-50/50 border-2 border-emerald-500/50 rounded-xl pl-10 pr-4 py-3.5 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 text-emerald-700 font-black transition-all shadow-sm placeholder:text-emerald-500/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                Tipo de Pagamento <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-1 min-[380px]:grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-3">
                {[
                  { id: "a_vista", label: "À Vista" },
                  { id: "a_vista_juros", label: "À Vista + Juros" },
                  { id: "juros_compostos", label: "Juros Compostos" },
                  { id: "parcelado", label: "Parcelado" },
                  { id: "parcela_juros_mes", label: "Parcela + Juros/Mês" },
                ].map((tipo) => (
                  <button
                    key={tipo.id}
                    type="button"
                    onClick={() => setTipoPagamento(tipo.id as TipoPagamento)}
                    className={`relative py-3.5 px-4 rounded-xl border text-sm font-bold transition-all text-center overflow-hidden flex items-center justify-center gap-2 cursor-pointer ${
                      tipoPagamento === tipo.id
                        ? "bg-emerald-600 text-white border-emerald-600 shadow-md transform scale-[1.02]"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-emerald-400"
                    }`}
                  >
                    {tipoPagamento === tipo.id && (
                      <CheckCircle2 className="w-4 h-4 absolute left-3 opacity-50" />
                    )}
                    {tipo.label}
                  </button>
                ))}
              </div>
              <div className="bg-blue-50 p-3.5 rounded-xl border border-blue-100 flex items-start gap-3 mt-2">
                <Calculator className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-sm text-blue-800 font-medium leading-relaxed">
                  {getDescricaoTipoPagamento(tipoPagamento)}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                Categoria da Operação
              </label>
              <div className="flex flex-wrap gap-2.5">
                {[
                  "Sem categoria",
                  "Educação",
                  "Emergência",
                  "Família",
                  "Pessoal",
                  "Trabalho",
                ].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoria(cat)}
                    className={`py-2 px-4 rounded-full border text-sm font-bold transition-all cursor-pointer ${
                      categoria === cat
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm transform scale-[1.05]"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Seção 3: Datas e Detalhes */}
      <div className="premium-card bg-white border border-slate-200 shadow-md rounded-2xl relative overflow-hidden transition-shadow hover:shadow-lg">
        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-500"></div>
        <div className="p-6 md:p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2.5 bg-amber-50 rounded-xl">
              <Calendar className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800 tracking-tight">
                Datas e Detalhes
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">Determine os juros e os prazos.</p>
            </div>
          </div>

          {/* Vencimento — Automático ou Manual */}
          {(tipoPagamento === "a_vista" ||
            tipoPagamento === "a_vista_juros" ||
            tipoPagamento === "juros_compostos") && (
            <div
              className={`rounded-xl border text-sm mb-6 shadow-sm overflow-hidden ${
                vencimentoManual ? "border-slate-300 bg-white" : "border-amber-200 bg-amber-50"
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 py-3">
                <span
                  className={`font-bold ${
                    vencimentoManual ? "text-slate-700" : "text-amber-800"
                  }`}
                >
                  {vencimentoManual
                    ? "Data de vencimento (manual)"
                    : "Vencimento calculado automaticamente:"}
                </span>
                <div className="flex items-center gap-3">
                  {!vencimentoManual && (
                    <span className="font-black text-amber-600">
                      {formatDataBr(dataVencimentoCalculada)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setVencimentoManual(!vencimentoManual);
                      if (!vencimentoManual) setVencimentoManualData(dataVencimentoCalculada);
                    }}
                    className={`text-xs font-black px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                      vencimentoManual
                        ? "bg-amber-500 text-white border-amber-500"
                        : "bg-white text-slate-600 border-slate-300 hover:border-amber-400"
                    }`}
                  >
                    {vencimentoManual ? "Automático" : "Editar data"}
                  </button>
                </div>
              </div>
              <div
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                  vencimentoManual
                    ? "grid-rows-[1fr] opacity-100"
                    : "grid-rows-[0fr] opacity-0 pointer-events-none"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="px-4 pb-4">
                    <input
                      type="date"
                      required={vencimentoManual}
                      value={vencimentoManualData}
                      onChange={(e) => setVencimentoManualData(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 font-semibold hover:border-amber-400 transition-colors cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Taxa de Juros */}
            {tipoPagamento !== "a_vista" && (
              <div className="space-y-2 col-span-1 animate-in fade-in duration-200">
                <label
                  htmlFor={id("taxaJuros")}
                  className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1"
                >
                  {tipoPagamento === "juros_compostos" || tipoPagamento === "parcela_juros_mes"
                    ? "Taxa de Juros por Período (%) *"
                    : "Taxa de Juros (%) - Opcional"}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    id={id("taxaJuros")}
                    name={id("taxaJuros")}
                    required
                    min="0"
                    step="any"
                    value={taxaJuros}
                    onChange={(e) => setTaxaJuros(Number(e.target.value))}
                    placeholder="Ex: 5.5"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 font-semibold hover:border-amber-400 transition-colors"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                    %
                  </span>
                </div>
              </div>
            )}

            {/* Número de parcelas */}
            {tipoPagamento !== "a_vista" && tipoPagamento !== "a_vista_juros" && (
              <div className="space-y-2 col-span-1 animate-in fade-in duration-200">
                <label
                  htmlFor={id("periodos")}
                  className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1"
                >
                  {tipoPagamento === "juros_compostos"
                    ? "Número de Períodos *"
                    : "Número de Parcelas *"}
                </label>
                <input
                  type="number"
                  id={id("periodos")}
                  required
                  min="1"
                  max="120"
                  value={periodos}
                  onChange={(e) => setPeriodos(Number(e.target.value))}
                  placeholder="Ex: 12"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 font-semibold hover:border-amber-400 transition-colors"
                />
              </div>
            )}

            {/* Data de Início */}
            <div className="space-y-2">
              <label
                htmlFor={id("dataInicio")}
                className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1"
              >
                Data de Início <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                id={id("dataInicio")}
                name={id("dataInicio")}
                required
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 font-semibold hover:border-amber-400 transition-colors cursor-pointer"
              />
            </div>

            {/* Vencimento 1ª Parcela */}
            {tipoPagamento !== "a_vista" &&
              tipoPagamento !== "a_vista_juros" &&
              tipoPagamento !== "juros_compostos" && (
                <div className="space-y-2 animate-in fade-in duration-200">
                  <label
                    htmlFor={id("vencimentoPrimeira")}
                    className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1"
                  >
                    Vencimento da 1ª Parcela <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    id={id("vencimentoPrimeira")}
                    required
                    value={vencimentoPrimeira}
                    onChange={(e) => setVencimentoPrimeira(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 font-semibold hover:border-amber-400 transition-colors cursor-pointer"
                  />
                </div>
              )}
          </div>

          <div className="mt-8 space-y-3 pt-6 border-t border-slate-100">
            <label className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
              Frequência de Cobrança <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { id: "diario", label: "Diário" },
                { id: "semanal", label: "Semanal" },
                { id: "quinzenal", label: "Quinzenal" },
                { id: "mensal", label: "Mensal" },
              ].map((freq) => (
                <button
                  key={freq.id}
                  type="button"
                  onClick={() => setFrequencia(freq.id as Frequencia)}
                  className={`py-2.5 px-2 rounded-xl border text-sm font-bold transition-all text-center cursor-pointer ${
                    frequencia === freq.id
                      ? "bg-amber-500 text-white border-amber-500 shadow-md"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-400"
                  }`}
                >
                  {freq.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Seção 4: Configurações Avançadas */}
      <div className="premium-card bg-white border border-slate-200 shadow-md rounded-2xl relative overflow-hidden transition-shadow hover:shadow-lg">
        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-slate-400"></div>
        <div className="p-6 md:p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2.5 bg-slate-100 rounded-xl">
              <Settings className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-800 tracking-tight">
                Opções Avançadas
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">Juros de atraso e anotações extras.</p>
            </div>
          </div>

          <div className="space-y-6">
            <AtrasoField
              tipoInicial={state.atrasoTipo}
              valorInicial={state.atrasoValor}
              idPrefix={idPrefix}
              onChange={(regra) => {
                setAtrasoTipo(regra.tipo);
                setAtrasoValor(regra.valor);
              }}
            />

            <div className="space-y-2 pt-2">
              <label
                htmlFor={id("observacoes")}
                className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1"
              >
                Observações do Empréstimo
              </label>
              <div className="relative">
                <div className="absolute left-4 top-4 text-slate-400">
                  <FileText className="w-4 h-4" />
                </div>
                <textarea
                  id={id("observacoes")}
                  name={id("observacoes")}
                  rows={3}
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  placeholder="Notas sobre o empréstimo..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 font-medium hover:border-emerald-400 transition-colors resize-y"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabela de Simulação de Parcelas */}
      {parcelasFinais.length > 0 && (
        <div className="premium-card p-0 bg-white border border-slate-200 shadow-lg rounded-2xl relative overflow-hidden transition-all">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-emerald-500"></div>
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <div>
              <h3 className="text-sm font-black text-slate-900 tracking-tight">
                Cronograma de Recebimentos Simulado
              </h3>
              <p className="text-sm text-slate-500 mt-1">Veja a projeção antes de confirmar.</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-slate-500">
              <thead className="text-xs text-slate-400 uppercase font-black tracking-widest border-b border-slate-100 bg-slate-50/80">
                <tr>
                  <th className="py-3 px-6 w-24 text-center">Nº</th>
                  <th className="py-3 px-6">Vencimento</th>
                  <th className="py-3 px-6 text-right">Valor da Parcela</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parcelasFinais.map((p) => (
                  <tr key={p.numero} className="hover:bg-emerald-50/50 transition-colors group">
                    <td className="py-3.5 px-6 font-black text-slate-800 text-center">
                      {p.numero}
                    </td>
                    <td className="py-3.5 px-6 font-semibold flex items-center space-x-2 text-slate-600">
                      <Calendar className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 transition-colors" />
                      <span>{formatDataBr(p.data_vencimento)}</span>
                    </td>
                    <td className="py-3.5 px-6 text-right font-black text-emerald-600 text-sm">
                      {formatBRL(p.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totalizador */}
          <div className="flex items-center justify-between p-6 bg-emerald-50 border-t border-emerald-100">
            <span className="text-sm font-black text-emerald-800 uppercase tracking-widest">
              Total Estimado
            </span>
            <span className="text-base font-black text-emerald-700">
              {formatBRL(totalSimulado)}
            </span>
          </div>
        </div>
      )}

      {/* Opção de Envio do Cronograma por WhatsApp */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div
              className={`p-2.5 rounded-xl transition-colors mt-0.5 shrink-0 ${
                enviarPdfWhatsapp
                  ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                  : "bg-slate-100 text-slate-400 border border-slate-200"
              }`}
            >
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-black text-slate-800">
                  Enviar Cronograma (PDF) via WhatsApp
                </h4>
                <span
                  className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                    enviarPdfWhatsapp
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-slate-100 text-slate-500 border-slate-200"
                  }`}
                >
                  {enviarPdfWhatsapp ? "Ativado" : "Desativado"}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 max-w-xl">
                {enviarPdfWhatsapp
                  ? "O PDF oficial com a tabela de parcelas será gerado e enviado automaticamente para o WhatsApp do cliente logo após a criação."
                  : "Nenhum PDF será enviado agora. Você ainda poderá baixar ou gerar a qualquer momento dentro do empréstimo."}
              </p>
            </div>
          </div>

          {/* Toggle Switch */}
          <button
            type="button"
            role="switch"
            aria-checked={enviarPdfWhatsapp}
            onClick={() => setEnviarPdfWhatsapp(!enviarPdfWhatsapp)}
            className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500/30 self-start sm:self-center ${
              enviarPdfWhatsapp ? "bg-emerald-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                enviarPdfWhatsapp ? "translate-x-6" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmarWhatsappEmprestimoModalProps {
  isOpen: boolean;
  clienteNome: string;
  valorEmprestado: number;
  totalEstimado: number;
  dataVencimento: string;
  isOnline: boolean;
  isPending: boolean;
  onConfirm: (avisarNoWhats: boolean) => void;
  onClose: () => void;
}

export function ConfirmarWhatsappEmprestimoModal({
  isOpen,
  clienteNome,
  valorEmprestado,
  totalEstimado,
  dataVencimento,
  isOnline,
  isPending,
  onConfirm,
  onClose,
}: ConfirmarWhatsappEmprestimoModalProps) {
  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
      className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm motion-modal-backdrop-in"
    >
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden motion-modal-card-in">
        <div className="p-5 border-b border-slate-100 flex justify-between items-start bg-emerald-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0">
              <MessageSquare className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-sm sm:text-base">
                Deseja avisar o cliente no WhatsApp?
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {clienteNome ? `Cliente: ${clienteNome}` : "Confirmação de novo empréstimo"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                Valor Emprestado
              </span>
              <span className="font-black text-slate-900">{formatBRL(valorEmprestado)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                Total Estimado
              </span>
              <span className="font-black text-emerald-600">{formatBRL(totalEstimado)}</span>
            </div>
            <div className="flex justify-between pt-1.5 border-t border-slate-200/60">
              <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                Vencimento
              </span>
              <span className="font-bold text-slate-800">{formatDataBr(dataVencimento)}</span>
            </div>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            {isOnline ? (
              <>
                Escolha se deseja enviar a confirmação e o cronograma em PDF para o WhatsApp de{" "}
                <strong className="text-slate-900">{clienteNome || "cliente"}</strong> agora:
              </>
            ) : (
              <>
                Você está <strong>offline</strong>. O empréstimo será salvo no aparelho e, se você
                escolher avisar no WhatsApp, o PDF será disparado{" "}
                <strong>automaticamente assim que a internet voltar</strong>:
              </>
            )}
          </p>

          <div className="flex flex-col gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => onConfirm(true)}
              disabled={isPending}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 active:scale-[0.98] cursor-pointer disabled:opacity-50"
            >
              <MessageSquare className="w-4 h-4" />
              <span>
                {isOnline
                  ? "Sim, Criar e Avisar no WhatsApp"
                  : "Sim, Salvar e Disparar PDF ao Reconectar"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onConfirm(false)}
              disabled={isPending}
              className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4 text-slate-600" />
              <span>Não, Criar sem Avisar no WhatsApp</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="w-full py-2 text-slate-400 hover:text-slate-600 text-xs font-bold transition-colors cursor-pointer text-center"
            >
              Voltar e revisar dados
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface OverlayCriacaoEmprestimoProps {
  isOpen: boolean;
  step: number;
  criandoClienteJunto?: boolean;
}

export function OverlayCriacaoEmprestimo({
  isOpen,
  step,
  criandoClienteJunto = false,
}: OverlayCriacaoEmprestimoProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm transition-opacity">
      <div className="bg-white p-8 rounded-3xl max-w-sm w-full mx-4 shadow-2xl border border-slate-200 flex flex-col items-center justify-center space-y-6 text-center transform animate-in zoom-in-95 duration-300">
        <div className="relative flex items-center justify-center w-28 h-28 bg-emerald-50 rounded-full overflow-hidden">
          {step === 2 || step === 3 ? (
            <div className="w-full h-full flex items-center justify-center animate-in zoom-in duration-300">
              <CheckCircle2 className="w-16 h-16 text-emerald-500 drop-shadow-md" />
            </div>
          ) : (
            <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-base font-black text-slate-800 tracking-tight">
            {step === 0 && (criandoClienteJunto ? "Cadastrando cliente..." : "Validando dados...")}
            {step === 1 && "Calculando parcelas..."}
            {step === 2 &&
              (criandoClienteJunto
                ? "Cliente e empréstimo criados!"
                : "Contratação realizada com sucesso!")}
            {step === 3 && "Enviando cronograma via WhatsApp..."}
          </h3>
          <p className="text-sm font-medium text-slate-500">
            {step === 0 &&
              (criandoClienteJunto
                ? "Salvando o cadastro do cliente."
                : "Verificando informações do cliente e parceiro.")}
            {step === 1 && "Projetando recebimentos e juros."}
            {step === 2 && "Salvando e preparando redirecionamento..."}
            {step === 3 && "O PDF já está sendo enviado para o cliente."}
          </p>
        </div>

        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all duration-700 ease-in-out"
            style={{
              width: step === 0 ? "25%" : step === 1 ? "50%" : step === 2 ? "75%" : "100%",
            }}
          />
        </div>
      </div>
    </div>
  );
}
