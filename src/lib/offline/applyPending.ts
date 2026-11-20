import { calcularProximaDataRenovacao, parseIsoDateUTC } from "@/lib/renovacao";
import type {
  CachedCheque,
  CachedCliente,
  CachedEmprestimo,
  CachedParceiro,
  OfflineOperation,
} from "./types";

/**
 * Sobrepõe as operações pendentes da outbox sobre os dados em cache (em memória, não destrutivo).
 * Se o usuário clicar em "Cancelar" no banner superior, remover a operação restaura o estado original.
 */
export function applyPendingToClientes(
  clientes: CachedCliente[],
  ops: OfflineOperation[]
): (CachedCliente & { pendingActionLabel?: string })[] {
  const deleted = new Set<string>();
  const map = new Map<string, CachedCliente & { pendingActionLabel?: string }>();

  for (const c of clientes) {
    map.set(c.id, { ...c });
  }

  for (const op of ops) {
    if (op.type === "DELETE_CLIENTE") {
      deleted.add(op.payload.clienteId || op.entityId);
    } else if (op.type === "UPDATE_CLIENTE") {
      const cur = map.get(op.payload.id || op.entityId);
      if (cur) {
        map.set(cur.id, {
          ...cur,
          nome: op.payload.nome,
          telefone: op.payload.telefone.replace(/\D/g, ""),
          cidade: op.payload.cidade || "Bauru",
          documento: op.payload.documento || "",
          endereco: op.payload.endereco,
          referencia: op.payload.referencia,
          quem_indicou: op.payload.quemIndicou,
          email: op.payload.email,
          observacoes: op.payload.observacoes,
          blacklist: op.payload.blacklist,
          pendingSync: true,
          pendingActionLabel: op.label,
        });
      }
    } else if (op.type === "TOGGLE_CLIENT_BLACKLIST") {
      const cur = map.get(op.payload.clientId);
      if (cur) {
        map.set(cur.id, {
          ...cur,
          blacklist: !op.payload.currentStatus,
          pendingSync: true,
          pendingActionLabel: op.label,
        });
      }
    } else if (op.type === "CREATE_CLIENTE") {
      const cur = map.get(op.entityId);
      if (cur) {
        cur.pendingSync = true;
        cur.pendingActionLabel = op.label;
      }
    }
  }

  return Array.from(map.values()).filter((c) => !deleted.has(c.id));
}

