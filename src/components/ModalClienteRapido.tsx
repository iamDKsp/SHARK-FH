"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { X, UserPlus, Loader2, Info, AlertCircle, CheckCircle2, Phone } from "lucide-react";
import { generateUuid, useOffline } from "@/components/offline/OfflineProvider";

export interface ClienteRapidoCriado {
  id: string;
  nome: string;
  rawNome: string;
  telefone: string;
  pendingSync: boolean;
}

interface ClienteExistenteRef {
  id: string;
  nome: string;
  rawNome?: string;
  telefone: string;
}

interface ModalClienteRapidoProps {
  isOpen: boolean;
  initialSearch?: string;
  clientesExistentes: ClienteExistenteRef[];
  onClose: () => void;
  onCreated: (cliente: ClienteRapidoCriado) => void;
  onSelectExisting?: (clienteId: string) => void;
}

const normalizePhoneDigits = (raw: string) => {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length > 11 && digits.startsWith("55")) {
    return digits.slice(2);
  }
  return digits;
};

function parseInitialSearch(initialSearch: string): { nome: string; telefone: string } {
  const trimmed = initialSearch.trim();
  if (!trimmed) return { nome: "", telefone: "" };
  const hasLetters = /[a-zA-ZÀ-ÿ]/.test(trimmed);
  const hasDigits = /\d/.test(trimmed);
  return {
    nome: hasLetters ? trimmed : "",
    telefone: !hasLetters && hasDigits ? trimmed : "",
  };
}

export default function ModalClienteRapido(props: ModalClienteRapidoProps) {
  if (!props.isOpen) return null;
  return <ModalClienteRapidoDialog {...props} />;
}

