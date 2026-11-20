"use client";

import Link from "next/link";
import {
  CloudOff,
  Users,
  UserPlus,
  HandCoins,
  PlusCircle,
  BookOpenCheck,
  Handshake,
  Clock,
} from "lucide-react";
import { useOffline } from "@/components/offline/OfflineProvider";

export default function OfflinePage() {
  const { pendingCount, cachedCounts, setModalOpen } = useOffline();

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6 py-4">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm text-center space-y-3">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center">
          <CloudOff className="w-7 h-7" />
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900">
          Você está sem conexão
        </h1>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          Esta página precisa de internet para carregar, mas você pode continuar trabalhando
          normalmente nas telas com cache local abaixo. Todas as ações serão sincronizadas
          automaticamente quando o sinal voltar.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          href="/clientes"
          className="flex items-center gap-3.5 p-4 bg-white border border-slate-200 hover:border-emerald-400 rounded-2xl shadow-sm transition-all"
        >
          <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-900 text-sm">Clientes (Cache Local)</div>
            <div className="text-xs text-slate-500">
              {cachedCounts?.clientes ?? 0} salvos no aparelho
            </div>
          </div>
        </Link>

        <Link
          href="/emprestimos"
          className="flex items-center gap-3.5 p-4 bg-white border border-slate-200 hover:border-emerald-400 rounded-2xl shadow-sm transition-all"
        >
          <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <HandCoins className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-900 text-sm">Empréstimos (Cache Local)</div>
            <div className="text-xs text-slate-500">
              {cachedCounts?.emprestimos ?? 0} salvos no aparelho
            </div>
          </div>
        </Link>

        <Link
          href="/clientes/novo"
          className="flex items-center gap-3.5 p-4 bg-white border border-slate-200 hover:border-emerald-400 rounded-2xl shadow-sm transition-all"
        >
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <UserPlus className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-900 text-sm">Novo Cliente</div>
            <div className="text-xs text-slate-500">Cadastrar com foto/docs offline</div>
          </div>
        </Link>

        <Link
          href="/emprestimos/novo"
          className="flex items-center gap-3.5 p-4 bg-white border border-slate-200 hover:border-emerald-400 rounded-2xl shadow-sm transition-all"
        >
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <PlusCircle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-900 text-sm">Novo Empréstimo</div>
            <div className="text-xs text-slate-500">Inclusive para clientes pendentes</div>
          </div>
        </Link>

        <Link
          href="/cheques"
          className="flex items-center gap-3.5 p-4 bg-white border border-slate-200 hover:border-emerald-400 rounded-2xl shadow-sm transition-all"
        >
          <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
            <BookOpenCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-900 text-sm">Cheques</div>
            <div className="text-xs text-slate-500">
              {cachedCounts?.cheques ?? 0} salvos no aparelho
            </div>
          </div>
        </Link>

        <Link
          href="/parceiros"
          className="flex items-center gap-3.5 p-4 bg-white border border-slate-200 hover:border-emerald-400 rounded-2xl shadow-sm transition-all"
        >
          <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
            <Handshake className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-900 text-sm">Parceiros</div>
            <div className="text-xs text-slate-500">
              {cachedCounts?.parceiros ?? 0} salvos no aparelho
            </div>
          </div>
        </Link>
      </div>

      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-3.5 px-5 rounded-2xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-sm font-bold transition-colors cursor-pointer"
      >
        <Clock className="w-4 h-4" />
        <span>
          Ver fila pendente ({pendingCount} {pendingCount === 1 ? "ação" : "ações"})
        </span>
      </button>
    </div>
  );
}
