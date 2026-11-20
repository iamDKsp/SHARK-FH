"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  cancelPendingOperation,
  clearUserDatabase,
  enqueueOperation,
  getMeta,
  getPendingOperationsOrdered,
  isIndexedDbAvailable,
  markOperationSynced,
  requestPersistentStorage,
  saveBootstrapData,
  updateOperationStatus,
} from "@/lib/offline/db";
import type {
  BootstrapResponse,
  OfflineOperation,
  OfflineSession,
  SyncOperationResult,
  SyncWhatsappPdfMeta,
} from "@/lib/offline/types";

const SESSION_KEY = "shark_fh_offline_session";
const BOOTSTRAP_THROTTLE_MS = 5 * 60 * 1000;

export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err || "").toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("load failed") ||
    msg.includes("network request failed") ||
    msg.includes("offline")
  );
}

export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function enviarPdfWhatsappCliente(meta: SyncWhatsappPdfMeta): Promise<boolean> {
  if (!meta.clienteTelefone) return false;
  try {
    const { obterCronogramaPdfBase64 } = await import("@/lib/cronogramaPdf");
    const pdfBase64 = obterCronogramaPdfBase64({
      clienteNome: meta.clienteNome,
      tipoPagamento: meta.tipoPagamento,
      valorEmprestado: meta.valorEmprestado,
      taxaJuros: meta.taxaJuros,
      taxaMulta: meta.taxaMulta,
      atrasoTipo: meta.atrasoTipo,
      atrasoValor: meta.atrasoValor,
      observacoes: meta.observacoes,
      parcelas: meta.parcelas.map((p) => ({
        numero: p.numero,
        valor: p.valor,
        data_vencimento: p.data_vencimento,
        status: "aberto",
      })),
    });
    const fileName = `cronograma-${meta.clienteNome
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")}.pdf`;

    const res = await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            phone: meta.clienteTelefone,
            document: pdfBase64,
            mimetype: "application/pdf",
            fileName,
            caption: meta.legendaPdf || "Contratação realizada com sucesso!",
          },
        ],
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[offline] Falha ao enviar PDF do empréstimo no WhatsApp pós-sync:", err);
    return false;
  }
}