function ModalClienteRapidoDialog({
  initialSearch = "",
  clientesExistentes,
  onClose,
  onCreated,
  onSelectExisting,
}: ModalClienteRapidoProps) {
  const { isOnline, enqueueOfflineAction, showToast } = useOffline();

  const initialValues = useMemo(() => parseInitialSearch(initialSearch), [initialSearch]);

  const [nome, setNome] = useState(initialValues.nome);
  const [telefone, setTelefone] = useState(initialValues.telefone);
  const [cidade, setCidade] = useState("Bauru");
  const [documento, setDocumento] = useState("");
  const [quemIndicou, setQuemIndicou] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [closing, setClosing] = useState(false);

  const nomeInputRef = useRef<HTMLInputElement>(null);
  const telefoneInputRef = useRef<HTMLInputElement>(null);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 140);
  }, [isSaving, onClose]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (initialValues.nome && !initialValues.telefone) {
        telefoneInputRef.current?.focus();
      } else {
        nomeInputRef.current?.focus();
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [initialValues.nome, initialValues.telefone]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSaving, handleClose]);

  const clienteDuplicado = useMemo(() => {
    const digits = normalizePhoneDigits(telefone);
    if (digits.length < 8) return null;
    return (
      clientesExistentes.find((c) => {
        const existingDigits = normalizePhoneDigits(c.telefone);
        return existingDigits.length >= 8 && existingDigits === digits;
      }) || null
    );
  }, [telefone, clientesExistentes]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const nomeTrim = nome.trim();
    const telefoneRaw = telefone.trim();
    const telefoneDigits = telefoneRaw.replace(/\D/g, "");
    const cidadeTrim = cidade.trim() || "Bauru";
    const documentoTrim = documento.trim();
    const quemIndicouTrim = quemIndicou.trim();

    if (!nomeTrim) {
      setErro("Informe o nome completo do cliente.");
      nomeInputRef.current?.focus();
      return;
    }

    if (!telefoneDigits) {
      setErro("Informe um telefone (WhatsApp) válido com números.");
      telefoneInputRef.current?.focus();
      return;
    }

    setErro(null);
    setIsSaving(true);

    try {
      const entityId = generateUuid();
      const res = await enqueueOfflineAction(
        {
          type: "CREATE_CLIENTE",
          entityId,
          label: `Novo cliente: ${nomeTrim}`,
          payload: {
            nome: nomeTrim,
            telefone: telefoneRaw,
            cidade: cidadeTrim,
            documento: documentoTrim,
            endereco: null,
            referencia: null,
            quemIndicou: quemIndicouTrim || null,
            email: null,
            observacoes: null,
            blacklist: false,
            fotoBase64: null,
            documentosBase64: null,
          },
        },
        { tryImmediateSync: true }
      );

      if (res.syncedImmediately) {
        showToast(`Cliente "${nomeTrim}" cadastrado e selecionado!`);
      }

      onCreated({
        id: entityId,
        nome: res.syncedImmediately ? nomeTrim : `${nomeTrim} (Pendente)`,
        rawNome: nomeTrim,
        telefone: telefoneDigits,
        pendingSync: !res.syncedImmediately,
      });

      setClosing(true);
      setTimeout(() => {
        setClosing(false);
        setIsSaving(false);
        onClose();
      }, 140);
    } catch (err) {
      console.error("Erro ao criar cliente rápido:", err);
      setErro("Não foi possível cadastrar o cliente. Tente novamente.");
      setIsSaving(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) handleClose();
      }}
      className={`fixed inset-0 z-[95] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm ${
        closing ? "motion-modal-backdrop-out" : "motion-modal-backdrop-in"
      }`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-cliente-rapido-title"
        onClick={(e) => e.stopPropagation()}
        className={`bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[calc(100dvh-2rem)] ${
          closing ? "motion-modal-card-out" : "motion-modal-card-in"
        }`}
      >
        {/* Cabeçalho */}
        <div className="p-5 border-b border-slate-100 flex justify-between items-start bg-emerald-50/70 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0">
              <UserPlus className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3
                id="modal-cliente-rapido-title"
                className="font-black text-slate-900 text-sm sm:text-base"
              >
                Cadastro rápido de cliente
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Crie o cliente agora e já vincule a este empréstimo.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSaving}
            aria-label="Fechar"
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corpo do formulário */}
        <form
          id="form-cliente-rapido"
          onSubmit={handleSubmit}
          className="p-5 sm:p-6 space-y-4 overflow-y-auto"
        >
          {erro && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold animate-in fade-in slide-in-from-top-1 duration-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <span>{erro}</span>
            </div>
          )}

          {/* Nome completo */}
          <div className="space-y-1.5">
            <label
              htmlFor="rapido-nome"
              className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1"
            >
              Nome completo <span className="text-rose-500">*</span>
            </label>
            <input
              ref={nomeInputRef}
              type="text"
              id="rapido-nome"
              required
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                if (erro) setErro(null);
              }}
              placeholder="Ex: João da Silva"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white text-slate-900 font-medium transition-colors"
            />
          </div>

          {/* Telefone e Cidade */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="rapido-telefone"
                className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1"
              >
                Telefone (WhatsApp) <span className="text-rose-500">*</span>
              </label>
              <input
                ref={telefoneInputRef}
                type="tel"
                inputMode="tel"
                id="rapido-telefone"
                required
                value={telefone}
                onChange={(e) => {
                  setTelefone(e.target.value);
                  if (erro) setErro(null);
                }}
                placeholder="(00) 00000-0000"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white text-slate-900 font-medium transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="rapido-cidade"
                className="text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                Cidade
              </label>
              <input
                type="text"
                id="rapido-cidade"
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                placeholder="Bauru"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white text-slate-900 font-medium transition-colors"
              />
            </div>
          </div>

          {/* Alerta suave caso o telefone já pertença a um cliente cadastrado */}
          {clienteDuplicado && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs animate-in fade-in slide-in-from-top-1 duration-200">
              <div className="flex items-start gap-2">
                <Phone className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Telefone já cadastrado</p>
                  <p className="text-amber-800 mt-0.5">
                    Já existe um cliente com este número:{" "}
                    <strong>{clienteDuplicado.rawNome || clienteDuplicado.nome}</strong>.
                  </p>
                </div>
              </div>
              {onSelectExisting && (
                <button
                  type="button"
                  onClick={() => {
                    onSelectExisting(clienteDuplicado.id);
                    handleClose();
                  }}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-colors cursor-pointer btn-press"
                >
                  Usar existente
                </button>
              )}
            </div>
          )}

          {/* Campos opcionais rápidos: CPF/RG e Quem indicou */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="rapido-documento"
                className="text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                CPF / RG <span className="text-slate-400 font-normal normal-case">(opcional)</span>
              </label>
              <input
                type="text"
                id="rapido-documento"
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                placeholder="000.000.000-00"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white text-slate-900 font-medium transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="rapido-quem-indicou"
                className="text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                Quem indicou <span className="text-slate-400 font-normal normal-case">(opcional)</span>
              </label>
              <input
                type="text"
                id="rapido-quem-indicou"
                value={quemIndicou}
                onChange={(e) => setQuemIndicou(e.target.value)}
                placeholder="Indicação"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white text-slate-900 font-medium transition-colors"
              />
            </div>
          </div>

          {/* Nota informativa */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-600">
            <Info className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Cadastro simplificado. Endereço, foto, documentos e demais dados podem ser completados
              depois na aba <strong className="text-slate-800">Clientes</strong>.
              {!isOnline && (
                <>
                  {" "}
                  Você está <strong className="text-slate-800">offline</strong> — o cliente será
                  sincronizado automaticamente ao reconectar.
                </>
              )}
            </p>
          </div>
        </form>

        {/* Rodapé */}
        <div className="p-4 sm:p-5 border-t border-slate-100 bg-white flex flex-col-reverse sm:flex-row justify-end gap-2.5 shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSaving}
            className="w-full sm:w-auto px-5 py-2.5 text-xs sm:text-sm font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer disabled:opacity-50 text-center"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="form-cliente-rapido"
            disabled={isSaving}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl text-xs sm:text-sm font-black shadow-md shadow-emerald-600/20 transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>{isSaving ? "Cadastrando..." : "Criar e vincular cliente"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
