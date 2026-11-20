"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  TrendingUp,
  RefreshCw,
  AlertTriangle,
  Wallet,
  Calendar,
  Search,
  Sparkles,
  ArrowUpRight,
  CheckCircle2,
} from "lucide-react";

export interface LancamentoFaturamento {
  id: string;
  emprestimoId: string;
  clienteId: string;
  clienteNome: string;
  numeroParcela: number;
  tipo: "renovacao" | "parcela";
  status: string;
  dataPagamento: string; // YYYY-MM-DD
  valorBase: number;
  diariaAtraso: number;
  valorTotal: number;
}

export interface PotencialMensal {
  jurosRenovacaoTotal: number;
  countRolagem: number;
  parcelasAcordosMes: number;
  countParcelados: number;
  avistaSemJurosTotal: number;
  countAVista: number;
  totalRecorrenteMes: number;
}

type PeriodoKey = "hoje" | "7d" | "30d" | "mes_atual" | "mes_passado" | "personalizado";
type AbaFiltro = "todos" | "renovacoes" | "diarias" | "parcelas";

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v);
}

function formatDateBr(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function getMonthBounds(iso: string, offsetMonths = 0): { start: string; end: string } {
  const [y, m] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offsetMonths, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const fmt = (dt: Date) =>
    `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  return { start: fmt(first), end: fmt(last) };
}

export default function FaturamentoView({
  hojeStr,
  potencial,
  lancamentos,
}: {
  hojeStr: string;
  potencial: PotencialMensal;
  lancamentos: LancamentoFaturamento[];
}) {
  const [periodo, setPeriodo] = useState<PeriodoKey>("30d");
  const [dataInicioCustom, setDataInicioCustom] = useState(() => addDaysIso(hojeStr, -29));
  const [dataFimCustom, setDataFimCustom] = useState(hojeStr);
  const [aba, setAba] = useState<AbaFiltro>("todos");
  const [busca, setBusca] = useState("");

  // Intervalo de datas ativo
  const { inicio, fim } = useMemo(() => {
    if (periodo === "hoje") return { inicio: hojeStr, fim: hojeStr };
    if (periodo === "7d") return { inicio: addDaysIso(hojeStr, -6), fim: hojeStr };
    if (periodo === "30d") return { inicio: addDaysIso(hojeStr, -29), fim: hojeStr };
    if (periodo === "mes_atual") return getMonthBounds(hojeStr, 0);
    if (periodo === "mes_passado") return getMonthBounds(hojeStr, -1);
    return {
      inicio: dataInicioCustom || "2000-01-01",
      fim: dataFimCustom || "2099-12-31",
    };
  }, [periodo, hojeStr, dataInicioCustom, dataFimCustom]);

  // Recebido no mês atual (para comparar com o potencial mensal no card superior)
  const recebidoMesAtual = useMemo(() => {
    const { start, end } = getMonthBounds(hojeStr, 0);
    let total = 0;
    let renovacoes = 0;
    let diarias = 0;
    for (const l of lancamentos) {
      if (l.dataPagamento >= start && l.dataPagamento <= end) {
        total += l.valorTotal;
        if (l.tipo === "renovacao") renovacoes += l.valorBase;
        diarias += l.diariaAtraso;
      }
    }
    return { total, renovacoes, diarias };
  }, [lancamentos, hojeStr]);

  // Lançamentos filtrados pelo período
  const noPeriodo = useMemo(() => {
    return lancamentos.filter(
      (l) => l.dataPagamento >= inicio && l.dataPagamento <= fim
    );
  }, [lancamentos, inicio, fim]);

  // Totais do período selecionado
  const resumo = useMemo(() => {
    let totalFaturado = 0;
    let totalRenovacoes = 0;
    let qtdRenovacoes = 0;
    let totalDiarias = 0;
    let qtdDiarias = 0;
    let totalParcelas = 0;
    let qtdParcelas = 0;

    for (const l of noPeriodo) {
      totalFaturado += l.valorTotal;
      if (l.tipo === "renovacao") {
        totalRenovacoes += l.valorBase;
        qtdRenovacoes++;
      } else {
        totalParcelas += l.valorBase;
        qtdParcelas++;
      }
      if (l.diariaAtraso > 0) {
        totalDiarias += l.diariaAtraso;
        qtdDiarias++;
      }
    }

    return {
      totalFaturado,
      totalRenovacoes,
      qtdRenovacoes,
      totalDiarias,
      qtdDiarias,
      totalParcelas,
      qtdParcelas,
    };
  }, [noPeriodo]);

  // Lista filtrada pela aba + busca
  const listaFiltrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return noPeriodo.filter((l) => {
      if (aba === "renovacoes" && l.tipo !== "renovacao") return false;
      if (aba === "diarias" && l.diariaAtraso <= 0) return false;
      if (aba === "parcelas" && l.tipo !== "parcela") return false;
      if (q && !l.clienteNome.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [noPeriodo, aba, busca]);

  const pctPotencial =
    potencial.totalRecorrenteMes > 0
      ? Math.min(100, Math.round((recebidoMesAtual.total / potencial.totalRecorrenteMes) * 100))
      : 0;

  return (
    <div className="space-y-6 w-full max-w-7xl 2xl:max-w-[1600px] mx-auto px-1 pb-10 text-zinc-900">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-black text-emerald-600 uppercase tracking-widest">
              Controle de Caixa &amp; Juros
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Faturamento
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Acompanhe previsões de renovação, juros recebidos, parcelas e diárias de atraso pagas a mais.
          </p>
        </div>
      </div>

      {/* ── BLOCO 1: POTENCIAL MENSAL (SE TODOS RENOVAREM) ── */}
      <div className="bg-gradient-to-br from-[#064e3b] via-[#065f46] to-[#047857] text-white rounded-3xl p-5 sm:p-6 shadow-lg border border-emerald-700/40 relative overflow-hidden">
        <div className="relative z-10 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-emerald-200 bg-white/10 px-2.5 py-1 rounded-full">
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                Previsão Mensal · Se Todos Renovarem
              </span>
              <div className="text-3xl sm:text-4xl font-black tracking-tight mt-2.5 leading-none">
                {formatBRL(potencial.totalRecorrenteMes)}
                <span className="text-sm sm:text-base font-semibold text-emerald-200 ml-1.5">/ mês</span>
              </div>
              <p className="text-xs text-emerald-100/80 mt-1.5">
                Soma de 1 renovação de juros de cada contrato ativo + 1 parcela mensal de cada acordo (sem contar quitações de capital).
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-xs border border-white/15 rounded-2xl px-4 py-3 text-left sm:text-right shrink-0">
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-200 block">
                Já entrou este mês
              </span>
              <span className="text-xl font-black text-white block mt-0.5">
                {formatBRL(recebidoMesAtual.total)}
              </span>
              <span className="text-[11px] text-emerald-200 font-semibold">
                {pctPotencial}% da previsão mensal
              </span>
            </div>
          </div>

          {/* Barra de progresso */}
          <div className="w-full h-2 bg-black/25 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-300 to-emerald-300 rounded-full transition-all duration-500"
              style={{ width: `${pctPotencial}%` }}
            />
          </div>

          {/* 3 mini-blocos detalhando a composição da previsão */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            <div className="bg-black/20 border border-white/10 rounded-2xl px-4 py-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-200 block">
                Só Juros de Renovação ({potencial.countRolagem} contratos)
              </span>
              <span className="text-lg font-black text-white mt-0.5 block">
                {formatBRL(potencial.jurosRenovacaoTotal)}
              </span>
            </div>
            <div className="bg-black/20 border border-white/10 rounded-2xl px-4 py-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-200 block">
                Parcelas Mensais de Acordos ({potencial.countParcelados})
              </span>
              <span className="text-lg font-black text-white mt-0.5 block">
                {formatBRL(potencial.parcelasAcordosMes)}
              </span>
            </div>
            <div className="bg-black/20 border border-white/10 rounded-2xl px-4 py-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-200 block">
                À Vista s/ Juros em Aberto ({potencial.countAVista})
              </span>
              <span className="text-lg font-black text-emerald-100 mt-0.5 block">
                {formatBRL(potencial.avistaSemJurosTotal)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── BLOCO 2: FILTRO DE PERÍODO DO FATURAMENTO REALIZADO ── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-black uppercase tracking-wider text-slate-500">
              Período Realizado
            </span>
          </div>
          <span className="text-xs font-bold text-slate-500">
            {formatDateBr(inicio)} até {formatDateBr(fim)}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: "hoje", label: "Hoje" },
              { id: "7d", label: "7 dias" },
              { id: "30d", label: "Últimos 30 dias" },
              { id: "mes_atual", label: "Este mês" },
              { id: "mes_passado", label: "Mês passado" },
              { id: "personalizado", label: "Personalizado" },
            ] as { id: PeriodoKey; label: string }[]
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriodo(p.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                periodo === p.id
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {periodo === "personalizado" && (
          <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 pt-1">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">De</label>
              <input
                type="date"
                value={dataInicioCustom}
                onChange={(e) => setDataInicioCustom(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Até</label>
              <input
                type="date"
                value={dataFimCustom}
                onChange={(e) => setDataFimCustom(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── BLOCO 3: 4 CARDS KPI DO PERÍODO REALIZADO ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Faturado */}
        <div className="bg-white border border-emerald-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black uppercase tracking-widest text-emerald-600">
              Total Faturado
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-700 leading-none">
            {formatBRL(resumo.totalFaturado)}
          </div>
          <p className="text-xs text-slate-400 mt-2 font-medium">
            {noPeriodo.length} {noPeriodo.length === 1 ? "recebimento" : "recebimentos"} no período
          </p>
        </div>

        {/* Só Renovações (Juros) */}
        <button
          type="button"
          onClick={() => setAba("renovacoes")}
          className={`text-left bg-white border rounded-2xl p-5 shadow-sm transition-all cursor-pointer hover:shadow-md ${
            aba === "renovacoes" ? "border-emerald-500 ring-2 ring-emerald-500/20" : "border-slate-200"
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black uppercase tracking-widest text-slate-500">
              Renovações (Juros)
            </span>
            <div className="w-8 h-8 rounded-xl bg-teal-50 flex items-center justify-center">
              <RefreshCw className="w-4 h-4 text-teal-600" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 leading-none">
            {formatBRL(resumo.totalRenovacoes)}
          </div>
          <p className="text-xs text-slate-400 mt-2 font-medium">
            {resumo.qtdRenovacoes} {resumo.qtdRenovacoes === 1 ? "renovação" : "renovações"}
          </p>
        </button>

        {/* Diárias de Atraso (A Mais) */}
        <button
          type="button"
          onClick={() => setAba("diarias")}
          className={`text-left bg-white border rounded-2xl p-5 shadow-sm transition-all cursor-pointer hover:shadow-md ${
            aba === "diarias" ? "border-amber-500 ring-2 ring-amber-500/20" : "border-amber-200"
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black uppercase tracking-widest text-amber-600">
              Diárias de Atraso
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </div>
          </div>
          <div className="text-2xl font-black text-amber-600 leading-none">
            {formatBRL(resumo.totalDiarias)}
          </div>
          <p className="text-xs text-slate-400 mt-2 font-medium">
            {resumo.qtdDiarias} {resumo.qtdDiarias === 1 ? "cobrança extra" : "cobranças extras"}
          </p>
        </button>

        {/* Parcelas / Quitações */}
        <button
          type="button"
          onClick={() => setAba("parcelas")}
          className={`text-left bg-white border rounded-2xl p-5 shadow-sm transition-all cursor-pointer hover:shadow-md ${
            aba === "parcelas" ? "border-blue-500 ring-2 ring-blue-500/20" : "border-slate-200"
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black uppercase tracking-widest text-blue-600">
              Parcelas / Quitações
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-blue-600" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 leading-none">
            {formatBRL(resumo.totalParcelas)}
          </div>
          <p className="text-xs text-slate-400 mt-2 font-medium">
            {resumo.qtdParcelas} {resumo.qtdParcelas === 1 ? "pagamento" : "pagamentos"}
          </p>
        </button>
      </div>

      {/* ── BLOCO 4: EXTRATO DETALHADO EM ABAS ── */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          {/* Abas */}
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: "todos", label: `Tudo (${noPeriodo.length})` },
                { id: "renovacoes", label: `Renovações (${resumo.qtdRenovacoes})` },
                { id: "diarias", label: `Diárias de Atraso (${resumo.qtdDiarias})` },
                { id: "parcelas", label: `Parcelas / Quitações (${resumo.qtdParcelas})` },
              ] as { id: AbaFiltro; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setAba(t.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  aba === t.id
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Busca */}
          <div className="relative w-full md:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Lista */}
        {listaFiltrada.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-500">
              Nenhum lançamento encontrado neste filtro/período.
            </p>
            <p className="text-xs text-slate-400">
              Toda renovação, quitação ou diária de atraso cobrada aparecerá automaticamente aqui.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {listaFiltrada.map((item) => (
              <Link
                key={item.id}
                href={`/emprestimos/${item.emprestimoId}`}
                className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-slate-50/80 transition-colors group"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900 truncate group-hover:text-emerald-700 transition-colors">
                      {item.clienteNome}
                    </span>
                    {item.tipo === "renovacao" ? (
                      <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                        Renovação (Juros)
                      </span>
                    ) : (
                      <span className="text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        Parcela #{item.numeroParcela}
                      </span>
                    )}
                    {item.diariaAtraso > 0 && (
                      <span className="text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                        + Diária {formatBRL(item.diariaAtraso)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                    <span>Pago em {formatDateBr(item.dataPagamento)}</span>
                    {item.diariaAtraso > 0 && (
                      <>
                        <span>•</span>
                        <span>Base: {formatBRL(item.valorBase)}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 text-right">
                  <div>
                    <div
                      className={`text-sm sm:text-base font-black tabular-nums ${
                        aba === "diarias"
                          ? "text-amber-600"
                          : item.tipo === "renovacao"
                            ? "text-emerald-600"
                            : "text-slate-900"
                      }`}
                    >
                      {aba === "diarias" ? formatBRL(item.diariaAtraso) : formatBRL(item.valorTotal)}
                    </div>
                    {aba === "diarias" && (
                      <div className="text-[10px] text-slate-400 font-semibold">
                        Total pago: {formatBRL(item.valorTotal)}
                      </div>
                    )}
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-600 transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
