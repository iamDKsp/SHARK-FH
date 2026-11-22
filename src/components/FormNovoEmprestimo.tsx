"use client";

import Link from "next/link";
import { ArrowLeft, Loader2, User, UserPlus, CheckCircle2 } from "lucide-react";
import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import SearchableSelect from "@/components/SearchableSelect";
import ModalClienteRapido, {
  type ClienteExistenteVinculado,
  type ClienteRapidoCriado,
} from "@/components/ModalClienteRapido";
import {
  EmprestimoCamposCompletos,
  ConfirmarWhatsappEmprestimoModal,
  OverlayCriacaoEmprestimo,
  useEmprestimoFormState,
  formatBRL,
  type ParceiroOption,
} from "@/components/EmprestimoFormSections";
import { generateUuid, useOffline } from "@/components/offline/OfflineProvider";

interface Cliente {
  id: string;
  nome: string;
  rawNome?: string;
  telefone: string;
  pendingSync?: boolean;
}

interface FormNovoEmprestimoProps {
  clientes: Cliente[];
  parceiros: ParceiroOption[];
  clienteIdParam?: string;
}

export default function FormNovoEmprestimo({
  clientes,
  parceiros,
  clienteIdParam,
}: FormNovoEmprestimoProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { isOnline, enqueueOfflineAction } = useOffline();

  const empState = useEmprestimoFormState();

  // Overlay Animado States
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayStep, setOverlayStep] = useState(0);

  // Cliente & Cadastro Rápido
  const [clienteId, setClienteId] = useState(clienteIdParam || "");
  const [clientesLocais, setClientesLocais] = useState<Cliente[]>([]);
  const [showQuickClientModal, setShowQuickClientModal] = useState(false);
  const [quickClientInitialSearch, setQuickClientInitialSearch] = useState("");
  const [recentQuickClientId, setRecentQuickClientId] = useState<string | null>(null);
  const [autoLinkedClient, setAutoLinkedClient] = useState<ClienteExistenteVinculado | null>(null);
  const [showConfirmWaModal, setShowConfirmWaModal] = useState(false);

  // Mescla clientes do cache/servidor com recém-criados para seleção imediata sem flicker
  const todosClientes = useMemo(() => {
    const map = new Map<string, Cliente>();
    for (const c of clientes) map.set(c.id, c);
    for (const c of clientesLocais) {
      if (!map.has(c.id)) map.set(c.id, c);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (Boolean(a.pendingSync) !== Boolean(b.pendingSync)) return a.pendingSync ? -1 : 1;
      return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
    });
  }, [clientes, clientesLocais]);

  const openQuickClientModal = (initialSearch = "") => {
    setQuickClientInitialSearch(initialSearch);
    setShowQuickClientModal(true);
  };

  const handleQuickClientCreated = (novo: ClienteRapidoCriado) => {
    setClientesLocais((prev) => {
      const semDuplicado = prev.filter((c) => c.id !== novo.id);
      return [
        ...semDuplicado,
        {
          id: novo.id,
          nome: novo.nome,
          rawNome: novo.rawNome,
          telefone: novo.telefone,
          pendingSync: novo.pendingSync,
        },
      ];
    });
    setClienteId(novo.id);
    setRecentQuickClientId(novo.id);
    setAutoLinkedClient(null);
  };

  const handleExistingClientLinked = (existente: ClienteExistenteVinculado) => {
    setClientesLocais((prev) => {
      if (
        clientes.some((c) => c.id === existente.id) ||
        prev.some((c) => c.id === existente.id)
      ) {
        return prev;
      }
      return [
        ...prev,
        {
          id: existente.id,
          nome: existente.nome,
          rawNome: existente.nome,
          telefone: existente.telefone,
          pendingSync: false,
        },
      ];
    });
    setClienteId(existente.id);
    setRecentQuickClientId(null);
    setAutoLinkedClient(existente);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!clienteId) {
      alert("Selecione uma pessoa (cliente) para o empréstimo.");
      return;
    }
    if (empState.valor <= 0) {
      alert("Informe um valor principal válido para o empréstimo.");
      return;
    }
    setShowConfirmWaModal(true);
  };

  const executarCriacao = (avisarNoWhats: boolean) => {
    empState.setEnviarPdfWhatsapp(avisarNoWhats);
    setShowConfirmWaModal(false);

    setShowOverlay(true);
    setOverlayStep(1); // Processando e calculando parcelas

    const cli = todosClientes.find((c) => c.id === clienteId);
    const parc = parceiros.find((p) => p.id === empState.parceiroId);

    startTransition(async () => {
      try {
        const entityId = generateUuid();
        const clienteNomeReal = cli?.rawNome || cli?.nome || "Cliente";

        const res = await enqueueOfflineAction(
          {
            type: "CREATE_EMPRESTIMO",
            entityId,
            dependsOnEntityId: cli?.pendingSync ? cli.id : undefined,
            label: `Novo empréstimo: ${formatBRL(empState.valor)} — ${clienteNomeReal}`,
            payload: {
              clienteId,
              clienteNome: clienteNomeReal,
              clienteTelefone: cli?.telefone || "",
              parceiroId: empState.parceiroId || null,
              parceiroNome: parc?.nome || null,
              valorEmprestado: empState.valor,
              tipoPagamento: empState.tipoPagamento,
              frequencia: empState.frequencia,
              taxaJuros: empState.tipoPagamento === "a_vista" ? 0 : empState.taxaJuros,
              atrasoTipo: empState.atrasoTipo,
              atrasoValor: empState.atrasoValor,
              dataInicio: empState.dataInicio,
              dataVencimento: empState.dataVencimentoFinal,
              categoria: empState.categoria || "Sem categoria",
              observacoes: empState.observacoes || null,
              parcelas: empState.parcelasFinais,
              enviarPdfWhatsapp: avisarNoWhats,
            },
          },
          { tryImmediateSync: true }
        );

        setOverlayStep(2); // Sucesso
        if (res.syncedImmediately) {
          router.push(`/emprestimos/${entityId}`);
        } else {
          router.push(`/offline/emprestimo?id=${encodeURIComponent(entityId)}`);
        }
      } catch (err) {
        console.error("Erro ao salvar empréstimo:", err);
        alert("Erro ao salvar empréstimo.");
        setShowOverlay(false);
      }
    });
  };

  const cliSelecionado = todosClientes.find((c) => c.id === clienteId);

  return (
    <div className="w-full max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto space-y-6">
      {/* Voltar */}
      <Link
        href="/emprestimos"
        className="flex items-center space-x-1.5 text-slate-500 hover:text-slate-900 text-sm font-medium transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Voltar para Empréstimos</span>
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Novo empréstimo</h1>
        <p className="text-slate-500">Configure os parâmetros do novo empréstimo em dinheiro.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 pb-20">
        {/* Seção 1: Cliente */}
        <div className="premium-card bg-white border border-slate-200 shadow-md rounded-2xl relative transition-shadow hover:shadow-lg z-10">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-emerald-500 rounded-l-2xl"></div>
          <div className="p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-emerald-50 rounded-xl">
                <User className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-800 tracking-tight">
                  Dados do Cliente
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Vincule o empréstimo a uma pessoa e parceiro.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 min-h-[28px]">
                  <label
                    htmlFor="clienteId"
                    className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1"
                  >
                    Pessoa <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => openQuickClientModal("")}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 hover:border-emerald-300 px-2.5 py-1 rounded-lg shadow-2xs transition-all cursor-pointer btn-press"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Novo cliente</span>
                  </button>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-emerald-500 hover:border-emerald-400 transition-colors">
                  <SearchableSelect
                    name="clienteId"
                    value={clienteId}
                    onChange={(id) => {
                      setClienteId(id);
                      if (id !== recentQuickClientId) setRecentQuickClientId(null);
                      if (id !== autoLinkedClient?.id) setAutoLinkedClient(null);
                    }}
                    options={todosClientes}
                    placeholder="Selecione uma pessoa..."
                    onCreateNew={(q) => openQuickClientModal(q)}
                    createNewLabel="Cadastrar cliente rápido"
                  />
                </div>
                {recentQuickClientId && clienteId === recentQuickClientId && (
                  <p className="text-xs text-emerald-700 font-semibold flex items-center gap-1.5 pt-0.5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600 animate-pop" />
                    <span>
                      Cliente criado e vinculado! Você pode completar o cadastro na aba Clientes
                      depois.
                    </span>
                  </p>
                )}
                {autoLinkedClient && clienteId === autoLinkedClient.id && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 font-semibold flex items-start gap-1.5 mt-1 animate-in fade-in slide-in-from-top-1 duration-200">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-amber-600 mt-0.5" />
                    <span>
                      Já existia um cliente com este telefone —{" "}
                      <strong>{autoLinkedClient.nome}</strong> foi vinculado automaticamente (sem
                      criar duplicado).
                    </span>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center min-h-[28px]">
                  <label
                    htmlFor="parceiroId"
                    className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1"
                  >
                    Quem Emprestou? <span className="text-rose-500">*</span>
                  </label>
                </div>
                <select
                  id="parceiroId"
                  name="parceiroId"
                  value={empState.parceiroId}
                  onChange={(e) => empState.setParceiroId(e.target.value)}
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
        </div>

        {/* Seções completas do empréstimo */}
        <EmprestimoCamposCompletos
          state={empState}
          parceiros={parceiros}
          showParceiroSection={false}
        />

        {/* Ações */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-6 mt-8 border-t border-slate-200">
          <Link
            href="/emprestimos"
            className="w-full sm:w-auto text-center px-6 py-3.5 bg-white text-slate-600 border border-slate-200 rounded-xl text-sm font-black tracking-wide hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="w-full sm:w-auto flex items-center justify-center space-x-2 bg-emerald-600 text-white px-8 py-3.5 rounded-xl text-sm font-black tracking-wide hover:bg-emerald-700 hover:shadow-lg hover:shadow-emerald-500/20 transition-all disabled:opacity-50 disabled:hover:shadow-none shadow-md transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
          >
            {isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-5 h-5" />
            )}
            <span>{isPending ? "Processando..." : "Criar Empréstimo"}</span>
          </button>
        </div>
      </form>

      {/* Modal de Cadastro Rápido de Cliente */}
      <ModalClienteRapido
        isOpen={showQuickClientModal}
        initialSearch={quickClientInitialSearch}
        clientesExistentes={todosClientes}
        onClose={() => setShowQuickClientModal(false)}
        onCreated={handleQuickClientCreated}
        onSelectExisting={handleExistingClientLinked}
      />

      {/* Modal de Confirmação: Avisar ou não no WhatsApp ao criar empréstimo */}
      <ConfirmarWhatsappEmprestimoModal
        isOpen={showConfirmWaModal}
        clienteNome={cliSelecionado?.rawNome || cliSelecionado?.nome || ""}
        valorEmprestado={empState.valor}
        totalEstimado={empState.totalSimulado}
        dataVencimento={empState.dataVencimentoFinal}
        isOnline={isOnline}
        isPending={isPending}
        onConfirm={executarCriacao}
        onClose={() => setShowConfirmWaModal(false)}
      />

      {/* Overlay Animado de Criação */}
      <OverlayCriacaoEmprestimo isOpen={showOverlay} step={overlayStep} />
    </div>
  );
}
