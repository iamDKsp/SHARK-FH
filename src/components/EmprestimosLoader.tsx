"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Loader2, CloudOff } from "lucide-react";
import EmprestimosListWrapper from "@/components/EmprestimosListWrapper";
import ExportarEmprestimosButton from "@/components/ExportarEmprestimosButton";
import { useOffline } from "@/components/offline/OfflineProvider";
import { getAllEmprestimos, getCachedConfig } from "@/lib/offline/db";
import { applyPendingToEmprestimos } from "@/lib/offline/applyPending";
import type { CachedConfig, CachedEmprestimo } from "@/lib/offline/types";

interface EmprestimosLoaderProps {
  initialFiltro?: string;
  initialSearch?: string;
  initialParceiro?: string;
  initialSort?: string;
  initialPagina?: number;
  initialDiasAtraso?: string;
}

export default function EmprestimosLoader({
  initialFiltro,
  initialSearch = "",
  initialParceiro = "todos",
  initialSort = "padrao",
  initialPagina = 1,
  initialDiasAtraso = "0",
}: EmprestimosLoaderProps) {
  const { session, pendingOps, dataRevision, isOnline, syncBootstrap } = useOffline();
  const [rawEmps, setRawEmps] = useState<CachedEmprestimo[]>([]);
  const [config, setConfig] = useState<CachedConfig>({
    regra_carencia_30_dias: false,
    regra_carencia_10_dias: false,
    perguntar_whatsapp_renovacao: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = session?.userId || "local";
    let cancelled = false;

    const load = async () => {
      try {
        const [emps, cfg] = await Promise.all([
          getAllEmprestimos(uid).catch(() => []),
          getCachedConfig(uid),
        ]);
        if (!cancelled) {
          setRawEmps(emps);
          setConfig(cfg);
          if (emps.length > 0 || !isOnline) {
            setLoading(false);
          }
        }
        if (emps.length === 0 && isOnline) {
          await syncBootstrap(true);
          if (!cancelled) {
            const [emps2, cfg2] = await Promise.all([
              getAllEmprestimos(uid).catch(() => []),
              getCachedConfig(uid),
            ]);
            setRawEmps(emps2);
            setConfig(cfg2);
            setLoading(false);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [session?.userId, dataRevision, isOnline, syncBootstrap]);

  const emprestimos = useMemo(() => {
    return applyPendingToEmprestimos(rawEmps, pendingOps);
  }, [rawEmps, pendingOps]);

  const modoCarencia = config.regra_carencia_30_dias;
  const modoCarencia10 = config.regra_carencia_10_dias;
  const statusPadrao = modoCarencia10 ? "hoje" : modoCarencia ? "carencia" : "ativos";
  const statusInicial = initialFiltro || statusPadrao;

  if (loading && emprestimos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-2">
        <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
        <span className="text-xs text-slate-500">Carregando empréstimos...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Empréstimos</h1>
          <p className="text-slate-500">{emprestimos.length} no total</p>
        </div>
        <div className="flex items-center gap-3">
          {isOnline && <ExportarEmprestimosButton emprestimos={emprestimos} />}
          <Link
            href="/emprestimos/novo"
            className="flex items-center space-x-1.5 bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Novo empréstimo</span>
          </Link>
        </div>
      </div>

      {!isOnline && (
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-xs font-semibold">
          <CloudOff className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Modo offline — exibindo empréstimos salvos no aparelho.</span>
        </div>
      )}

      <EmprestimosListWrapper
        initialEmprestimos={emprestimos}
        initialFiltro={statusInicial}
        initialSearch={initialSearch}
        initialParceiro={initialParceiro}
        initialSort={initialSort}
        initialPagina={initialPagina}
        initialDiasAtraso={initialDiasAtraso}
        modoCarencia={modoCarencia}
        modoCarencia10={modoCarencia10}
      />
    </div>
  );
}