export function applyPendingToEmprestimos(
  emprestimos: CachedEmprestimo[],
  ops: OfflineOperation[]
): (CachedEmprestimo & { pendingActionLabel?: string })[] {
  const deletedEmp = new Set<string>();
  const deletedClientes = new Set<string>();
  const map = new Map<string, CachedEmprestimo & { pendingActionLabel?: string }>();

  for (const e of emprestimos) {
    map.set(e.id, {
      ...e,
      cliente: { ...e.cliente },
      parcelas: (e.parcelas || []).map((p) => ({ ...p })),
    });
  }

  for (const op of ops) {
    switch (op.type) {
      case "DELETE_CLIENTE": {
        deletedClientes.add(op.payload.clienteId || op.entityId);
        break;
      }
      case "DELETE_EMPRESTIMO": {
        deletedEmp.add(op.payload.emprestimoId || op.entityId);
        break;
      }
      case "CREATE_EMPRESTIMO": {
        const cur = map.get(op.entityId);
        if (cur) {
          cur.pendingSync = true;
          cur.pendingActionLabel = op.label;
        }
        break;
      }
      case "UPDATE_EMPRESTIMO": {
        const cur = map.get(op.payload.emprestimoId);
        if (cur) {
          cur.valor_emprestado = op.payload.valorEmprestado;
          cur.taxa_juros = op.payload.taxaJuros;
          cur.atraso_tipo = op.payload.atrasoTipo;
          cur.atraso_valor = op.payload.atrasoValor;
          cur.tipo_pagamento = op.payload.tipoPagamento;
          cur.frequencia = op.payload.frequencia;
          cur.categoria = op.payload.categoria;
          cur.observacoes = op.payload.observacoes;
          cur.data_inicio = op.payload.dataInicio;
          cur.data_vencimento = op.payload.dataVencimento;
          cur.parceiro_id = op.payload.parceiroId;
          cur.pendingSync = true;
          cur.pendingActionLabel = op.label;
        }
        break;
      }
      case "PAY_NEXT_INSTALLMENT": {
        const cur = map.get(op.payload.emprestimoId);
        if (cur) {
          const prox = cur.parcelas.find((p) => p.status === "aberto");
          if (prox) {
            prox.status = op.payload.withDelay ? "pago_com_atraso" : "pago";
            prox.data_pagamento = new Date(op.createdAt).toISOString();
            prox.valor_pago = prox.valor;
          }
          if (cur.parcelas.every((p) => p.status !== "aberto")) {
            cur.status = op.payload.withDelay ? "quitado_com_atraso" : "quitado";
          }
          cur.pendingSync = true;
          cur.pendingActionLabel = op.label;
        }
        break;
      }
      case "PAY_INSTALLMENT_BY_ID": {
        const cur = map.get(op.payload.emprestimoId);
        if (cur) {
          const target = cur.parcelas.find((p) => p.id === op.payload.parcelaId);
          if (target) {
            target.status = op.payload.withDelay ? "pago_com_atraso" : "pago";
            target.data_pagamento = new Date(op.createdAt).toISOString();
            target.valor_pago = target.valor;
          }
          if (cur.parcelas.every((p) => p.status !== "aberto")) {
            cur.status = op.payload.withDelay ? "quitado_com_atraso" : "quitado";
          }
          cur.pendingSync = true;
          cur.pendingActionLabel = op.label;
        }
        break;
      }
      case "PAY_FULL_LOAN": {
        const cur = map.get(op.payload.emprestimoId);
        if (cur) {
          for (const p of cur.parcelas) {
            if (p.status === "aberto") {
              p.status = op.payload.withDelay ? "pago_com_atraso" : "pago";
              p.data_pagamento = new Date(op.createdAt).toISOString();
              p.valor_pago = p.valor;
            }
          }
          cur.status = op.payload.withDelay ? "quitado_com_atraso" : "quitado";
          cur.pendingSync = true;
          cur.pendingActionLabel = op.label;
        }
        break;
      }
      case "RECEBER_SO_JUROS": {
        const cur = map.get(op.payload.emprestimoId);
        if (cur) {
          const aberta = cur.parcelas.find((p) => p.status === "aberto");
          if (aberta) {
            const juros = cur.valor_emprestado * (cur.taxa_juros / 100);
            const dtCustom = op.payload.novaDataVencimento
              ? parseIsoDateUTC(op.payload.novaDataVencimento)
              : null;
            const freqEfetiva = op.payload.atualizarFrequencia || cur.frequencia;
            const dt = dtCustom ?? calcularProximaDataRenovacao(aberta.data_vencimento, freqEfetiva);
            aberta.status = "pago_renovacao";
            aberta.valor_pago = juros;
            aberta.data_pagamento = new Date(op.createdAt).toISOString();
            const maxNum = cur.parcelas.reduce((m, p) => Math.max(m, p.numero), 0);
            cur.parcelas.push({
              id: `pending-renov-${op.operationId}`,
              numero: maxNum + 1,
              valor: Number((cur.valor_emprestado + juros).toFixed(2)),
              valor_pago: null,
              data_vencimento: dt.toISOString(),
              status: "aberto",
              data_pagamento: null,
            });
            cur.data_vencimento = dt.toISOString();
            if (op.payload.atualizarFrequencia) {
              cur.frequencia = op.payload.atualizarFrequencia;
            }
          }
          cur.pendingSync = true;
          cur.pendingActionLabel = op.label;
        }
        break;
      }
      case "TOGGLE_PAUSAR_EMPRESTIMO": {
        const cur = map.get(op.payload.emprestimoId);
        if (cur) {
          cur.status = op.payload.statusAtual === "pausado" ? "ativo" : "pausado";
          cur.pendingSync = true;
          cur.pendingActionLabel = op.label;
        }
        break;
      }
      case "SALVAR_DATA_PREVISTA": {
        const cur = map.get(op.payload.emprestimoId);
        if (cur) {
          cur.data_prevista_pagamento = op.payload.data;
          cur.pendingSync = true;
          cur.pendingActionLabel = op.label;
        }
        break;
      }
      case "REPROGRAMAR_EMPRESTIMO": {
        const cur = map.get(op.payload.emprestimoId);
        if (cur) {
          cur.data_vencimento = new Date(`${op.payload.novaDataVencimento}T00:00:00.000Z`).toISOString();
          cur.frequencia = op.payload.frequencia;
          cur.pendingSync = true;
          cur.pendingActionLabel = op.label;
        }
        break;
      }
      case "RENEGOCIAR_EMPRESTIMO": {
        const cur = map.get(op.payload.emprestimoId);
        if (cur) {
          cur.pendingSync = true;
          cur.pendingActionLabel = op.label;
        }
        break;
      }
      case "TOGGLE_CLIENT_BLACKLIST": {
        for (const e of map.values()) {
          if (e.cliente_id === op.payload.clientId) {
            e.cliente.blacklist = !op.payload.currentStatus;
          }
        }
        break;
      }
      case "ALTERAR_EMPRESTIMOS_MASSA": {
        for (const id of op.payload.ids) {
          if (op.payload.acao === "excluir") {
            deletedEmp.add(id);
          } else {
            const cur = map.get(id);
            if (cur) {
              if (op.payload.acao === "quitar") {
                cur.status = "quitado";
                cur.parcelas.forEach((p) => {
                  if (p.status === "aberto") p.status = "pago";
                });
              }
              cur.pendingSync = true;
              cur.pendingActionLabel = op.label;
            }
          }
        }
        break;
      }
    }
  }

  return Array.from(map.values()).filter(
    (e) => !deletedEmp.has(e.id) && !deletedClientes.has(e.cliente_id)
  );
}