export interface OfflineContextValue {
  isEnabledRoute: boolean;
  isOnline: boolean;
  isSyncing: boolean;
  isBootstrapping: boolean;
  sessionExpired: boolean;
  session: OfflineSession | null;
  pendingOps: OfflineOperation[];
  pendingCount: number;
  lastSyncedAt: string | null;
  cachedCounts: { clientes: number; emprestimos: number; parceiros: number; cheques: number } | null;
  dataRevision: number;
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  toastMessage: string | null;
  showToast: (msg: string) => void;
  refreshPending: () => Promise<OfflineOperation[]>;
  syncBootstrap: (force?: boolean) => Promise<boolean>;
  syncOutbox: () => Promise<{ synced: number; errors: number }>;
  enqueueOfflineAction: (
    op: Omit<OfflineOperation, "operationId" | "userId" | "createdAt" | "status" | "attempts"> & {
      operationId?: string;
    },
    options?: { tryImmediateSync?: boolean }
  ) => Promise<{ queued: boolean; syncedImmediately: boolean; operationId: string; result?: SyncOperationResult }>;
  cancelAction: (operationId: string) => Promise<number>;
  retryAction: (operationId: string) => Promise<void>;
  clearOfflineOnLogout: () => Promise<void>;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

function isPublicOrFuncionarioPath(pathname: string): boolean {
  if (!pathname) return false;
  if (pathname === "/login") return true;
  const reservados = [
    "api",
    "login",
    "clientes",
    "emprestimos",
    "parceiros",
    "cobrancas",
    "configuracoes",
    "cheques",
    "mensagens",
    "perfil",
    "offline",
  ];
  const m = pathname.match(/^\/([^/]+)\/cliente\/?$/);
  return Boolean(m && !reservados.includes(m[1]));
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isEnabledRoute = !isPublicOrFuncionarioPath(pathname);

  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isBootstrapping, setIsBootstrapping] = useState<boolean>(false);
  const [sessionExpired, setSessionExpired] = useState<boolean>(false);
  const [session, setSession] = useState<OfflineSession | null>(null);
  const [pendingOps, setPendingOps] = useState<OfflineOperation[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [cachedCounts, setCachedCounts] = useState<{
    clientes: number;
    emprestimos: number;
    parceiros: number;
    cheques: number;
  } | null>(null);
  const [dataRevision, setDataRevision] = useState<number>(0);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const isSyncingRef = useRef(false);
  const lastBootstrapRef = useRef(0);
  const sessionRef = useRef<OfflineSession | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 4000);
  }, []);

  const bumpRevision = useCallback(() => {
    setDataRevision((r) => r + 1);
  }, []);

  // Carrega sessão salva no localStorage imediatamente (permite abrir offline!)
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOnline(navigator.onLine);
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as OfflineSession;
        if (parsed?.userId) {
          sessionRef.current = parsed;
          setSession(parsed);
        }
      }
    } catch {
      // ignora
    }
  }, []);

  const refreshPending = useCallback(async (): Promise<OfflineOperation[]> => {
    const uid = sessionRef.current?.userId;
    if (!uid || !isIndexedDbAvailable()) {
      setPendingOps([]);
      return [];
    }
    try {
      const [ops, syncedAt, counts] = await Promise.all([
        getPendingOperationsOrdered(uid),
        getMeta<string>(uid, "syncedAt"),
        getMeta<{ clientes: number; emprestimos: number; parceiros: number; cheques: number }>(
          uid,
          "counts"
        ),
      ]);
      setPendingOps(ops);
      setLastSyncedAt(syncedAt);
      setCachedCounts(counts);
      return ops;
    } catch (err) {
      console.error("[offline] Erro ao ler outbox:", err);
      return [];
    }
  }, []);

  const checkRealConnectivity = useCallback(async (): Promise<{
    online: boolean;
    unauthorized?: boolean;
    userId?: string;
  }> => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOnline(false);
      return { online: false };
    }
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch("/api/offline/ping", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      clearTimeout(t);
      if (res.status === 401) {
        setIsOnline(true);
        setSessionExpired(true);
        return { online: true, unauthorized: true };
      }
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setIsOnline(true);
        setSessionExpired(false);
        return { online: true, userId: data.userId };
      }
      return { online: false };
    } catch {
      setIsOnline(false);
      return { online: false };
    }
  }, []);

  const syncBootstrap = useCallback(
    async (force = false): Promise<boolean> => {
      const uid = sessionRef.current?.userId;
      if (!uid || !isIndexedDbAvailable() || !isEnabledRoute) return false;
      const now = Date.now();
      if (!force && now - lastBootstrapRef.current < BOOTSTRAP_THROTTLE_MS) {
        return false;
      }

      setIsBootstrapping(true);
      try {
        const res = await fetch("/api/offline/bootstrap", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (res.status === 401) {
          setSessionExpired(true);
          return false;
        }
        if (!res.ok) return false;

        const data = (await res.json()) as BootstrapResponse;
        await saveBootstrapData(uid, data);
        lastBootstrapRef.current = Date.now();
        setIsOnline(true);
        setSessionExpired(false);
        await refreshPending();
        bumpRevision();
        return true;
      } catch {
        setIsOnline(false);
        return false;
      } finally {
        setIsBootstrapping(false);
      }
    },
    [bumpRevision, isEnabledRoute, refreshPending]
  );

  const sendOperationsToServer = useCallback(
    async (uid: string, ops: OfflineOperation[]): Promise<{
      results: SyncOperationResult[];
      unauthorized?: boolean;
      networkError?: boolean;
    }> => {
      try {
        const res = await fetch("/api/offline/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ userId: uid, operations: ops }),
        });

        if (res.status === 401) {
          setSessionExpired(true);
          return { results: [], unauthorized: true };
        }
        if (res.status === 403) {
          const d = await res.json().catch(() => ({}));
          return {
            results: ops.map((o) => ({
              operationId: o.operationId,
              status: "error",
              error: d.error || "Fila pertence a outro usuário.",
            })),
          };
        }
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          return {
            results: ops.map((o) => ({
              operationId: o.operationId,
              status: "error",
              error: d.error || `Erro HTTP ${res.status}`,
            })),
          };
        }

        const data = (await res.json()) as { results: SyncOperationResult[] };
        setIsOnline(true);
        setSessionExpired(false);
        return { results: data.results || [] };
      } catch {
        setIsOnline(false);
        return { results: [], networkError: true };
      }
    },
    []
  );

  const syncOutbox = useCallback(async (): Promise<{ synced: number; errors: number }> => {
    const uid = sessionRef.current?.userId;
    if (!uid || !isIndexedDbAvailable() || !isEnabledRoute) return { synced: 0, errors: 0 };
    if (isSyncingRef.current) return { synced: 0, errors: 0 };

    const ops = await getPendingOperationsOrdered(uid);
    if (ops.length === 0) return { synced: 0, errors: 0 };

    const ping = await checkRealConnectivity();
    if (!ping.online || ping.unauthorized) {
      return { synced: 0, errors: 0 };
    }

    isSyncingRef.current = true;
    setIsSyncing(true);

    let synced = 0;
    let errors = 0;

    try {
      for (const op of ops) {
        await updateOperationStatus(uid, op.operationId, {
          status: "syncing",
          attempts: (op.attempts || 0) + 1,
        });
      }
      await refreshPending();

      const resp = await sendOperationsToServer(uid, ops);

      if (resp.unauthorized || resp.networkError) {
        for (const op of ops) {
          await updateOperationStatus(uid, op.operationId, { status: "pending" });
        }
        await refreshPending();
        return { synced: 0, errors: 0 };
      }

      const opById = new Map(ops.map((o) => [o.operationId, o]));
      const pdfsParaEnviar: SyncWhatsappPdfMeta[] = [];

      for (const r of resp.results) {
        const op = opById.get(r.operationId);
        if (!op) continue;

        if (r.status === "synced" || r.status === "already_synced") {
          await markOperationSynced(uid, op);
          synced++;
          if (r.whatsappPdfMeta && r.status === "synced") {
            pdfsParaEnviar.push(r.whatsappPdfMeta);
          }
        } else {
          errors++;
          await updateOperationStatus(uid, op.operationId, {
            status: "error",
            lastError: r.error || "Erro ao sincronizar.",
          });
        }
      }

      // Disparo automático do PDF do empréstimo via WhatsApp pós-sync (confirmado pelo usuário)
      for (const meta of pdfsParaEnviar) {
        await enviarPdfWhatsappCliente(meta);
      }

      await refreshPending();
      bumpRevision();

      if (synced > 0) {
        showToast(
          synced === 1
            ? "1 ação sincronizada com sucesso!"
            : `${synced} ações sincronizadas com sucesso!`
        );
        // Atualiza o cache local com os dados frescos do servidor
        await syncBootstrap(true);
        try {
          router.refresh();
        } catch {
          // ignora
        }
      }

      return { synced, errors };
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [
    bumpRevision,
    checkRealConnectivity,
    isEnabledRoute,
    refreshPending,
    router,
    sendOperationsToServer,
    showToast,
    syncBootstrap,
  ]);

  // Registra Service Worker + carrega perfil + warmup + bootstrap + sync inicial
  useEffect(() => {
    if (!isEnabledRoute || typeof window === "undefined") return;

    requestPersistentStorage();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((reg) => {
          const sw = reg.active || reg.waiting || reg.installing;
          if (sw && navigator.onLine) {
            sw.postMessage({ type: "WARMUP_ROUTES" });
          }
        })
        .catch((err) => {
          console.warn("[offline] Falha ao registrar Service Worker:", err);
        });
    }

    let cancelled = false;
    (async () => {
      // Tenta atualizar a sessão online via /api/perfil
      if (navigator.onLine) {
        try {
          const res = await fetch("/api/perfil", { cache: "no-store", credentials: "same-origin" });
          if (res.ok) {
            const data = await res.json();
            if (data?.user?.id && !cancelled) {
              const s: OfflineSession = {
                userId: String(data.user.id),
                userName: String(data.user.nome || "Administrador"),
              };
              sessionRef.current = s;
              setSession(s);
              setSessionExpired(false);
              setIsOnline(true);
              localStorage.setItem(SESSION_KEY, JSON.stringify(s));
            }
          } else if (res.status === 401 && !cancelled) {
            setSessionExpired(true);
          }
        } catch {
          if (!cancelled) setIsOnline(false);
        }
      }

      if (cancelled) return;
      const ops = await refreshPending();
      if (navigator.onLine && sessionRef.current?.userId) {
        if (ops.length > 0) {
          await syncOutbox();
        } else {
          await syncBootstrap(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEnabledRoute, refreshPending, syncBootstrap, syncOutbox]);

  // Escuta ciclo de vida iOS Safari PWA (online, offline, visibilitychange, focus) + retry suave
  useEffect(() => {
    if (!isEnabledRoute || typeof window === "undefined") return;

    const handleOnline = async () => {
      setIsOnline(true);
      await syncOutbox();
      await syncBootstrap(false);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    const handleVisibility = async () => {
      if (document.visibilityState === "visible") {
        await refreshPending();
        if (navigator.onLine) {
          await syncOutbox();
          await syncBootstrap(false);
        }
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);

    const interval = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      if (!navigator.onLine || isSyncingRef.current) return;
      const uid = sessionRef.current?.userId;
      if (!uid) return;
      const ops = await getPendingOperationsOrdered(uid).catch(() => []);
      if (ops.some((o) => o.status === "pending")) {
        await syncOutbox();
      }
    }, 25000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(interval);
    };
  }, [isEnabledRoute, refreshPending, syncBootstrap, syncOutbox]);

  const enqueueOfflineAction = useCallback<OfflineContextValue["enqueueOfflineAction"]>(
    async (opInput, options) => {
      const uid = sessionRef.current?.userId || "local";
      const op: OfflineOperation = {
        ...(opInput as OfflineOperation),
        operationId: opInput.operationId || generateUuid(),
        userId: uid,
        createdAt: Date.now(),
        status: "pending",
        attempts: 0,
      };

      await enqueueOperation(uid, op);
      await refreshPending();
      bumpRevision();

      const tryImmediate = options?.tryImmediateSync ?? false;
      if (tryImmediate && navigator.onLine && sessionRef.current?.userId) {
        // Envia junto com eventuais dependências anteriores
        const allOps = await getPendingOperationsOrdered(uid);
        const resp = await sendOperationsToServer(uid, allOps);
        if (!resp.networkError && !resp.unauthorized) {
          const opById = new Map(allOps.map((o) => [o.operationId, o]));
          let targetResult: SyncOperationResult | undefined;
          for (const r of resp.results) {
            const item = opById.get(r.operationId);
            if (!item) continue;
            if (r.operationId === op.operationId) targetResult = r;
            if (r.status === "synced" || r.status === "already_synced") {
              await markOperationSynced(uid, item);
              if (r.whatsappPdfMeta && r.status === "synced") {
                await enviarPdfWhatsappCliente(r.whatsappPdfMeta);
              }
            } else {
              await updateOperationStatus(uid, item.operationId, {
                status: "error",
                lastError: r.error || "Erro ao sincronizar.",
              });
            }
          }
          await refreshPending();
          bumpRevision();
          if (targetResult && (targetResult.status === "synced" || targetResult.status === "already_synced")) {
            syncBootstrap(true).catch(() => {});
            return {
              queued: false,
              syncedImmediately: true,
              operationId: op.operationId,
              result: targetResult,
            };
          }
        }
      }

      showToast(`Salvo offline: ${op.label}`);
      return { queued: true, syncedImmediately: false, operationId: op.operationId };
    },
    [bumpRevision, refreshPending, sendOperationsToServer, showToast, syncBootstrap]
  );

  const cancelAction = useCallback(
    async (operationId: string): Promise<number> => {
      const uid = sessionRef.current?.userId || "local";
      const removed = await cancelPendingOperation(uid, operationId);
      await refreshPending();
      bumpRevision();
      if (removed.length > 0) {
        showToast(
          removed.length === 1
            ? `Ação cancelada: ${removed[0].label}`
            : `${removed.length} ações pendentes canceladas.`
        );
      }
      return removed.length;
    },
    [bumpRevision, refreshPending, showToast]
  );

  const retryAction = useCallback(
    async (operationId: string) => {
      const uid = sessionRef.current?.userId;
      if (!uid) return;
      await updateOperationStatus(uid, operationId, { status: "pending", lastError: undefined });
      await refreshPending();
      await syncOutbox();
    },
    [refreshPending, syncOutbox]
  );

  const clearOfflineOnLogout = useCallback(async () => {
    const uid = sessionRef.current?.userId;
    if (uid) {
      await clearUserDatabase(uid);
    }
    try {
      localStorage.removeItem(SESSION_KEY);
      // Não remove sol_biometric_token nem sol_webauthn_cred_id para preservar o Face ID!
    } catch {
      // ignora
    }
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        reg?.active?.postMessage({ type: "CLEAR_CACHES" });
      } catch {
        // ignora
      }
    }
    sessionRef.current = null;
    setSession(null);
    setPendingOps([]);
    setLastSyncedAt(null);
    setCachedCounts(null);
  }, []);

  const value = useMemo<OfflineContextValue>(
    () => ({
      isEnabledRoute,
      isOnline,
      isSyncing,
      isBootstrapping,
      sessionExpired,
      session,
      pendingOps,
      pendingCount: pendingOps.length,
      lastSyncedAt,
      cachedCounts,
      dataRevision,
      modalOpen,
      setModalOpen,
      toastMessage,
      showToast,
      refreshPending,
      syncBootstrap,
      syncOutbox,
      enqueueOfflineAction,
      cancelAction,
      retryAction,
      clearOfflineOnLogout,
    }),
    [
      isEnabledRoute,
      isOnline,
      isSyncing,
      isBootstrapping,
      sessionExpired,
      session,
      pendingOps,
      lastSyncedAt,
      cachedCounts,
      dataRevision,
      modalOpen,
      toastMessage,
      showToast,
      refreshPending,
      syncBootstrap,
      syncOutbox,
      enqueueOfflineAction,
      cancelAction,
      retryAction,
      clearOfflineOnLogout,
    ]
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) {
    throw new Error("useOffline deve ser usado dentro de OfflineProvider");
  }
  return ctx;
}
