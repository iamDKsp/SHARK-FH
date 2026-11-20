"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CloudOff,
  Clock,
  RefreshCw,
  X,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { useOffline } from "./OfflineProvider";

export default function PendingSyncBanner() {
  const {
    isEnabledRoute,
    isOnline,
    isSyncing,
    sessionExpired,
    pendingOps,
    pendingCount,
    toastMessage,
    cancelAction,
    syncOutbox,
    setModalOpen,
  } = useOffline();

  const [expanded, setExpanded] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  if (!isEnabledRoute) return null;

  const handleCancel = async (operationId: string, label: string) => {
    const ok = window.confirm(
      `Cancelar esta ação pendente?\n\n"${label}"\n\nEla não será enviada ao servidor e as alterações locais serão desfeitas.`
    );
    if (!ok) return;
    setCancelingId(operationId);
    try {
      await cancelAction(operationId);
    } finally {
      setCancelingId(null);
    }
  };

  const hasErrors = pendingOps.some((o) => o.status === "error");
  const primaryOp = pendingOps[0];

  return (
    <>
      {/* Banner discreto no topo quando há ações pendentes, sessão expirada ou modo offline */}
      {(pendingCount > 0 || !isOnline || sessionExpired) && (
        <div
          className={`w-full border-b text-xs transition-colors ${
            sessionExpired
              ? "bg-rose-50/95 border-rose-200 text-rose-900"
              : hasErrors
                ? "bg-rose-50/95 border-rose-200 text-rose-900"
                : pendingCount > 0
                  ? "bg-amber-50/95 border-amber-200/90 text-amber-950"
                  : "bg-slate-900 text-slate-100 border-slate-800"
          }`}
        >
          <div className="w-full max-w-7xl 2xl:max-w-[1600px] 3xl:max-w-[1880px] mx-auto px-3 sm:px-6 lg:px-8 py-2">
            {/* Linha principal compacta */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {sessionExpired ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                ) : isSyncing ? (
                  <Loader2 className="w-3.5 h-3.5 text-amber-600 animate-spin shrink-0" />
                ) : !isOnline ? (
                  <CloudOff className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                ) : (
                  <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                )}

                {sessionExpired ? (
                  <p className="truncate font-semibold">
                    Sessão expirada — faça login novamente para enviar{" "}
                    <strong>{pendingCount}</strong> {pendingCount === 1 ? "ação pendente" : "ações pendentes"}.
                  </p>
                ) : pendingCount > 0 && primaryOp ? (
                  <p className="truncate">
                    <span className="font-bold uppercase tracking-wider text-[10px] mr-1.5 opacity-80">
                      {isSyncing ? "Enviando" : "Pendente para envio"}:
                    </span>
                    <span className="font-semibold">{primaryOp.label}</span>
                    {pendingCount > 1 && (
                      <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-200/70 text-amber-950 font-bold text-[10px]">
                        +{pendingCount - 1}
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="truncate font-medium text-slate-200">
                    Modo offline ativo — você pode consultar o cache e registrar ações normalmente.
                  </p>
                )}
              </div>

              {/* Ações discretas no banner */}
              <div className="flex items-center gap-1.5 shrink-0">
                {sessionExpired && (
                  <Link
                    href="/login"
                    className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 transition-colors"
                  >
                    Fazer login
                  </Link>
                )}

                {pendingCount === 1 && primaryOp && !isSyncing && (
                  <button
                    type="button"
                    disabled={cancelingId === primaryOp.operationId}
                    onClick={() => handleCancel(primaryOp.operationId, primaryOp.label)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/80 hover:bg-rose-50 text-rose-700 border border-rose-200 font-bold transition-colors cursor-pointer disabled:opacity-50"
                    title="Cancelar esta ação pendente"
                  >
                    <X className="w-3 h-3" />
                    <span>Cancelar</span>
                  </button>
                )}

                {pendingCount > 1 && (
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => !e)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/80 hover:bg-white text-amber-900 border border-amber-300/80 font-bold transition-colors cursor-pointer"
                  >
                    <span>{expanded ? "Ocultar" : `Ver ações (${pendingCount})`}</span>
                    {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                )}

                {pendingCount > 0 && isOnline && !sessionExpired && (
                  <button
                    type="button"
                    disabled={isSyncing}
                    onClick={() => syncOutbox()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isSyncing ? "animate-spin" : ""}`} />
                    <span className="hidden sm:inline">{isSyncing ? "Enviando..." : "Enviar agora"}</span>
                  </button>
                )}

                {pendingCount === 0 && !isOnline && (
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition-colors cursor-pointer"
                  >
                    Cache local
                  </button>
                )}
              </div>
            </div>

            {/* Lista expandida inline para múltiplas ações com botão Cancelar em cada uma */}
            {expanded && pendingCount > 1 && (
              <div className="mt-2 pt-2 border-t border-amber-200/80 space-y-1.5 max-h-52 overflow-y-auto">
                {pendingOps.map((op) => (
                  <div
                    key={op.operationId}
                    className="flex items-center justify-between gap-2 bg-white/85 rounded-lg px-2.5 py-1.5 border border-amber-200/70"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-800 truncate">{op.label}</div>
                      {op.status === "error" && op.lastError && (
                        <div className="text-[11px] text-rose-600 truncate">Erro: {op.lastError}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          op.status === "error"
                            ? "bg-rose-100 text-rose-700"
                            : op.status === "syncing"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {op.status === "error"
                          ? "Erro"
                          : op.status === "syncing"
                            ? "Enviando"
                            : "Pendente"}
                      </span>
                      <button
                        type="button"
                        disabled={isSyncing || cancelingId === op.operationId}
                        onClick={() => handleCancel(op.operationId, op.label)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <X className="w-3 h-3" />
                        <span>Cancelar</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast discreto de confirmação */}
      {toastMessage && (
        <div className="fixed bottom-20 md:bottom-6 right-4 z-[90] max-w-sm bg-slate-900 text-white px-4 py-2.5 rounded-2xl shadow-xl border border-slate-700/80 flex items-center gap-2 text-xs font-semibold animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="truncate">{toastMessage}</span>
        </div>
      )}
    </>
  );
}