export function applyPendingToCheques(
  cheques: CachedCheque[],
  ops: OfflineOperation[]
): (CachedCheque & { pendingActionLabel?: string })[] {
  const deleted = new Set<string>();
  const map = new Map<string, CachedCheque & { pendingActionLabel?: string }>();

  for (const ch of cheques) {
    map.set(ch.id, { ...ch });
  }

  for (const op of ops) {
    if (op.type === "DELETE_CHEQUE") {
      deleted.add(op.payload.id || op.entityId);
    } else if (op.type === "UPDATE_CHEQUE_STATUS") {
      const cur = map.get(op.payload.id);
      if (cur) {
        cur.status = op.payload.newStatus;
        cur.pendingSync = true;
        cur.pendingActionLabel = op.label;
      }
    } else if (op.type === "CREATE_CHEQUE") {
      const cur = map.get(op.entityId);
      if (cur) {
        cur.pendingSync = true;
        cur.pendingActionLabel = op.label;
      }
    }
  }

  return Array.from(map.values()).filter((ch) => !deleted.has(ch.id));
}

export function applyPendingToParceiros(
  parceiros: CachedParceiro[],
  ops: OfflineOperation[]
): (CachedParceiro & { pendingActionLabel?: string })[] {
  const deleted = new Set<string>();
  const map = new Map<string, CachedParceiro & { pendingActionLabel?: string }>();

  for (const p of parceiros) {
    map.set(p.id, { ...p });
  }

  for (const op of ops) {
    if (op.type === "DELETE_PARCEIRO") {
      deleted.add(op.payload.id || op.entityId);
    } else if (op.type === "UPDATE_PARCEIRO") {
      const cur = map.get(op.payload.id);
      if (cur) {
        cur.nome = op.payload.nome;
        cur.telefone = op.payload.telefone;
        cur.pendingSync = true;
        cur.pendingActionLabel = op.label;
      }
    } else if (op.type === "CREATE_PARCEIRO") {
      const cur = map.get(op.entityId);
      if (cur) {
        cur.pendingSync = true;
        cur.pendingActionLabel = op.label;
      }
    }
  }

  return Array.from(map.values()).filter((p) => !deleted.has(p.id));
}
