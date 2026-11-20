"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useOffline } from "@/components/offline/OfflineProvider";
import { getAllEmprestimos, getCachedConfig } from "@/lib/offline/db";
import { applyPendingToEmprestimos } from "@/lib/offline/applyPending";
import type { CachedConfig, CachedEmprestimo } from "@/lib/offline/types";
import EmprestimoDetalhesView from "@/components/EmprestimoDetalhesView";

function resolveEmprestimoIdFromUrl(): string {
  if (typeof window === "undefined") return "";
  const sp = new URLSearchParams(window.location.search);
  const qId = sp.get("id");
  if (qId) return qId;
  const m = window.location.pathname.match(/^\/emprestimos\/([^/]+)/);
  return m && m[1] !== "novo" ? m[1] : "";
}

export default function OfflineEmprestimoPage() {
  const { session, pendingOps, dataRevision } = useOffline();
  const [empId, setEmpId] = useState("");
  const [emprestimos, setEmprestimos] = useState<CachedEmprestimo[]>([]);
  const [config, setConfig] = useState<CachedConfig>({
    regra_carencia_30_dias: false,
    regra_carencia_10_dias: false,
    perguntar_whatsapp_renovacao: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setEmpId(resolveEmprestimoIdFromUrl());
  }, []);

  useEffect(() => {
    const uid = session?.userId || "local";
    let cancelled = false;
    setLoading(true);
    Promise.all([getAllEmprestimos(uid).catch(() => []), getCachedConfig(uid)])
      .then(([emps, cfg]) => {
        if (!cancelled) {
          setEmprestimos(emps);
          setConfig(cfg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.userId, dataRevision]);

  const emprestimo = useMemo(() => {
    const list = applyPendingToEmprestimos(emprestimos, pendingOps);
    return list.find((e) => e.id === empId) || null;
  }, [emprestimos, pendingOps, empId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-2">
        <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
        <span className="text-xs text-slate-500">Carregando empréstimo do cache local...</span>
      </div>
    );
  }

  if (!emprestimo) {
    return (
      <div className="max-w-xl mx-auto bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4">
        <p className="text-sm font-bold text-slate-800">Empréstimo não encontrado no cache local.</p>
        <Link
          href="/emprestimos"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para Empréstimos
        </Link>
      </div>
    );
  }

  const adapted = {
    ...emprestimo,
    cliente: {
      id: emprestimo.cliente.id,
      nome: emprestimo.cliente.nome,
      telefone: emprestimo.cliente.telefone,
      blacklist: Boolean(emprestimo.cliente.blacklist),
      foto_url: null,
    },
  };

  return (
    <EmprestimoDetalhesView
      emprestimo={adapted as any}
      perguntarWhatsappRenovacao={config.perguntar_whatsapp_renovacao}
      modoCarencia={config.regra_carencia_30_dias}
      modoCarencia10={config.regra_carencia_10_dias}
    />
  );
}
