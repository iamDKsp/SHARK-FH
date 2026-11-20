import type {
  BootstrapResponse,
  CachedCheque,
  CachedCliente,
  CachedConfig,
  CachedEmprestimo,
  CachedParceiro,
  OfflineOperation,
  OfflineOperationType,
} from "./types";

const DB_PREFIX = "shark_fh_offline_v1_";
const DB_VERSION = 1;

const STORES = {
  clientes: "clientes",
  parceiros: "parceiros",
  emprestimos: "emprestimos",
  cheques: "cheques",
  outbox: "outbox",
  meta: "meta",
} as const;

const openPromises = new Map<string, Promise<IDBDatabase>>();

export function isIndexedDbAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

export async function requestPersistentStorage(): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      await navigator.storage.persist();
    }
  } catch {
    // Opcional no iOS
  }
}

export function getDbName(userId: string): string {
  const safe = (userId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${DB_PREFIX}${safe}`;
}

export function openOfflineDb(userId: string): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error("IndexedDB indisponível neste ambiente."));
  }

  const dbName = getDbName(userId);
  const existing = openPromises.get(dbName);
  if (existing) return existing;

  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.clientes)) {
        db.createObjectStore(STORES.clientes, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.parceiros)) {
        db.createObjectStore(STORES.parceiros, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.emprestimos)) {
        db.createObjectStore(STORES.emprestimos, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.cheques)) {
        db.createObjectStore(STORES.cheques, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.outbox)) {
        db.createObjectStore(STORES.outbox, { keyPath: "operationId" });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: "key" });
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        openPromises.delete(dbName);
      };
      resolve(db);
    };

    req.onerror = () => {
      openPromises.delete(dbName);
      reject(req.error || new Error("Erro ao abrir IndexedDB"));
    };
  });

  openPromises.set(dbName, p);
  return p;
}

function txPromise(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Erro na transação IndexedDB"));
    tx.onabort = () => reject(tx.error || new Error("Transação abortada"));
  });
}

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Erro na leitura IndexedDB"));
  });
}

export async function clearUserDatabase(userId: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const dbName = getDbName(userId);
  const existing = openPromises.get(dbName);
  if (existing) {
    try {
      const db = await existing;
      db.close();
    } catch {
      // ignora
    }
    openPromises.delete(dbName);
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

export async function saveBootstrapData(userId: string, data: BootstrapResponse): Promise<void> {
  const db = await openOfflineDb(userId);

  // Preserva registros pendentes criados offline (pendingSync === true) que ainda estão na outbox
  const [existingClientes, existingParceiros, existingEmprestimos, existingCheques, ops] =
    await Promise.all([
      getAllClientes(userId),
      getAllParceiros(userId),
      getAllEmprestimos(userId),
      getAllCheques(userId),
      getPendingOperationsOrdered(userId),
    ]);

  const pendingEntityIds = new Set(
    ops
      .filter((o) =>
        o.type === "CREATE_CLIENTE" ||
        o.type === "CREATE_EMPRESTIMO" ||
        o.type === "CREATE_CHEQUE" ||
        o.type === "CREATE_PARCEIRO"
      )
      .map((o) => o.entityId)
  );

  const serverClienteIds = new Set(data.clientes.map((c) => c.id));
  const pendingClientes = existingClientes.filter(
    (c) => c.pendingSync && pendingEntityIds.has(c.id) && !serverClienteIds.has(c.id)
  );

  const serverParceiroIds = new Set(data.parceiros.map((p) => p.id));
  const pendingParceiros = existingParceiros.filter(
    (p) => p.pendingSync && pendingEntityIds.has(p.id) && !serverParceiroIds.has(p.id)
  );

  const serverEmpIds = new Set(data.emprestimos.map((e) => e.id));
  const pendingEmps = existingEmprestimos.filter(
    (e) => e.pendingSync && pendingEntityIds.has(e.id) && !serverEmpIds.has(e.id)
  );

  const serverChequeIds = new Set(data.cheques.map((c) => c.id));
  const pendingCheques = existingCheques.filter(
    (c) => c.pendingSync && pendingEntityIds.has(c.id) && !serverChequeIds.has(c.id)
  );

  const tx = db.transaction(
    [STORES.clientes, STORES.parceiros, STORES.emprestimos, STORES.cheques, STORES.meta],
    "readwrite"
  );

  const cStore = tx.objectStore(STORES.clientes);
  cStore.clear();
  for (const c of data.clientes) cStore.put({ ...c, pendingSync: false });
  for (const c of pendingClientes) cStore.put(c);

  const pStore = tx.objectStore(STORES.parceiros);
  pStore.clear();
  for (const p of data.parceiros) pStore.put({ ...p, pendingSync: false });
  for (const p of pendingParceiros) pStore.put(p);

  const eStore = tx.objectStore(STORES.emprestimos);
  eStore.clear();
  for (const e of data.emprestimos) eStore.put({ ...e, pendingSync: false });
  for (const e of pendingEmps) eStore.put(e);

  const chStore = tx.objectStore(STORES.cheques);
  chStore.clear();
  for (const ch of data.cheques) chStore.put({ ...ch, pendingSync: false });
  for (const ch of pendingCheques) chStore.put(ch);

  const mStore = tx.objectStore(STORES.meta);
  mStore.put({ key: "syncedAt", value: data.syncedAt });
  mStore.put({ key: "config", value: data.config });
  mStore.put({
    key: "counts",
    value: {
      clientes: data.clientes.length,
      emprestimos: data.emprestimos.length,
      parceiros: data.parceiros.length,
      cheques: data.cheques.length,
    },
  });

  await txPromise(tx);
}

export async function getMeta<T = unknown>(userId: string, key: string): Promise<T | null> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.meta, "readonly");
  const row = await reqPromise(tx.objectStore(STORES.meta).get(key));
  return row ? (row.value as T) : null;
}

export async function getCachedConfig(userId: string): Promise<CachedConfig> {
  const cfg = await getMeta<CachedConfig>(userId, "config");
  return (
    cfg || {
      regra_carencia_30_dias: false,
      regra_carencia_10_dias: false,
      perguntar_whatsapp_renovacao: false,
    }
  );
}

export async function getAllClientes(userId: string): Promise<CachedCliente[]> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.clientes, "readonly");
  return reqPromise(tx.objectStore(STORES.clientes).getAll());
}

export async function getClienteById(userId: string, id: string): Promise<CachedCliente | null> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.clientes, "readonly");
  const res = await reqPromise(tx.objectStore(STORES.clientes).get(id));
  return res || null;
}

export async function putCachedCliente(userId: string, cliente: CachedCliente): Promise<void> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.clientes, "readwrite");
  tx.objectStore(STORES.clientes).put(cliente);
  await txPromise(tx);
}

export async function deleteCachedCliente(userId: string, id: string): Promise<void> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.clientes, "readwrite");
  tx.objectStore(STORES.clientes).delete(id);
  await txPromise(tx);
}

export async function getAllParceiros(userId: string): Promise<CachedParceiro[]> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.parceiros, "readonly");
  return reqPromise(tx.objectStore(STORES.parceiros).getAll());
}

export async function putCachedParceiro(userId: string, parceiro: CachedParceiro): Promise<void> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.parceiros, "readwrite");
  tx.objectStore(STORES.parceiros).put(parceiro);
  await txPromise(tx);
}

export async function deleteCachedParceiro(userId: string, id: string): Promise<void> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.parceiros, "readwrite");
  tx.objectStore(STORES.parceiros).delete(id);
  await txPromise(tx);
}

export async function getAllEmprestimos(userId: string): Promise<CachedEmprestimo[]> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.emprestimos, "readonly");
  return reqPromise(tx.objectStore(STORES.emprestimos).getAll());
}

export async function getEmprestimoById(userId: string, id: string): Promise<CachedEmprestimo | null> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.emprestimos, "readonly");
  const res = await reqPromise(tx.objectStore(STORES.emprestimos).get(id));
  return res || null;
}

export async function putCachedEmprestimo(userId: string, emp: CachedEmprestimo): Promise<void> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.emprestimos, "readwrite");
  tx.objectStore(STORES.emprestimos).put(emp);
  await txPromise(tx);
}

export async function deleteCachedEmprestimo(userId: string, id: string): Promise<void> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.emprestimos, "readwrite");
  tx.objectStore(STORES.emprestimos).delete(id);
  await txPromise(tx);
}

export async function getAllCheques(userId: string): Promise<CachedCheque[]> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.cheques, "readonly");
  return reqPromise(tx.objectStore(STORES.cheques).getAll());
}

export async function putCachedCheque(userId: string, cheque: CachedCheque): Promise<void> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.cheques, "readwrite");
  tx.objectStore(STORES.cheques).put(cheque);
  await txPromise(tx);
}

export async function deleteCachedCheque(userId: string, id: string): Promise<void> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.cheques, "readwrite");
  tx.objectStore(STORES.cheques).delete(id);
  await txPromise(tx);
}

// Normalização sem acentos — espelha /api/clientes
const norm = (s: string) =>
  (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export async function searchCachedClientes(
  userId: string,
  query: string,
  page = 1,
  limit = 16
): Promise<{ clientes: CachedCliente[]; totalCount: number; hasMore: boolean }> {
  const [todos, ops] = await Promise.all([getAllClientes(userId), getPendingOperationsOrdered(userId)]);

  // Aplica exclusões e edições pendentes em memória (reversível se o usuário cancelar)
  const deletedIds = new Set(
    ops.filter((o) => o.type === "DELETE_CLIENTE").map((o) => o.entityId)
  );
  const updateMap = new Map<string, OfflineOperation>();
  for (const o of ops) {
    if (o.type === "UPDATE_CLIENTE") updateMap.set(o.entityId, o);
  }

  const efetivos = todos
    .filter((c) => !deletedIds.has(c.id))
    .map((c) => {
      const upd = updateMap.get(c.id);
      if (upd && upd.type === "UPDATE_CLIENTE") {
        return {
          ...c,
          nome: upd.payload.nome,
          telefone: upd.payload.telefone.replace(/\D/g, ""),
          cidade: upd.payload.cidade || "Bauru",
          documento: upd.payload.documento || "",
          endereco: upd.payload.endereco,
          referencia: upd.payload.referencia,
          quem_indicou: upd.payload.quemIndicou,
          email: upd.payload.email,
          observacoes: upd.payload.observacoes,
          blacklist: upd.payload.blacklist,
          pendingSync: true,
        };
      }
      return c;
    })
    .sort((a, b) => {
      // Pendentes primeiro, depois ordem alfabética
      if (Boolean(a.pendingSync) !== Boolean(b.pendingSync)) {
        return a.pendingSync ? -1 : 1;
      }
      return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
    });

  const qRaw = query.trim();
  let filtrados = efetivos;
  if (qRaw) {
    const q = norm(qRaw);
    const words = q.replace(/\s+/g, " ").split(" ").filter(Boolean);
    filtrados = efetivos.filter((c) => {
      const nomeNorm = norm(c.nome);
      const nomeMatch = words.every((w) => nomeNorm.includes(w));
      return (
        nomeMatch ||
        (c.telefone || "").includes(qRaw) ||
        norm(c.cidade).includes(q) ||
        norm(c.documento).includes(q)
      );
    });
  }

  const offset = (page - 1) * limit;
  const paginados = filtrados.slice(offset, offset + limit);
  return {
    clientes: paginados,
    totalCount: filtrados.length,
    hasMore: offset + paginados.length < filtrados.length,
  };
}

// Prioridade de sincronização: criações base antes de dependentes, respeitando FIFO dentro da prioridade
const OP_PRIORITY: Record<OfflineOperationType, number> = {
  CREATE_PARCEIRO: 1,
  CREATE_CLIENTE: 1,
  UPDATE_PARCEIRO: 2,
  UPDATE_CLIENTE: 2,
  TOGGLE_CLIENT_BLACKLIST: 2,
  CREATE_EMPRESTIMO: 3,
  CREATE_CHEQUE: 3,
  UPDATE_EMPRESTIMO: 4,
  PAY_NEXT_INSTALLMENT: 4,
  PAY_INSTALLMENT_BY_ID: 4,
  PAY_FULL_LOAN: 4,
  RECEBER_SO_JUROS: 4,
  RENEGOCIAR_EMPRESTIMO: 4,
  REPROGRAMAR_EMPRESTIMO: 4,
  TOGGLE_PAUSAR_EMPRESTIMO: 4,
  SALVAR_DATA_PREVISTA: 4,
  ATUALIZAR_DATA_PAGAMENTO_PARCELA: 4,
  ALTERAR_EMPRESTIMOS_MASSA: 4,
  UPDATE_CHEQUE_STATUS: 4,
  DELETE_CHEQUE: 5,
  DELETE_EMPRESTIMO: 5,
  DELETE_CLIENTE: 6,
  DELETE_PARCEIRO: 6,
};

export async function getPendingOperationsOrdered(userId: string): Promise<OfflineOperation[]> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.outbox, "readonly");
  const all: OfflineOperation[] = await reqPromise(tx.objectStore(STORES.outbox).getAll());
  return all.sort((a, b) => {
    const pa = OP_PRIORITY[a.type] ?? 4;
    const pb = OP_PRIORITY[b.type] ?? 4;
    if (pa !== pb) return pa - pb;
    return a.createdAt - b.createdAt;
  });
}

export async function enqueueOperation(userId: string, op: OfflineOperation): Promise<void> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(
    [STORES.outbox, STORES.clientes, STORES.parceiros, STORES.emprestimos, STORES.cheques],
    "readwrite"
  );

  tx.objectStore(STORES.outbox).put(op);

  // Inserções otimistas para novas entidades criadas offline (removidas se usuário cancelar!)
  if (op.type === "CREATE_CLIENTE") {
    const c: CachedCliente = {
      id: op.entityId,
      nome: op.payload.nome.trim(),
      telefone: op.payload.telefone.replace(/\D/g, ""),
      cidade: op.payload.cidade || "Bauru",
      documento: op.payload.documento || "",
      endereco: op.payload.endereco,
      referencia: op.payload.referencia,
      quem_indicou: op.payload.quemIndicou,
      email: op.payload.email,
      blacklist: op.payload.blacklist,
      observacoes: op.payload.observacoes,
      foto_url: op.payload.fotoBase64,
      criado_em: new Date(op.createdAt).toISOString(),
      pendingSync: true,
    };
    tx.objectStore(STORES.clientes).put(c);
  } else if (op.type === "CREATE_PARCEIRO") {
    const p: CachedParceiro = {
      id: op.entityId,
      nome: op.payload.nome.trim(),
      telefone: op.payload.telefone || null,
      criado_em: new Date(op.createdAt).toISOString(),
      pendingSync: true,
    };
    tx.objectStore(STORES.parceiros).put(p);
  } else if (op.type === "CREATE_EMPRESTIMO") {
    const e: CachedEmprestimo = {
      id: op.entityId,
      cliente_id: op.payload.clienteId,
      parceiro_id: op.payload.parceiroId,
      valor_emprestado: op.payload.valorEmprestado,
      taxa_juros: op.payload.taxaJuros,
      taxa_multa: op.payload.atrasoTipo === "percentual_dia" ? op.payload.atrasoValor : 0,
      juros_atraso: op.payload.atrasoTipo === "percentual_dia" ? op.payload.atrasoValor : 0,
      atraso_tipo: op.payload.atrasoTipo,
      atraso_valor: op.payload.atrasoValor,
      data_vencimento: op.payload.dataVencimento,
      data_inicio: op.payload.dataInicio,
      data_prevista_pagamento: null,
      status: "ativo",
      tipo_pagamento: op.payload.tipoPagamento,
      frequencia: op.payload.frequencia,
      categoria: op.payload.categoria || "Sem categoria",
      observacoes: op.payload.observacoes,
      criado_em: new Date(op.createdAt).toISOString(),
      cliente: {
        id: op.payload.clienteId,
        nome: op.payload.clienteNome,
        telefone: op.payload.clienteTelefone,
        cidade: "",
      },
      parceiro: op.payload.parceiroId
        ? { id: op.payload.parceiroId, nome: op.payload.parceiroNome || "Parceiro" }
        : null,
      parcelas: op.payload.parcelas.map((p, idx) => ({
        id: `pending-parcela-${op.entityId}-${idx + 1}`,
        numero: p.numero,
        valor: p.valor,
        valor_pago: null,
        data_vencimento: p.data_vencimento,
        status: "aberto",
        data_pagamento: null,
      })),
      pendingSync: true,
    };
    tx.objectStore(STORES.emprestimos).put(e);
  } else if (op.type === "CREATE_CHEQUE") {
    const ch: CachedCheque = {
      id: op.entityId,
      cliente_id: op.payload.cliente_id,
      parceiro_id: op.payload.parceiro_id || null,
      titular: null,
      banco: null,
      valor: op.payload.valor,
      taxa_desconto: op.payload.taxa_desconto,
      valor_liquido: op.payload.valor_liquido,
      data_compensacao: op.payload.data_compensacao,
      status: "em_maos",
      foto_url: op.payload.foto_url || null,
      observacoes: op.payload.observacoes || null,
      criado_em: new Date(op.createdAt).toISOString(),
      cliente: op.payload.clienteNome
        ? { nome: op.payload.clienteNome, telefone: op.payload.clienteTelefone || "" }
        : null,
      parceiro: op.payload.parceiroNome ? { nome: op.payload.parceiroNome } : null,
      pendingSync: true,
    };
    tx.objectStore(STORES.cheques).put(ch);
  }

  await txPromise(tx);
}

export async function updateOperationStatus(
  userId: string,
  operationId: string,
  patch: Partial<Pick<OfflineOperation, "status" | "attempts" | "lastError">>
): Promise<void> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(STORES.outbox, "readwrite");
  const store = tx.objectStore(STORES.outbox);
  const current: OfflineOperation | undefined = await reqPromise(store.get(operationId));
  if (current) {
    store.put({ ...current, ...patch });
  }
  await txPromise(tx);
}

export async function markOperationSynced(userId: string, op: OfflineOperation): Promise<void> {
  const db = await openOfflineDb(userId);
  const tx = db.transaction(
    [STORES.outbox, STORES.clientes, STORES.parceiros, STORES.emprestimos, STORES.cheques],
    "readwrite"
  );

  tx.objectStore(STORES.outbox).delete(op.operationId);

  if (op.type === "CREATE_CLIENTE") {
    const store = tx.objectStore(STORES.clientes);
    const existing = await reqPromise(store.get(op.entityId));
    if (existing) store.put({ ...existing, pendingSync: false, foto_url: null });
  } else if (op.type === "CREATE_PARCEIRO") {
    const store = tx.objectStore(STORES.parceiros);
    const existing = await reqPromise(store.get(op.entityId));
    if (existing) store.put({ ...existing, pendingSync: false });
  } else if (op.type === "CREATE_EMPRESTIMO") {
    const store = tx.objectStore(STORES.emprestimos);
    const existing = await reqPromise(store.get(op.entityId));
    if (existing) store.put({ ...existing, pendingSync: false });
  } else if (op.type === "CREATE_CHEQUE") {
    const store = tx.objectStore(STORES.cheques);
    const existing = await reqPromise(store.get(op.entityId));
    if (existing) store.put({ ...existing, pendingSync: false });
  } else if (op.type === "DELETE_CLIENTE") {
    tx.objectStore(STORES.clientes).delete(op.entityId);
  } else if (op.type === "DELETE_EMPRESTIMO") {
    tx.objectStore(STORES.emprestimos).delete(op.entityId);
  } else if (op.type === "DELETE_CHEQUE") {
    tx.objectStore(STORES.cheques).delete(op.entityId);
  } else if (op.type === "DELETE_PARCEIRO") {
    tx.objectStore(STORES.parceiros).delete(op.entityId);
  }

  await txPromise(tx);
}

/**
 * Cancela uma operação pendente e reverte quaisquer criações otimistas (inclusive dependentes em cascata).
 * Retorna os IDs das operações removidas.
 */
export async function cancelPendingOperation(
  userId: string,
  operationId: string
): Promise<OfflineOperation[]> {
  const all = await getPendingOperationsOrdered(userId);
  const target = all.find((o) => o.operationId === operationId);
  if (!target) return [];

  // Coleta target + dependentes em cascata (ex.: cancelar CREATE_CLIENTE cancela CREATE_EMPRESTIMO dele)
  const toRemoveIds = new Set<string>([target.operationId]);
  const removedEntityIds = new Set<string>();
  if (
    target.type === "CREATE_CLIENTE" ||
    target.type === "CREATE_EMPRESTIMO" ||
    target.type === "CREATE_CHEQUE" ||
    target.type === "CREATE_PARCEIRO"
  ) {
    removedEntityIds.add(target.entityId);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const op of all) {
      if (toRemoveIds.has(op.operationId)) continue;
      if (
        (op.dependsOnEntityId && removedEntityIds.has(op.dependsOnEntityId)) ||
        removedEntityIds.has(op.entityId)
      ) {
        toRemoveIds.add(op.operationId);
        if (
          op.type === "CREATE_CLIENTE" ||
          op.type === "CREATE_EMPRESTIMO" ||
          op.type === "CREATE_CHEQUE" ||
          op.type === "CREATE_PARCEIRO"
        ) {
          removedEntityIds.add(op.entityId);
        }
        changed = true;
      }
    }
  }

  const removedOps = all.filter((o) => toRemoveIds.has(o.operationId));

  const db = await openOfflineDb(userId);
  const tx = db.transaction(
    [STORES.outbox, STORES.clientes, STORES.parceiros, STORES.emprestimos, STORES.cheques],
    "readwrite"
  );

  for (const op of removedOps) {
    tx.objectStore(STORES.outbox).delete(op.operationId);
    if (op.type === "CREATE_CLIENTE") {
      tx.objectStore(STORES.clientes).delete(op.entityId);
    } else if (op.type === "CREATE_EMPRESTIMO") {
      tx.objectStore(STORES.emprestimos).delete(op.entityId);
    } else if (op.type === "CREATE_CHEQUE") {
      tx.objectStore(STORES.cheques).delete(op.entityId);
    } else if (op.type === "CREATE_PARCEIRO") {
      tx.objectStore(STORES.parceiros).delete(op.entityId);
    }
  }

  await txPromise(tx);
  return removedOps;
}
