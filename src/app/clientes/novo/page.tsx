"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Save,
  X,
  Image as ImageIcon,
  Paperclip,
  Camera,
  Loader2,
  Phone,
  Link2,
  Plus,
  Wallet,
  CheckCircle2,
} from "lucide-react";
import { useState, useRef, useTransition, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { generateUuid, useOffline } from "@/components/offline/OfflineProvider";
import { getAllClientes, getAllParceiros } from "@/lib/offline/db";
import { applyPendingToClientes, applyPendingToParceiros } from "@/lib/offline/applyPending";
import type { CachedCliente, CachedParceiro } from "@/lib/offline/types";
import {
  chaveComparacaoTelefone,
  normalizarTelefone,
  telefonesIguais,
} from "@/lib/telefone";
import {
  EmprestimoCamposCompletos,
  ConfirmarWhatsappEmprestimoModal,
  OverlayCriacaoEmprestimo,
  useEmprestimoFormState,
  formatBRL,
} from "@/components/EmprestimoFormSections";

interface ClienteExistenteInfo {
  id: string;
  nome: string;
  telefone: string;
  pendingSync?: boolean;
}

interface PendingClientePayload {
  nome: string;
  telefone: string;
  cidade: string;
  documento: string;
  endereco: string | null;
  referencia: string | null;
  quemIndicou: string | null;
  email: string | null;
  observacoes: string | null;
  blacklist: boolean;
  fotoBase64: string | null;
  documentosBase64: string | null;
}

export default function NovoClientePage() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    isOnline,
    session,
    pendingOps,
    dataRevision,
    syncBootstrap,
    enqueueOfflineAction,
    showToast,
  } = useOffline();

  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [clientesCache, setClientesCache] = useState<CachedCliente[]>([]);
  const [parceirosCache, setParceirosCache] = useState<CachedParceiro[]>([]);
  const [clienteDuplicadoServidor, setClienteDuplicadoServidor] = useState<{
    chave: string;
    cliente: ClienteExistenteInfo;
  } | null>(null);

  // Empréstimo completo opcional junto com o cadastro do cliente
  const [incluirEmprestimo, setIncluirEmprestimo] = useState(false);
  const empState = useEmprestimoFormState();
  const emprestimoSectionRef = useRef<HTMLDivElement>(null);
  const [pendingClientePayload, setPendingClientePayload] =
    useState<PendingClientePayload | null>(null);
  const [showConfirmWaModal, setShowConfirmWaModal] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayStep, setOverlayStep] = useState(0);

  useEffect(() => {
    const uid = session?.userId || "local";
    let cancelled = false;

    const load = async () => {
      try {
        const [cls, parcs] = await Promise.all([
          getAllClientes(uid).catch(() => []),
          getAllParceiros(uid).catch(() => []),
        ]);
        if (!cancelled) {
          setClientesCache(cls);
          setParceirosCache(parcs);
        }
        if (cls.length === 0 && parcs.length === 0 && isOnline) {
          await syncBootstrap(true);
          if (!cancelled) {
            const [cls2, parcs2] = await Promise.all([
              getAllClientes(uid).catch(() => []),
              getAllParceiros(uid).catch(() => []),
            ]);
            setClientesCache(cls2);
            setParceirosCache(parcs2);
          }
        }
      } catch {
        // ignora erro de leitura do cache
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [session?.userId, dataRevision, isOnline, syncBootstrap]);

  const clientesEfetivos = useMemo(
    () => applyPendingToClientes(clientesCache, pendingOps),
    [clientesCache, pendingOps]
  );

  const parceiros = useMemo(() => {
    return applyPendingToParceiros(parceirosCache, pendingOps)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }))
      .map((p) => ({
        id: p.id,
        nome: p.pendingSync ? `${p.nome} (Pendente)` : p.nome,
      }));
  }, [parceirosCache, pendingOps]);

  const clienteDuplicadoLocal = useMemo<ClienteExistenteInfo | null>(() => {
    if (!chaveComparacaoTelefone(telefone)) return null;
    const found = clientesEfetivos.find((c) => telefonesIguais(c.telefone, telefone));
    if (!found) return null;
    return {
      id: found.id,
      nome: found.nome,
      telefone: found.telefone,
      pendingSync: Boolean(found.pendingSync),
    };
  }, [telefone, clientesEfetivos]);

  const chaveTelefoneAtual = useMemo(() => chaveComparacaoTelefone(telefone), [telefone]);

  // Verificação online complementar caso o cache local esteja desatualizado
  useEffect(() => {
    if (!isOnline || clienteDuplicadoLocal || chaveTelefoneAtual.length < 8) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/clientes?telefone=${encodeURIComponent(normalizarTelefone(telefone))}`,
          { cache: "no-store", signal: controller.signal }
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          cliente?: { id: string; nome: string; telefone: string } | null;
        };
        if (data?.cliente?.id) {
          setClienteDuplicadoServidor({
            chave: chaveTelefoneAtual,
            cliente: {
              id: data.cliente.id,
              nome: data.cliente.nome,
              telefone: data.cliente.telefone,
            },
          });
        } else {
          setClienteDuplicadoServidor(null);
        }
      } catch {
        // Ignora abort/erro de rede — a trava final ocorre também no servidor
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [telefone, chaveTelefoneAtual, isOnline, clienteDuplicadoLocal]);

  const clienteDuplicadoServidorAtivo =
    isOnline &&
    !clienteDuplicadoLocal &&
    chaveTelefoneAtual.length >= 8 &&
    clienteDuplicadoServidor?.chave === chaveTelefoneAtual
      ? clienteDuplicadoServidor.cliente
      : null;

  const clienteDuplicado = clienteDuplicadoLocal || clienteDuplicadoServidorAtivo;

  const abrirClienteExistente = (existente: ClienteExistenteInfo) => {
    showToast(
      `Já existe um cliente com este número: "${existente.nome}". Vinculado ao cadastro existente!`
    );
    if (!isOnline || existente.pendingSync) {
      router.push(`/offline/cliente?id=${encodeURIComponent(existente.id)}`);
    } else {
      router.push(`/clientes/${existente.id}`);
    }
  };

  const ativarEIrParaEmprestimo = () => {
    setIncluirEmprestimo(true);
    setTimeout(() => {
      emprestimoSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };

  // Foto de Perfil
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [fotoBase64, setFotoBase64] = useState<string | null>(null);

  // Novos Documentos Selecionados
  const [novosDocumentos, setNovosDocumentos] = useState<
    { id: string; base64: string; preview: string }[]
  >([]);

  // Referências para inputs de arquivos ocultos
  const fileInputFotoRef = useRef<HTMLInputElement>(null);
  const fileInputFotoAllRef = useRef<HTMLInputElement>(null);

  const fileInputDocsRef = useRef<HTMLInputElement>(null);
  const fileInputDocsAllRef = useRef<HTMLInputElement>(null);

  // Estado da Webcam Modal
  const [webcamTarget, setWebcamTarget] = useState<"foto" | "documento" | null>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // --- Helper Compressão Base64 ---
  const fileToBase64 = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (!e.target?.result) return reject();
        const dataUrl = e.target.result as string;

        if (file.type === "application/pdf") {
          return resolve(dataUrl);
        }

        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;
          const MAX_SIZE = 800;

          if (width > height && width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          } else if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  };

  // --- Handlers de Foto ---
  const handleFotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const base64 = await fileToBase64(file);
        setFotoBase64(base64);
        setFotoPreview(base64);
      } catch (err) {
        console.error("Erro ao converter foto:", err);
      }
    }
  };

  const triggerFotoSelect = (acceptAll = false) => {
    if (acceptAll) {
      fileInputFotoAllRef.current?.click();
    } else {
      fileInputFotoRef.current?.click();
    }
  };

  // --- Handlers de Documentos ---
  const handleDocsChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const novos = Array.from(files);
      const newDocsArray: { id: string; base64: string; preview: string }[] = [];

      for (const file of novos) {
        const id = Math.random().toString(36).substring(2, 9);
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        let preview = "";
        let base64 = "";

        try {
          base64 = await fileToBase64(file);
          preview = isPdf ? "pdf" : base64;
          newDocsArray.push({ id, base64, preview });
        } catch (err) {
          console.error("Erro ao converter documento:", err);
        }
      }
      setNovosDocumentos((prev) => [...prev, ...newDocsArray]);
    }
  };

  const triggerDocsSelect = (acceptAll = false) => {
    if (acceptAll) {
      fileInputDocsAllRef.current?.click();
    } else {
      fileInputDocsRef.current?.click();
    }
  };

  const removeNovoDoc = (id: string) => {
    setNovosDocumentos((prev) => prev.filter((doc) => doc.id !== id));
  };

  // --- Webcam Capture ---
  const startWebcam = async (target: "foto" | "documento") => {
    setWebcamTarget(target);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      setWebcamStream(stream);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (err) {
      console.error("Erro ao acessar a câmera:", err);
      alert("Não foi possível acessar a câmera. Verifique as permissões do navegador.");
      setWebcamTarget(null);
    }
  };

  const stopWebcam = () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach((track) => track.stop());
    }
    setWebcamStream(null);
    setWebcamTarget(null);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;

      const MAX_SIZE = 800;
      let width = canvas.width;
      let height = canvas.height;

      if (width > height && width > MAX_SIZE) {
        height *= MAX_SIZE / width;
        width = MAX_SIZE;
      } else if (height > MAX_SIZE) {
        width *= MAX_SIZE / height;
        height = MAX_SIZE;
      }

      const finalCanvas = document.createElement("canvas");
      finalCanvas.width = width;
      finalCanvas.height = height;
      const ctx = finalCanvas.getContext("2d");

      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);
        const base64 = finalCanvas.toDataURL("image/jpeg", 0.7);

        if (webcamTarget === "foto") {
          setFotoBase64(base64);
          setFotoPreview(base64);
        } else if (webcamTarget === "documento") {
          setNovosDocumentos((prev) => [
            ...prev,
            { id: Math.random().toString(36).substring(2, 9), base64, preview: base64 },
          ]);
        }
        stopWebcam();
      }
    }
  };

  // --- Execução conjunta: criar (ou vincular) cliente + criar empréstimo completo ---
  const executarCriacaoComEmprestimo = (avisarNoWhats: boolean) => {
    if (!pendingClientePayload && !clienteDuplicado) return;

    empState.setEnviarPdfWhatsapp(avisarNoWhats);
    setShowConfirmWaModal(false);
    setShowOverlay(true);
    setOverlayStep(clienteDuplicado ? 1 : 0);

    const parc = parceiros.find((p) => p.id === empState.parceiroId);

    startTransition(async () => {
      try {
        let clienteIdFinal: string;
        let clienteNomeFinal: string;
        let clienteTelefoneFinal: string;
        let dependsOnClienteId: string | undefined;

        if (clienteDuplicado) {
          clienteIdFinal = clienteDuplicado.id;
          clienteNomeFinal = clienteDuplicado.nome;
          clienteTelefoneFinal = clienteDuplicado.telefone;
          dependsOnClienteId = clienteDuplicado.pendingSync ? clienteDuplicado.id : undefined;
          showToast(
            `Telefone já cadastrado: "${clienteDuplicado.nome}" vinculado ao empréstimo sem duplicar!`
          );
        } else {
          const payload = pendingClientePayload!;
          const clienteEntityId = generateUuid();
          const resCliente = await enqueueOfflineAction(
            {
              type: "CREATE_CLIENTE",
              entityId: clienteEntityId,
              label: `Novo cliente: ${payload.nome}`,
              payload,
            },
            { tryImmediateSync: true }
          );

          if (resCliente.result?.matchedByPhone && resCliente.result.linkedCliente) {
            clienteIdFinal = resCliente.result.linkedCliente.id;
            clienteNomeFinal = resCliente.result.linkedCliente.nome;
            clienteTelefoneFinal = resCliente.result.linkedCliente.telefone;
            dependsOnClienteId = undefined;
            showToast(
              `Telefone já cadastrado: "${clienteNomeFinal}" foi vinculado automaticamente — empréstimo criado sem duplicar!`
            );
          } else {
            clienteIdFinal = resCliente.result?.entityId || clienteEntityId;
            clienteNomeFinal = payload.nome;
            clienteTelefoneFinal = payload.telefone;
            dependsOnClienteId = resCliente.syncedImmediately ? undefined : clienteEntityId;
          }
        }

        setOverlayStep(1);

        const emprestimoEntityId = generateUuid();
        const resEmp = await enqueueOfflineAction(
          {
            type: "CREATE_EMPRESTIMO",
            entityId: emprestimoEntityId,
            dependsOnEntityId: dependsOnClienteId,
            label: `Novo empréstimo: ${formatBRL(empState.valor)} — ${clienteNomeFinal}`,
            payload: {
              clienteId: clienteIdFinal,
              clienteNome: clienteNomeFinal,
              clienteTelefone: clienteTelefoneFinal,
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
          { tryImmediateSync: !dependsOnClienteId }
        );

        setOverlayStep(2);
        if (resEmp.syncedImmediately) {
          router.push(`/emprestimos/${emprestimoEntityId}`);
        } else {
          router.push(`/offline/emprestimo?id=${encodeURIComponent(emprestimoEntityId)}`);
        }
      } catch (err) {
        console.error("Erro ao salvar cliente e empréstimo:", err);
        alert("Erro ao salvar cliente e empréstimo.");
        setShowOverlay(false);
      }
    });
  };

  // --- Submit ---
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Se NÃO está criando empréstimo e o telefone já existe, apenas abre o cliente existente
    if (clienteDuplicado && !incluirEmprestimo) {
      abrirClienteExistente(clienteDuplicado);
      return;
    }

    const formData = new FormData(e.currentTarget);

    const nomeFinal = (nome || String(formData.get("nome") || "")).trim();
    const telefoneNorm = normalizarTelefone(telefone || String(formData.get("telefone") || ""));
    const cidade = String(formData.get("cidade") || "Bauru");
    const documento = String(formData.get("documento") || "");
    const endereco = String(formData.get("endereco") || "") || null;
    const referencia = String(formData.get("referencia") || "") || null;
    const quemIndicou = String(formData.get("quemIndicou") || "") || null;
    const email = String(formData.get("email") || "") || null;
    const observacoes = String(formData.get("observacoes") || "") || null;
    const blacklist = formData.get("blacklist") === "true";
    const documentosBase64 =
      novosDocumentos.length > 0 ? JSON.stringify(novosDocumentos.map((d) => d.base64)) : null;

    if (!telefoneNorm) {
      alert("Informe um telefone (WhatsApp) válido com números.");
      return;
    }

    if (!clienteDuplicado && !nomeFinal) {
      alert("Informe o nome completo do cliente.");
      return;
    }

    // Fluxo com criação completa de empréstimo junto
    if (incluirEmprestimo) {
      if (empState.valor <= 0) {
        alert("Informe um valor principal válido para o empréstimo.");
        return;
      }

      setPendingClientePayload({
        nome: nomeFinal,
        telefone: telefoneNorm,
        cidade,
        documento,
        endereco,
        referencia,
        quemIndicou,
        email,
        observacoes,
        blacklist,
        fotoBase64: fotoBase64 || null,
        documentosBase64,
      });
      setShowConfirmWaModal(true);
      return;
    }

    // Fluxo padrão: apenas cadastro do cliente
    startTransition(async () => {
      try {
        const entityId = generateUuid();
        const res = await enqueueOfflineAction(
          {
            type: "CREATE_CLIENTE",
            entityId,
            label: `Novo cliente: ${nomeFinal}`,
            payload: {
              nome: nomeFinal,
              telefone: telefoneNorm,
              cidade,
              documento,
              endereco,
              referencia,
              quemIndicou,
              email,
              observacoes,
              blacklist,
              fotoBase64: fotoBase64 || null,
              documentosBase64,
            },
          },
          { tryImmediateSync: true }
        );

        // Se o servidor detectar duplicidade por telefone, vincula ao cadastro existente automaticamente
        if (res.result?.matchedByPhone && res.result.linkedCliente) {
          abrirClienteExistente(res.result.linkedCliente);
          return;
        }

        router.push("/clientes");
      } catch (err) {
        console.error("Erro ao salvar cliente:", err);
        alert("Erro ao salvar cliente.");
      }
    });
  };

  return (
    <div className="w-full max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto space-y-6 pb-20">
      {/* Voltar */}
      <Link
        href="/clientes"
        className="flex items-center space-x-1.5 text-slate-500 hover:text-slate-900 text-sm font-medium transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Voltar para Clientes</span>
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Novo cliente</h1>
          <p className="text-slate-500">
            Cadastre um novo tomador e, se desejar, já crie o empréstimo completo aqui mesmo.
          </p>
        </div>
        <button
          type="button"
          onClick={ativarEIrParaEmprestimo}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold border transition-all cursor-pointer shrink-0 self-start sm:self-center ${
            incluirEmprestimo
              ? "bg-emerald-600 text-white border-emerald-600 shadow-sm hover:bg-emerald-700"
              : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300"
          }`}
        >
          {incluirEmprestimo ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <Wallet className="w-4 h-4" />
          )}
          <span>{incluirEmprestimo ? "Empréstimo ativado" : "+ Criar empréstimo junto"}</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Dados pessoais */}
        <div className="premium-card p-6 space-y-4 bg-white border border-slate-200 shadow-sm rounded-2xl">
          <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
            Dados pessoais
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Nome */}
            <div className="space-y-1.5">
              <label
                htmlFor="nome"
                className="text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                Nome completo *
              </label>
              <input
                type="text"
                id="nome"
                name="nome"
                required={!clienteDuplicado}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Nome completo"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
              />
            </div>

            {/* Telefone */}
            <div className="space-y-1.5">
              <label
                htmlFor="telefone"
                className="text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                Telefone (WhatsApp) *
              </label>
              <input
                type="tel"
                inputMode="tel"
                id="telefone"
                name="telefone"
                required
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="(00) 00000-0000"
                className={`w-full bg-slate-50 border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 text-slate-900 ${
                  clienteDuplicado
                    ? "border-amber-400 focus:ring-amber-500 bg-amber-50/40"
                    : "border-slate-200 focus:ring-emerald-500"
                }`}
              />
            </div>

            {/* Aviso de cliente já cadastrado pelo telefone */}
            {clienteDuplicado && (
              <div className="col-span-1 md:col-span-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-amber-50 border-2 border-amber-300 text-amber-950 text-xs">
                <div className="flex items-start gap-2.5">
                  <Phone className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-black text-sm text-amber-950">
                      Já existe um cliente cadastrado com este telefone
                    </p>
                    <p className="text-amber-900 mt-0.5 leading-relaxed">
                      Este número já pertence a <strong>{clienteDuplicado.nome}</strong>.{" "}
                      {incluirEmprestimo
                        ? "Não será criado um cadastro duplicado — ao salvar, o empréstimo configurado abaixo será vinculado diretamente a este cliente."
                        : "Não é permitido criar um cadastro duplicado — você será vinculado ao cadastro existente automaticamente."}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => abrirClienteExistente(clienteDuplicado)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-colors cursor-pointer"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>Abrir cadastro</span>
                  </button>
                  {!incluirEmprestimo && (
                    <Link
                      href={`/emprestimos/novo?clienteId=${encodeURIComponent(clienteDuplicado.id)}`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Novo empréstimo</span>
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* Cidade */}
            <div className="space-y-1.5">
              <label
                htmlFor="cidade"
                className="text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                Cidade
              </label>
              <input
                type="text"
                id="cidade"
                name="cidade"
                defaultValue="Bauru"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
              />
            </div>

            {/* Quem indicou */}
            <div className="space-y-1.5">
              <label
                htmlFor="quemIndicou"
                className="text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                Quem indicou
              </label>
              <input
                type="text"
                id="quemIndicou"
                name="quemIndicou"
                placeholder="Quem indicou este cliente"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
              />
            </div>

            {/* CPF / RG */}
            <div className="space-y-1.5">
              <label
                htmlFor="documento"
                className="text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                CPF / RG
              </label>
              <input
                type="text"
                id="documento"
                name="documento"
                placeholder="000.000.000-00"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
              />
            </div>

            {/* Endereço */}
            <div className="space-y-1.5">
              <label
                htmlFor="endereco"
                className="text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                Endereço
              </label>
              <input
                type="text"
                id="endereco"
                name="endereco"
                placeholder="Rua, número, bairro"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
              />
            </div>

            {/* Referência */}
            <div className="space-y-1.5">
              <label
                htmlFor="referencia"
                className="text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                Referência
              </label>
              <input
                type="text"
                id="referencia"
                name="referencia"
                placeholder="Ponto de referência"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
              />
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                placeholder="email@exemplo.com"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
              />
            </div>

            {/* Observações */}
            <div className="space-y-1.5 col-span-1 md:col-span-2">
              <label
                htmlFor="observacoes"
                className="text-xs font-bold text-slate-600 uppercase tracking-wider"
              >
                Observações
              </label>
              <textarea
                id="observacoes"
                name="observacoes"
                rows={3}
                placeholder="Notas sobre esta pessoa..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
              />
            </div>

            {/* Lista Negra */}
            <div className="flex items-center space-x-2.5 col-span-1 md:col-span-2 pt-2">
              <input
                type="checkbox"
                id="blacklist"
                name="blacklist"
                value="true"
                className="w-4 h-4 accent-rose-600 cursor-pointer"
              />
              <label
                htmlFor="blacklist"
                className="text-xs font-bold text-rose-600 uppercase tracking-wider cursor-pointer"
              >
                Adicionar à Lista Negra (Bloqueado)
              </label>
            </div>
          </div>
        </div>

        {/* Foto do cliente */}
        <div className="premium-card p-6 space-y-4 bg-white border border-slate-200 shadow-sm rounded-2xl">
          <div>
            <h2 className="text-base font-bold text-slate-900">Foto do cliente</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tire uma foto ou selecione da galeria.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => triggerFotoSelect(false)}
              className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-50 text-emerald-800 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Galeria</span>
            </button>
            <button
              type="button"
              onClick={() => triggerFotoSelect(true)}
              className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-50 text-emerald-800 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <Paperclip className="w-3.5 h-3.5" />
              <span>Arquivo</span>
            </button>
            <button
              type="button"
              onClick={() => startWebcam("foto")}
              className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-50 text-emerald-800 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Webcam</span>
            </button>
          </div>

          {/* Input oculto de foto */}
          <input
            type="file"
            ref={fileInputFotoRef}
            onChange={handleFotoChange}
            accept="image/*"
            className="hidden"
          />
          <input
            type="file"
            ref={fileInputFotoAllRef}
            onChange={handleFotoChange}
            className="hidden"
          />

          {fotoPreview && (
            <div className="relative w-44 aspect-square rounded-2xl overflow-hidden border border-slate-200 shadow-sm mt-2">
              <img
                src={fotoPreview}
                alt="Foto do cliente"
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  setFotoPreview(null);
                  setFotoBase64(null);
                }}
                className="absolute top-2 right-2 bg-rose-500 text-white p-1.5 rounded-full hover:bg-rose-600 transition-colors shadow cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Documentos */}
        <div className="premium-card p-6 space-y-4 bg-white border border-slate-200 shadow-sm rounded-2xl">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Documentos (RG, CPF, comprovantes...)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Aceita imagens (JPG/PNG) e PDFs.</p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => triggerDocsSelect(false)}
              className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-50 text-emerald-800 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Galeria</span>
            </button>
            <button
              type="button"
              onClick={() => triggerDocsSelect(true)}
              className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-50 text-emerald-800 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <Paperclip className="w-3.5 h-3.5" />
              <span>Arquivo</span>
            </button>
            <button
              type="button"
              onClick={() => startWebcam("documento")}
              className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-50 text-emerald-800 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Webcam</span>
            </button>
          </div>

          {/* Inputs ocultos de documentos */}
          <input
            type="file"
            ref={fileInputDocsRef}
            onChange={handleDocsChange}
            accept="image/*"
            multiple
            className="hidden"
          />
          <input
            type="file"
            ref={fileInputDocsAllRef}
            onChange={handleDocsChange}
            multiple
            className="hidden"
          />

          {/* Visualização de Documentos */}
          {novosDocumentos.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
              {novosDocumentos.map((doc) => {
                const isPdf = doc.preview === "pdf";
                return (
                  <div
                    key={doc.id}
                    className="relative group border border-emerald-500/30 rounded-xl overflow-hidden aspect-video sm:aspect-square flex items-center justify-center bg-slate-50"
                  >
                    {isPdf ? (
                      <div className="flex flex-col items-center justify-center p-4">
                        <span className="text-rose-500 font-bold">PDF</span>
                        <span className="text-xs text-emerald-600 mt-1 font-semibold">Novo</span>
                      </div>
                    ) : (
                      <img
                        src={doc.preview}
                        alt="Novo Documento"
                        className="w-full h-full object-cover"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeNovoDoc(doc.id)}
                      className="absolute top-2 right-2 bg-rose-500 hover:bg-rose-600 text-white p-1 rounded-full shadow cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Toggle para criar empréstimo completo junto com o cadastro do cliente */}
        <div ref={emprestimoSectionRef} className="space-y-6 scroll-mt-6">
          <div
            className={`premium-card p-5 sm:p-6 rounded-2xl border-2 transition-all shadow-sm ${
              incluirEmprestimo
                ? "bg-emerald-50/50 border-emerald-400 shadow-md"
                : "bg-white border-slate-200 hover:border-emerald-300"
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div
                  className={`p-3 rounded-xl transition-colors shrink-0 ${
                    incluirEmprestimo
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-emerald-50 text-emerald-600 border border-emerald-200"
                  }`}
                >
                  <Wallet className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-black text-slate-900 tracking-tight">
                      Já criar um empréstimo para este cliente
                    </h2>
                    <span
                      className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                        incluirEmprestimo
                          ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                          : "bg-slate-100 text-slate-500 border-slate-200"
                      }`}
                    >
                      {incluirEmprestimo ? "Ativado" : "Opcional"}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600 mt-1 leading-relaxed">
                    {incluirEmprestimo
                      ? "Todas as opções completas de criação de empréstimo estão disponíveis abaixo. Ao salvar, o cliente e o empréstimo serão criados juntos."
                      : "Ative para abrir o formulário completo de empréstimo (parceiro, valores, modalidade, juros, parcelas, vencimento, atraso e envio no WhatsApp) aqui mesmo."}
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={incluirEmprestimo}
                aria-label="Ativar criação de empréstimo junto com o cliente"
                onClick={() => setIncluirEmprestimo((prev) => !prev)}
                className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500/30 self-start sm:self-center ${
                  incluirEmprestimo ? "bg-emerald-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                    incluirEmprestimo ? "translate-x-6" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Formulário completo de empréstimo (idêntico ao de /emprestimos/novo) */}
          {incluirEmprestimo && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-200">
              <EmprestimoCamposCompletos
                state={empState}
                parceiros={parceiros}
                showParceiroSection
                idPrefix="emp-"
                clienteNomePreview={
                  clienteDuplicado ? clienteDuplicado.nome : nome.trim() || undefined
                }
              />
            </div>
          )}
        </div>

        {/* Ações */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-4 border-t border-slate-200">
          <Link
            href="/clientes"
            className="px-5 py-3 bg-slate-100 text-slate-700 rounded-xl text-xs sm:text-sm font-semibold hover:bg-slate-200 transition-colors text-center"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className={`flex items-center justify-center space-x-2 text-white px-6 py-3 rounded-xl text-xs sm:text-sm font-bold transition-colors disabled:opacity-50 shadow-sm cursor-pointer ${
              clienteDuplicado
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : clienteDuplicado ? (
              <Link2 className="w-4 h-4" />
            ) : incluirEmprestimo ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>
              {isPending
                ? "Salvando..."
                : clienteDuplicado
                ? incluirEmprestimo
                  ? "Vincular cliente e criar empréstimo"
                  : "Vincular ao cliente existente"
                : incluirEmprestimo
                ? "Salvar cliente e criar empréstimo"
                : "Salvar cliente"}
            </span>
          </button>
        </div>
      </form>

      {/* Modal de Confirmação: Avisar ou não no WhatsApp ao criar empréstimo */}
      <ConfirmarWhatsappEmprestimoModal
        isOpen={showConfirmWaModal}
        clienteNome={
          clienteDuplicado?.nome || pendingClientePayload?.nome || nome.trim() || "Cliente"
        }
        valorEmprestado={empState.valor}
        totalEstimado={empState.totalSimulado}
        dataVencimento={empState.dataVencimentoFinal}
        isOnline={isOnline}
        isPending={isPending}
        onConfirm={executarCriacaoComEmprestimo}
        onClose={() => setShowConfirmWaModal(false)}
      />

      {/* Overlay Animado de Criação */}
      <OverlayCriacaoEmprestimo
        isOpen={showOverlay}
        step={overlayStep}
        criandoClienteJunto={!clienteDuplicado}
      />

      {/* Modal da Webcam */}
      {webcamTarget !== null && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between text-slate-900">
              <h3 className="font-bold text-xs">Capturar foto com a câmera</h3>
              <button
                onClick={stopWebcam}
                className="p-1 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative aspect-video sm:aspect-square bg-black flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            </div>

            <div className="p-4 flex items-center justify-between bg-slate-50 border-t border-slate-100">
              <button
                type="button"
                onClick={stopWebcam}
                className="px-4 py-2 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={capturePhoto}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center space-x-1 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Tirar Foto</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
