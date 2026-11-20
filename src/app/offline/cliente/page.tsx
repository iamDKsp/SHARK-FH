"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Edit3,
  Trash2,
  Plus,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Clock,
  Save,
  X,
} from "lucide-react";
import { useOffline } from "@/components/offline/OfflineProvider";
import { getAllClientes, getAllEmprestimos } from "@/lib/offline/db";
import { applyPendingToClientes, applyPendingToEmprestimos } from "@/lib/offline/applyPending";
import type { CachedCliente, CachedEmprestimo } from "@/lib/offline/types";
import EmprestimosClienteCard, { type EmprestimoClienteItem } from "@/components/EmprestimosClienteCard";
import { hojeEmBrasilia } from "@/lib/dateUtils";

function resolveClientIdFromUrl(): string {
  if (typeof window === "undefined") return "";
  const sp = new URLSearchParams(window.location.search);
  const qId = sp.get("id");
  if (qId) return qId;
  const m = window.location.pathname.match(/^\/clientes\/([^/]+)/);
  return m && m[1] !== "novo" ? m[1] : "";
}

export default function OfflineClientePage() {
  const router = useRouter();
  const { session, pendingOps, dataRevision, enqueueOfflineAction } = useOffline();
  const [clienteId, setClienteId] = useState("");
  const [clientes, setClientes] = useState<CachedCliente[]>([]);
  const [emprestimos, setEmprestimos] = useState<CachedEmprestimo[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal de edição rápida offline
  const [editOpen, setEditOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editNome, setEditNome] = useState("");
  const [editTelefone, setEditTelefone] = useState("");
  const [editCidade, setEditCidade] = useState("");
  const [editDocumento, setEditDocumento] = useState("");
  const [editEndereco, setEditEndereco] = useState("");
  const [editReferencia, setEditReferencia] = useState("");
  const [editQuemIndicou, setEditQuemIndicou] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editObservacoes, setEditObservacoes] = useState("");
  const [editBlacklist, setEditBlacklist] = useState(false);

  useEffect(() => {
    setClienteId(resolveClientIdFromUrl());
  }, []);

  useEffect(() => {
    const uid = session?.userId || "local";
    let cancelled = false;
    setLoading(true);
    Promise.all([getAllClientes(uid).catch(() => []), getAllEmprestimos(uid).catch(() => [])])
      .then(([cls, emps]) => {
        if (!cancelled) {
          setClientes(cls);
          setEmprestimos(emps);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.userId, dataRevision]);

  const cliente = useMemo(() => {
    const list = applyPendingToClientes(clientes, pendingOps);
    return list.find((c) => c.id === clienteId) || null;
  }, [clientes, pendingOps, clienteId]);

  const emprestimosDoCliente = useMemo(() => {
    const list = applyPendingToEmprestimos(emprestimos, pendingOps);
    return list.filter((e) => e.cliente_id === clienteId);
  }, [emprestimos, pendingOps, clienteId]);

  const openEditModal = () => {
    if (!cliente) return;
    setEditNome(cliente.nome);
    setEditTelefone(cliente.telefone);
    setEditCidade(cliente.cidade || "Bauru");
    setEditDocumento(cliente.documento || "");
    setEditEndereco(cliente.endereco || "");
    setEditReferencia(cliente.referencia || "");
    setEditQuemIndicou(cliente.quem_indicou || "");
    setEditEmail(cliente.email || "");
    setEditObservacoes(cliente.observacoes || "");
    setEditBlacklist(Boolean(cliente.blacklist));
    setEditOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cliente) return;
    setSavingEdit(true);
    try {
      await enqueueOfflineAction(
        {
          type: "UPDATE_CLIENTE",
          entityId: cliente.id,
          dependsOnEntityId: cliente.pendingSync ? cliente.id : undefined,
          label: `Editar cliente — ${editNome.trim()}`,
          payload: {
            id: cliente.id,
            nome: editNome.trim(),
            telefone: editTelefone,
            cidade: editCidade || "Bauru",
            documento: editDocumento || "",
            endereco: editEndereco || null,
            referencia: editReferencia || null,
            quemIndicou: editQuemIndicou || null,
            email: editEmail || null,
            observacoes: editObservacoes || null,
            blacklist: editBlacklist,
            fotoBase64: null,
            documentosBase64: null,
          },
        },
        { tryImmediateSync: true }
      );
      setEditOpen(false);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleBlacklist = async () => {
    if (!cliente) return;
    await enqueueOfflineAction(
      {
        type: "TOGGLE_CLIENT_BLACKLIST",
        entityId: cliente.id,
        dependsOnEntityId: cliente.pendingSync ? cliente.id : undefined,
        label: `${cliente.blacklist ? "Remover da lista negra" : "Adicionar à lista negra"} — ${cliente.nome}`,
        payload: {
          clientId: cliente.id,
          currentStatus: cliente.blacklist,
        },
      },
      { tryImmediateSync: true }
    );
  };

  const handleDelete = async () => {
    if (!cliente) return;
    if (!window.confirm(`Tem certeza que deseja excluir ${cliente.nome}?`)) return;
    await enqueueOfflineAction(
      {
        type: "DELETE_CLIENTE",
        entityId: cliente.id,
        dependsOnEntityId: cliente.pendingSync ? cliente.id : undefined,
        label: `Excluir cliente — ${cliente.nome}`,
        payload: { clienteId: cliente.id, clienteNome: cliente.nome },
      },
      { tryImmediateSync: true }
    );
    router.push("/clientes");
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-2">
        <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
        <span className="text-xs text-slate-500">Carregando dados do cache local...</span>
      </div>
    );
  }

  if (!cliente) {
    return (
      <div className="max-w-xl mx-auto bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4">
        <p className="text-sm font-bold text-slate-800">Cliente não encontrado no cache local.</p>
        <Link
          href="/clientes"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para Clientes
        </Link>
      </div>
    );
  }

  const hojeUTC = hojeEmBrasilia();
  const formatData = (date: string | Date) =>
    new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(date));

  const emprestimosItems: EmprestimoClienteItem[] = emprestimosDoCliente.map((emp) => {
    const principal = Number(emp.valor_emprestado);
    const juros = Number(emp.taxa_juros);
    const temParcelas = emp.parcelas && emp.parcelas.length > 0;
    const parcelasAbertas = temParcelas ? emp.parcelas.filter((p) => p.status === "aberto") : [];
    const prox = parcelasAbertas[0];
    const vencRef = prox ? prox.data_vencimento : emp.data_vencimento;
    const vencObj = new Date(vencRef);
    const vencUTC = new Date(Date.UTC(vencObj.getUTCFullYear(), vencObj.getUTCMonth(), vencObj.getUTCDate()));
    const quitado = emp.status.startsWith("quitado") || (temParcelas && parcelasAbertas.length === 0);
    const estaAtrasado =
      !quitado &&
      emp.status === "ativo" &&
      (temParcelas
        ? parcelasAbertas.some((p) => {
            const d = new Date(p.data_vencimento);
            return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) < hojeUTC.getTime();
          })
        : vencUTC < hojeUTC);
    const venceHoje =
      !quitado &&
      !estaAtrasado &&
      emp.status === "ativo" &&
      vencUTC.getTime() === hojeUTC.getTime();
    const totalExibido =
      !quitado && temParcelas
        ? parcelasAbertas.reduce((acc, p) => acc + Number(p.valor), 0)
        : principal * (1 + juros / 100);

    return {
      id: emp.id,
      vencimento: formatData(vencRef),
      dataInicio: emp.data_inicio,
      situacao: quitado ? "quitado" : estaAtrasado ? "atrasado" : venceHoje ? "hoje" : "em_dia",
      status: emp.status,
      tipoPagamento: emp.tipo_pagamento,
      frequencia: emp.frequencia,
      principal,
      total: totalExibido,
      valorJuros: Math.max(0, totalExibido - principal),
      taxaJuros: juros,
      taxaMulta: Number(emp.taxa_multa || 0),
      atrasoTipo: emp.atraso_tipo,
      atrasoValor: emp.atraso_valor,
      observacoes: emp.observacoes,
      parcelas: emp.parcelas.map((p) => ({
        numero: p.numero,
        valor: Number(p.valor),
        data_vencimento: p.data_vencimento,
        status: p.status,
        data_pagamento: p.data_pagamento,
      })),
    };
  });

  const iniciais = cliente.nome
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-6 w-full max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/clientes"
          className="flex items-center space-x-1.5 text-slate-500 hover:text-slate-900 text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar para Clientes</span>
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openEditModal}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl cursor-pointer"
            title="Editar Cliente"
          >
            <Edit3 className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={handleToggleBlacklist}
            className={`p-2 rounded-xl cursor-pointer ${
              cliente.blacklist
                ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
            title={cliente.blacklist ? "Remover da lista negra" : "Adicionar à lista negra"}
          >
            {cliente.blacklist ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl cursor-pointer"
            title="Excluir Cliente"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Cabeçalho */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col items-center text-center shadow-sm">
        {cliente.foto_url ? (
          <img
            src={cliente.foto_url}
            alt={cliente.nome}
            className="w-20 h-20 rounded-full object-cover border-2 border-emerald-500"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-emerald-600 text-white font-bold text-xl flex items-center justify-center">
            {iniciais}
          </div>
        )}
        <h1 className="text-xl font-bold text-slate-900 mt-3">{cliente.nome}</h1>
        <p className="text-sm text-slate-500">{cliente.telefone}</p>

        <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
          {cliente.pendingSync && (
            <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-1 rounded-full">
              <Clock className="w-3 h-3" /> Pendente de envio
            </span>
          )}
          {cliente.blacklist && (
            <span className="bg-rose-100 text-rose-700 text-xs font-bold px-2.5 py-1 rounded-full uppercase">
              Lista Negra
            </span>
          )}
        </div>

        <Link
          href={`/emprestimos/novo?clienteId=${encodeURIComponent(cliente.id)}`}
          className="mt-4 inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Novo empréstimo para este cliente</span>
        </Link>
      </div>

      {/* Dados */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <span className="block text-[11px] font-bold text-slate-400 uppercase">CPF / RG</span>
          <span className="text-slate-800 font-medium">{cliente.documento || "Não cadastrado"}</span>
        </div>
        <div>
          <span className="block text-[11px] font-bold text-slate-400 uppercase">Cidade</span>
          <span className="text-slate-800 font-medium">{cliente.cidade || "Não informada"}</span>
        </div>
        <div className="sm:col-span-2">
          <span className="block text-[11px] font-bold text-slate-400 uppercase">Endereço</span>
          <span className="text-slate-800 font-medium">{cliente.endereco || "Não cadastrado"}</span>
        </div>
        <div>
          <span className="block text-[11px] font-bold text-slate-400 uppercase">Referência</span>
          <span className="text-slate-800 font-medium">{cliente.referencia || "Não cadastrado"}</span>
        </div>
        <div>
          <span className="block text-[11px] font-bold text-slate-400 uppercase">Quem indicou</span>
          <span className="text-slate-800 font-medium">{cliente.quem_indicou || "Não indicado"}</span>
        </div>
        {cliente.observacoes && (
          <div className="sm:col-span-2">
            <span className="block text-[11px] font-bold text-slate-400 uppercase">Observações</span>
            <span className="text-slate-700 whitespace-pre-line">{cliente.observacoes}</span>
          </div>
        )}
      </div>

      {/* Empréstimos do cliente (reaproveita EmprestimosClienteCard com ações em massa) */}
      <EmprestimosClienteCard
        clienteId={cliente.id}
        clienteNome={cliente.nome}
        clienteTelefone={cliente.telefone}
        clienteDocumento={cliente.documento}
        emprestimos={emprestimosItems}
      />

      {/* Modal de edição offline */}
      {editOpen && (
        <div className="fixed inset-0 z-[95] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3">
          <form
            onSubmit={handleSaveEdit}
            className="bg-white rounded-3xl w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden shadow-2xl border border-slate-200"
          >
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="font-black text-slate-900 text-sm">Editar Cliente</h3>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto text-sm">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Nome *</label>
                <input
                  required
                  value={editNome}
                  onChange={(e) => setEditNome(e.target.value)}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Telefone *</label>
                  <input
                    required
                    value={editTelefone}
                    onChange={(e) => setEditTelefone(e.target.value)}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Cidade</label>
                  <input
                    value={editCidade}
                    onChange={(e) => setEditCidade(e.target.value)}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">CPF / RG</label>
                  <input
                    value={editDocumento}
                    onChange={(e) => setEditDocumento(e.target.value)}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Quem indicou</label>
                  <input
                    value={editQuemIndicou}
                    onChange={(e) => setEditQuemIndicou(e.target.value)}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Endereço</label>
                <input
                  value={editEndereco}
                  onChange={(e) => setEditEndereco(e.target.value)}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Referência</label>
                  <input
                    value={editReferencia}
                    onChange={(e) => setEditReferencia(e.target.value)}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase">Email</label>
                  <input
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase">Observações</label>
                <textarea
                  rows={2}
                  value={editObservacoes}
                  onChange={(e) => setEditObservacoes(e.target.value)}
                  className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-bold text-rose-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editBlacklist}
                  onChange={(e) => setEditBlacklist(e.target.checked)}
                />
                Lista Negra (Bloqueado)
              </label>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{savingEdit ? "Salvando..." : "Salvar"}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
