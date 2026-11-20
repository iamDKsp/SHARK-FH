"use client";

import { useState } from "react";
import {
  X,
  Cloud,
  CloudOff,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Clock,
  Loader2,
  Database,
  RotateCcw,
} from "lucide-react";
import { useOffline } from "./OfflineProvider";

export default function PendingQueueModal() {
  const {
    modalOpen,
    setModalOpen,
    isOnline,
    isSyncing,
    isBootstrapping,
    sessionExpired,
    pendingOps,
    lastSyncedAt,
    cachedCounts,
    syncBootstrap,
    syncOutbox,
    cancelAction,
    retryAction,
  } = useOffline();

  const [busyId, setBusyId] = useState<string | null>(null);

  if (!modalOpen) return null;

  const formatDateTime = (iso: string | null) => {
    if (!iso) return "Ainda não sincronizado";
    try {
      return new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  const handleCancel = async (id: string, label: string) => {
    if (
      !window.confirm(
        `Cancelar esta ação pendente?\n\n"${label}"\n\nEla será removida da fila e revertida localmente.`
      )
    ) {
      return;
    }
    setBusyId(id);
    try {
      await cancelAction(id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) setModalOpen(false);
      }}
      className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
    >
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-200 flex flex-col max-h-[calc(100dvh-2rem)] overflow-hidden">
        {/* Cabeçalho */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                isOnline ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
              }`}
            >
              {isOnline ? <Cloud className="w-5 h-5" /> : <CloudOff className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-slate-900 text-sm sm:text-base truncate">
                Modo Offline e Fila de Envio
              </h3>
              <p className="text-xs text-slate-500">
                {isOnline ? "Conectado à internet" : "Sem conexão — salvando no aparelho"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(false)}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {sessionExpired && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span>
                Sua sessão expirou. Seus dados pendentes estão salvos com segurança no aparelho — faça
                login novamente para concluir o envio.
              </span>
            </div>
          )}

          {/* Status do Cache Local */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <Database className="w-4 h-4 text-emerald-600" />
                <span>Cache salvo no aparelho</span>
              </div>
              <button
                type="button"
                disabled={!isOnline || isBootstrapping}
                onClick={() => syncBootstrap(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 hover:border-emerald-400 text-xs font-bold text-slate-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isBootstrapping ? "animate-spin text-emerald-600" : ""}`} />
                <span>{isBootstrapping ? "Atualizando..." : "Atualizar cache"}</span>
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="bg-white rounded-xl p-2 border border-slate-100">
                <div className="text-sm font-black text-slate-900">{cachedCounts?.clientes ?? 0}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Clientes</div>
              </div>
              <div className="bg-white rounded-xl p-2 border border-slate-100">
                <div className="text-sm font-black text-slate-900">{cachedCounts?.emprestimos ?? 0}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Empréstimos</div>
              </div>
              <div className="bg-white rounded-xl p-2 border border-slate-100">
                <div className="text-sm font-black text-slate-900">{cachedCounts?.cheques ?? 0}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Cheques</div>
              </div>
              <div className="bg-white rounded-xl p-2 border border-slate-100">
                <div className="text-sm font-black text-slate-900">{cachedCounts?.parceiros ?? 0}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Parceiros</div>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Última atualização: <strong className="text-slate-700">{formatDateTime(lastSyncedAt)}</strong>
            </p>
          </div>

          {/* Fila de Operações Pendentes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">
                Ações pendentes ({pendingOps.length})
              </h4>
              {pendingOps.length > 0 && isOnline && !sessionExpired && (
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={() => syncOutbox()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSyncing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>{isSyncing ? "Sincronizando..." : "Sincronizar tudo"}</span>
                </button>
              )}
            </div>

            {pendingOps.length === 0 ? (
              <div className="p-6 text-center rounded-2xl border border-dashed border-slate-200 text-xs text-slate-500">
                Nenhuma ação pendente. Tudo está sincronizado com o servidor.
              </div>
            ) : (
              <div className="space-y-2">
                {pendingOps.map((op) => (
                  <div
                    key={op.operationId}
                    className={`p-3 rounded-2xl border text-xs space-y-2 ${
                      op.status === "error"
                        ? "bg-rose-50/70 border-rose-200"
                        : "bg-amber-50/50 border-amber-200/80"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-900 break-words">{op.label}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                          <Clock className="w-3 h-3" />
                          <span>
                            {new Intl.DateTimeFormat("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                              day: "2-digit",
                              month: "2-digit",
                            }).format(new Date(op.createdAt))}
                          </span>
                          <span>•</span>
                          <span
                            className={`font-bold ${
                              op.status === "error"
                                ? "text-rose-600"
                                : op.status === "syncing"
                                  ? "text-blue-600"
                                  : "text-amber-700"
                            }`}
                          >
                            {op.status === "error"
                              ? "Falha no envio"
                              : op.status === "syncing"
                                ? "Enviando..."
                                : "Aguardando conexão"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {op.lastError && (
                      <div className="text-[11px] text-rose-700 bg-white/80 rounded-lg px-2.5 py-1.5 border border-rose-200/70">
                        {op.lastError}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      {op.status === "error" && isOnline && (
                        <button
                          type="button"
                          disabled={isSyncing}
                          onClick={() => retryAction(op.operationId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Tentar novamente</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isSyncing || busyId === op.operationId}
                        onClick={() => handleCancel(op.operationId, op.label)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 font-bold transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Cancelar ação</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
