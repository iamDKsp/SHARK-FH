"use client";

import { AlertTriangle } from "lucide-react";
import {
  criarEstadoAtrasoRenovacaoInicial,
  resolverAtrasoRenovacao,
  type RenovacaoAtrasoState,
  type ResolucaoAtrasoRenovacao,
} from "@/lib/renovacao";

export {
  criarEstadoAtrasoRenovacaoInicial,
  resolverAtrasoRenovacao,
  type RenovacaoAtrasoState,
  type ResolucaoAtrasoRenovacao,
};

interface RenovacaoAtrasoSelectorProps {
  diasAtraso: number;
  jurosCalculado: number;
  value: RenovacaoAtrasoState;
  onChange: (next: RenovacaoAtrasoState) => void;
  disabled?: boolean;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export default function RenovacaoAtrasoSelector({
  diasAtraso,
  jurosCalculado,
  value,
  onChange,
  disabled = false,
}: RenovacaoAtrasoSelectorProps) {
  if (diasAtraso <= 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3.5 space-y-2.5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 leading-snug">
          <span className="font-black">
            {diasAtraso} {diasAtraso === 1 ? "dia" : "dias"} de atraso
          </span>{" "}
          {jurosCalculado > 0 ? (
            <>
              (multa calculada: <strong className="font-black">{fmtBRL(jurosCalculado)}</strong>).
            </>
          ) : (
            <span className="text-amber-800">(sem diária automática cadastrada no contrato).</span>
          )}
          <div className="text-[11px] text-amber-800 mt-0.5 font-medium">
            O cliente pagou a diária de atraso ou você abonou?
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onChange({
              decisao: "cobrar",
              valorInput:
                value.valorInput || (jurosCalculado > 0 ? String(jurosCalculado) : ""),
            })
          }
          className={`py-2 px-2.5 rounded-xl text-[11px] font-black border transition-all cursor-pointer disabled:opacity-50 ${
            value.decisao === "cobrar"
              ? "bg-amber-600 text-white border-amber-700 shadow-sm"
              : "bg-white text-amber-800 border-amber-200 hover:bg-amber-100"
          }`}
        >
          Cobrou diária
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onChange({
              ...value,
              decisao: "abonar",
            })
          }
          className={`py-2 px-2.5 rounded-xl text-[11px] font-black border transition-all cursor-pointer disabled:opacity-50 ${
            value.decisao === "abonar"
              ? "bg-slate-800 text-white border-slate-900 shadow-sm"
              : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
          }`}
        >
          Abonou (R$ 0)
        </button>
      </div>

      {value.decisao === "cobrar" && (
        <div className="pt-1 space-y-1">
          <label className="text-[10px] font-black uppercase tracking-wider text-amber-800 block">
            Valor total cobrado de diária (R$)
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            disabled={disabled}
            placeholder="Ex: 50,00"
            value={value.valorInput}
            onChange={(e) =>
              onChange({
                ...value,
                valorInput: e.target.value,
              })
            }
            className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:opacity-50"
          />
          {jurosCalculado <= 0 && (
            <p className="text-[11px] text-amber-800/90 font-medium">
              Informe o valor total das diárias pagas pelo cliente ({diasAtraso}{" "}
              {diasAtraso === 1 ? "dia" : "dias"} em atraso).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
