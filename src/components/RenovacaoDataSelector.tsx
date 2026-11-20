"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { hojeEmBrasilia } from "@/lib/dateUtils";
import {
  calcularProximaDataRenovacao,
  formatarDataBR,
  labelFrequencia,
  labelPrazoRenovacao,
  normalizarFrequencia,
  toIsoDateUTC,
  type FrequenciaRenovacao,
} from "@/lib/renovacao";

export interface RenovacaoDataState {
  /** Data no formato YYYY-MM-DD */
  novaData: string;
  /** Preset selecionado (+7d, +15d, +30d, +1d) ou null quando o usuário escolheu data manual */
  presetSelecionado: FrequenciaRenovacao | null;
  /** True quando o usuário clicou em um preset, mudou a base ou editou a data */
  alterado: boolean;
  /** Quando o preset escolhido difere da frequência atual, salva a nova frequência no contrato */
  salvarFrequencia: boolean;
}

export function criarEstadoRenovacaoInicial(
  vencimentoAtual: Date | string,
  frequenciaAtual?: string | null
): RenovacaoDataState {
  const freq = normalizarFrequencia(frequenciaAtual);
  const proxima = calcularProximaDataRenovacao(vencimentoAtual, freq);
  return {
    novaData: toIsoDateUTC(proxima),
    presetSelecionado: freq,
    alterado: false,
    salvarFrequencia: true,
  };
}

export function extrairParamsRenovacao(
  state: RenovacaoDataState,
  frequenciaAtual?: string | null
): {
  novaDataVencimento: string | null;
  atualizarFrequencia: FrequenciaRenovacao | null;
} {
  const freqAtual = normalizarFrequencia(frequenciaAtual);
  const mudouFreq =
    state.presetSelecionado !== null &&
    state.presetSelecionado !== freqAtual &&
    state.salvarFrequencia;

  return {
    novaDataVencimento: state.alterado && state.novaData ? state.novaData : null,
    atualizarFrequencia: mudouFreq ? state.presetSelecionado : null,
  };
}

interface RenovacaoDataSelectorProps {
  vencimentoAtual: Date | string;
  frequenciaAtual?: string | null;
  value: RenovacaoDataState;
  onChange: (next: RenovacaoDataState) => void;
  disabled?: boolean;
}

export default function RenovacaoDataSelector({
  vencimentoAtual,
  frequenciaAtual,
  value,
  onChange,
  disabled = false,
}: RenovacaoDataSelectorProps) {
  const [baseCalculo, setBaseCalculo] = useState<"vencimento" | "hoje">("vencimento");

  const freqAtual = normalizarFrequencia(frequenciaAtual);
  const vencIso = toIsoDateUTC(vencimentoAtual);
  const hojeIso = toIsoDateUTC(hojeEmBrasilia());
  const estaAtrasado = Boolean(vencIso && hojeIso && vencIso < hojeIso);
  const baseAtiva = estaAtrasado && baseCalculo === "hoje" ? hojeIso : vencIso || hojeIso;

  const presets: { id: FrequenciaRenovacao; label: string }[] =
    freqAtual === "diario"
      ? [
          { id: "diario", label: "+1 dia" },
          { id: "semanal", label: "+7 dias" },
          { id: "quinzenal", label: "+15 dias" },
          { id: "mensal", label: "+30 dias" },
        ]
      : [
          { id: "semanal", label: "+7 dias" },
          { id: "quinzenal", label: "+15 dias" },
          { id: "mensal", label: "+30 dias" },
        ];

  const handleSelectPreset = (preset: FrequenciaRenovacao) => {
    const dt = calcularProximaDataRenovacao(baseAtiva, preset);
    onChange({
      ...value,
      novaData: toIsoDateUTC(dt),
      presetSelecionado: preset,
      alterado: true,
    });
  };

  const handleChangeBase = (novaBase: "vencimento" | "hoje") => {
    setBaseCalculo(novaBase);
    const baseStr = novaBase === "hoje" ? hojeIso : vencIso || hojeIso;
    const freqCalc = value.presetSelecionado ?? freqAtual;
    const dt = calcularProximaDataRenovacao(baseStr, freqCalc);
    onChange({
      ...value,
      novaData: toIsoDateUTC(dt),
      presetSelecionado: freqCalc,
      alterado: true,
    });
  };

  const handleDateInput = (iso: string) => {
    onChange({
      ...value,
      novaData: iso,
      presetSelecionado: null,
      alterado: true,
    });
  };

  const formatCurta = (iso: string) => {
    const br = formatarDataBR(iso);
    return br ? br.slice(0, 5) : "";
  };

  const mostrarSalvarFreq =
    value.presetSelecionado !== null && value.presetSelecionado !== freqAtual;

  return (
    <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-600">
          <CalendarClock className="w-3.5 h-3.5 text-amber-600" />
          Novo Vencimento
        </span>
        {vencIso && (
          <span className="text-[11px] font-semibold text-slate-400 tabular-nums">
            Atual: <strong className="text-slate-600">{formatarDataBR(vencIso)}</strong>
          </span>
        )}
      </div>

      {/* Quando está atrasado, permite contar o prazo a partir do vencimento ou de hoje */}
      {estaAtrasado && (
        <div className="flex items-center justify-between gap-2 bg-white border border-slate-200/80 rounded-xl p-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleChangeBase("vencimento")}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50 ${
              baseCalculo === "vencimento"
                ? "bg-slate-800 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Do vencimento ({formatCurta(vencIso)})
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleChangeBase("hoje")}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50 ${
              baseCalculo === "hoje"
                ? "bg-amber-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            A partir de hoje ({formatCurta(hojeIso)})
          </button>
        </div>
      )}

      {/* Botões rápidos de prazo */}
      <div className={`grid gap-1.5 ${presets.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
        {presets.map((p) => {
          const ativo = value.presetSelecionado === p.id;
          return (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => handleSelectPreset(p.id)}
              className={`py-2 px-2 rounded-xl text-xs font-black border transition-all cursor-pointer disabled:opacity-50 ${
                ativo
                  ? "bg-amber-500 text-white border-amber-600 shadow-sm"
                  : "bg-white text-slate-700 border-slate-200 hover:border-amber-300 hover:bg-amber-50/50"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Campo de data editável para escolher qualquer dia específico */}
      <div className="space-y-1">
        <input
          type="date"
          required
          disabled={disabled}
          value={value.novaData}
          onChange={(e) => handleDateInput(e.target.value)}
          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 transition-all cursor-pointer disabled:opacity-50"
        />
        {!value.presetSelecionado && value.novaData && (
          <p className="text-[11px] text-amber-700 font-semibold">
            Data personalizada selecionada: {formatarDataBR(value.novaData)}
          </p>
        )}
      </div>

      {/* Opção para salvar a nova frequência no contrato */}
      {mostrarSalvarFreq && value.presetSelecionado && (
        <label className="flex items-start gap-2 bg-amber-50/80 border border-amber-200/80 rounded-xl px-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.salvarFrequencia}
            onChange={(e) => onChange({ ...value, salvarFrequencia: e.target.checked })}
            className="mt-0.5 w-3.5 h-3.5 accent-amber-600 cursor-pointer shrink-0"
          />
          <span className="text-[11px] font-semibold text-amber-900 leading-snug">
            Salvar contrato como{" "}
            <strong className="font-black">
              {labelFrequencia(value.presetSelecionado)} ({labelPrazoRenovacao(value.presetSelecionado)})
            </strong>{" "}
            para as próximas renovações
          </span>
        </label>
      )}
    </div>
  );
}
