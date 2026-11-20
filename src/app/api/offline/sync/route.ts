import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { verifyRequestAuth } from "@/lib/authServer";
import { criarClienteNoBanco, atualizarClienteNoBanco } from "@/lib/services/clienteService";
import { criarEmprestimoNoBanco } from "@/lib/services/emprestimoService";
import {
  payNextInstallment,
  payInstallmentById,
  payFullLoan,
  receberSoJurosEmprestimo,
  renegociarEmprestimo,
  reprogramarEmprestimo,
  togglePausarEmprestimo,
  salvarDataPrevistaPagamento,
  atualizarDataPagamentoParcela,
  toggleClientBlacklist,
  deleteLoan,
  updateEmprestimo,
} from "@/app/emprestimos/[id]/actions";
import { alterarEmprestimosEmMassa } from "@/app/clientes/[id]/actions";
import type { OfflineOperation, SyncOperationResult } from "@/lib/offline/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let syncOpsTableReady = false;

async function ensureSyncOpsTable() {
  if (syncOpsTableReady) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS offline_sync_ops (
        operation_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        op_type TEXT NOT NULL,
        entity_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    syncOpsTableReady = true;
  } catch (err) {
    console.warn("[offline/sync] Aviso ao garantir tabela offline_sync_ops:", err);
  }
}

async function isOperationRecorded(operationId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ operation_id: string }[]>(
      `SELECT operation_id FROM offline_sync_ops WHERE operation_id = $1 LIMIT 1`,
      operationId
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function recordOperationSynced(op: OfflineOperation): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO offline_sync_ops (operation_id, user_id, op_type, entity_id) VALUES ($1, $2, $3, $4) ON CONFLICT (operation_id) DO NOTHING`,
      op.operationId,
      op.userId,
      op.type,
      op.entityId || null
    );
  } catch (err) {
    console.warn("[offline/sync] Não foi possível gravar log de idempotência:", err);
  }
}

function buildFormDataFromUpdateEmprestimo(payload: Extract<OfflineOperation, { type: "UPDATE_EMPRESTIMO" }>["payload"]) {
  const fd = new FormData();
  fd.set("clienteId", payload.clienteId);
  fd.set("parceiroId", payload.parceiroId || "");
  fd.set("valorEmprestado", String(payload.valorEmprestado));
  fd.set("tipoPagamento", payload.tipoPagamento);
  fd.set("frequencia", payload.frequencia);
  fd.set("taxaJuros", String(payload.taxaJuros));
  fd.set("atrasoTipo", payload.atrasoTipo || "nenhum");
  fd.set("atrasoValor", String(payload.atrasoValor || 0));
  fd.set("dataInicio", payload.dataInicio);
  fd.set("dataVencimento", payload.dataVencimento);
  fd.set("categoria", payload.categoria || "Sem categoria");
  fd.set("observacoes", payload.observacoes || "");
  fd.set("recriarParcelas", payload.recriarParcelas ? "true" : "false");
  fd.set("parcelasJson", JSON.stringify(payload.parcelas || []));
  return fd;
}

export async function POST(request: NextRequest) {
  const auth = await verifyRequestAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: { userId?: string; operations?: OfflineOperation[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  if (body.userId && body.userId !== auth.userId) {
    return NextResponse.json(
      { error: "USER_MISMATCH: esta fila pertence a outro usuário." },
      { status: 403 }
    );
  }

  const operations = Array.isArray(body.operations) ? body.operations : [];
  if (operations.length === 0) {
    return NextResponse.json({ results: [] });
  }

  await ensureSyncOpsTable();

  const results: SyncOperationResult[] = [];
  const failedEntityIds = new Set<string>();

  for (const op of operations) {
    if (!op || !op.operationId || !op.type) {
      results.push({
        operationId: op?.operationId || "unknown",
        status: "error",
        error: "Operação malformada.",
      });
      continue;
    }

    // Se a entidade dependente falhou neste mesmo lote, segura esta operação para próxima tentativa
    if (op.dependsOnEntityId && failedEntityIds.has(op.dependsOnEntityId)) {
      results.push({
        operationId: op.operationId,
        status: "error",
        entityId: op.entityId,
        error: "Aguardando sincronização do registro principal.",
      });
      if (op.entityId) failedEntityIds.add(op.entityId);
      continue;
    }

    // Idempotência universal por operationId
    if (await isOperationRecorded(op.operationId)) {
      results.push({
        operationId: op.operationId,
        status: "already_synced",
        entityId: op.entityId,
      });
      continue;
    }

    try {
      switch (op.type) {
        case "CREATE_CLIENTE": {
          const { cliente, alreadyExisted } = await criarClienteNoBanco({
            id: op.entityId,
            ...op.payload,
          });
          await recordOperationSynced(op);
          revalidatePath("/clientes");
          results.push({
            operationId: op.operationId,
            status: alreadyExisted ? "already_synced" : "synced",
            entityId: cliente.id,
          });
          break;
        }

        case "UPDATE_CLIENTE": {
          const cliente = await atualizarClienteNoBanco({
            ...op.payload,
            id: op.payload.id || op.entityId,
          });
          await recordOperationSynced(op);
          revalidatePath("/clientes");
          revalidatePath(`/clientes/${cliente.id}`);
          results.push({
            operationId: op.operationId,
            status: "synced",
            entityId: cliente.id,
          });
          break;
        }

        case "DELETE_CLIENTE": {
          const id = op.payload.clienteId || op.entityId;
          const existe = await prisma.cliente.findUnique({ where: { id }, select: { id: true } });
          if (existe) {
            await prisma.cliente.delete({ where: { id } });
          }
          await recordOperationSynced(op);
          revalidatePath("/clientes");
          revalidatePath("/emprestimos");
          results.push({
            operationId: op.operationId,
            status: existe ? "synced" : "already_synced",
            entityId: id,
          });
          break;
        }

        case "TOGGLE_CLIENT_BLACKLIST": {
          await toggleClientBlacklist(
            op.payload.clientId,
            op.payload.currentStatus,
            op.payload.emprestimoId || ""
          );
          await recordOperationSynced(op);
          results.push({
            operationId: op.operationId,
            status: "synced",
            entityId: op.payload.clientId,
          });
          break;
        }

        case "CREATE_EMPRESTIMO": {
          const res = await criarEmprestimoNoBanco({
            id: op.entityId,
            clienteId: op.payload.clienteId,
            parceiroId: op.payload.parceiroId,
            valorEmprestado: op.payload.valorEmprestado,
            tipoPagamento: op.payload.tipoPagamento,
            frequencia: op.payload.frequencia,
            taxaJuros: op.payload.taxaJuros,
            atrasoTipo: op.payload.atrasoTipo,
            atrasoValor: op.payload.atrasoValor,
            dataInicio: op.payload.dataInicio,
            dataVencimento: op.payload.dataVencimento,
            categoria: op.payload.categoria,
            observacoes: op.payload.observacoes,
            parcelas: op.payload.parcelas,
            enviarPdfWhatsapp: op.payload.enviarPdfWhatsapp,
          });
          await recordOperationSynced(op);
          revalidatePath("/emprestimos");
          revalidatePath("/clientes");
          if (res.emprestimo?.id) revalidatePath(`/emprestimos/${res.emprestimo.id}`);
          results.push({
            operationId: op.operationId,
            status: res.alreadyExisted ? "already_synced" : "synced",
            entityId: res.emprestimo.id,
            ...(op.payload.enviarPdfWhatsapp && !res.alreadyExisted
              ? {
                  whatsappPdfMeta: {
                    clienteNome: res.clienteNome,
                    clienteTelefone: res.clienteTelefone,
                    legendaPdf: res.legendaPdf,
                    parcelas: res.parcelas,
                    tipoPagamento: op.payload.tipoPagamento,
                    valorEmprestado: op.payload.valorEmprestado,
                    taxaJuros: op.payload.taxaJuros,
                    taxaMulta: res.taxaMulta,
                    atrasoTipo: res.atrasoTipo,
                    atrasoValor: res.atrasoValor,
                    observacoes: op.payload.observacoes,
                  },
                }
              : {}),
          });
          break;
        }

        case "UPDATE_EMPRESTIMO": {
          const fd = buildFormDataFromUpdateEmprestimo(op.payload);
          await updateEmprestimo(op.payload.emprestimoId, fd);
          await recordOperationSynced(op);
          results.push({
            operationId: op.operationId,
            status: "synced",
            entityId: op.payload.emprestimoId,
          });
          break;
        }

        case "DELETE_EMPRESTIMO": {
          const id = op.payload.emprestimoId || op.entityId;
          const existe = await prisma.emprestimo.findUnique({ where: { id }, select: { id: true } });
          if (existe) {
            await deleteLoan(id);
          }
          await recordOperationSynced(op);
          results.push({
            operationId: op.operationId,
            status: existe ? "synced" : "already_synced",
            entityId: id,
          });
          break;
        }

        case "PAY_NEXT_INSTALLMENT": {
          const r = await payNextInstallment(
            op.payload.emprestimoId,
            op.payload.withDelay,
            op.payload.cobrarJurosAtraso,
            op.payload.enviarWhatsapp
          );
          await recordOperationSynced(op);
          results.push({
            operationId: op.operationId,
            status: "synced",
            entityId: op.payload.emprestimoId,
            whatsappEnviado: r.whatsappEnviado,
            whatsappErro: r.whatsappErro,
            whatsappTexto: r.whatsappTexto,
          });
          break;
        }

        case "PAY_INSTALLMENT_BY_ID": {
          const r = await payInstallmentById(
            op.payload.parcelaId,
            op.payload.withDelay,
            op.payload.cobrarJurosAtraso,
            op.payload.enviarWhatsapp
          );
          await recordOperationSynced(op);
          results.push({
            operationId: op.operationId,
            status: "synced",
            entityId: op.payload.emprestimoId,
            whatsappEnviado: r.whatsappEnviado,
            whatsappErro: r.whatsappErro,
            whatsappTexto: r.whatsappTexto,
          });
          break;
        }

        case "PAY_FULL_LOAN": {
          const r = await payFullLoan(
            op.payload.emprestimoId,
            op.payload.withDelay,
            op.payload.cobrarJurosAtraso,
            op.payload.enviarWhatsapp
          );
          await recordOperationSynced(op);
          results.push({
            operationId: op.operationId,
            status: "synced",
            entityId: op.payload.emprestimoId,
            whatsappEnviado: r.whatsappEnviado,
            whatsappErro: r.whatsappErro,
            whatsappTexto: r.whatsappTexto,
          });
          break;
        }

        case "RECEBER_SO_JUROS": {
          const r = await receberSoJurosEmprestimo(
            op.payload.emprestimoId,
            op.payload.enviarWhatsapp
          );
          await recordOperationSynced(op);
          results.push({
            operationId: op.operationId,
            status: "synced",
            entityId: op.payload.emprestimoId,
            whatsappEnviado: r.whatsappEnviado,
            whatsappErro: r.whatsappErro,
            whatsappTexto: r.whatsappTexto,
          });
          break;
        }

        case "RENEGOCIAR_EMPRESTIMO": {
          await renegociarEmprestimo(
            op.payload.emprestimoId,
            op.payload.valorAbatido,
            op.payload.aplicarJuros,
            op.payload.taxaJuros
          );
          await recordOperationSynced(op);
          results.push({
            operationId: op.operationId,
            status: "synced",
            entityId: op.payload.emprestimoId,
          });
          break;
        }

        case "REPROGRAMAR_EMPRESTIMO": {
          await reprogramarEmprestimo(
            op.payload.emprestimoId,
            op.payload.novaDataVencimento,
            op.payload.principalExtra,
            op.payload.taxaJuros,
            op.payload.frequencia,
            op.payload.enviarWhatsapp
          );
          await recordOperationSynced(op);
          results.push({
            operationId: op.operationId,
            status: "synced",
            entityId: op.payload.emprestimoId,
          });
          break;
        }

        case "TOGGLE_PAUSAR_EMPRESTIMO": {
          await togglePausarEmprestimo(op.payload.emprestimoId, op.payload.statusAtual);
          await recordOperationSynced(op);
          results.push({
            operationId: op.operationId,
            status: "synced",
            entityId: op.payload.emprestimoId,
          });
          break;
        }

        case "SALVAR_DATA_PREVISTA": {
          await salvarDataPrevistaPagamento(op.payload.emprestimoId, op.payload.data);
          await recordOperationSynced(op);
          results.push({
            operationId: op.operationId,
            status: "synced",
            entityId: op.payload.emprestimoId,
          });
          break;
        }

        case "ATUALIZAR_DATA_PAGAMENTO_PARCELA": {
          await atualizarDataPagamentoParcela(
            op.payload.parcelaId,
            new Date(op.payload.novaDataIso)
          );
          await recordOperationSynced(op);
          results.push({
            operationId: op.operationId,
            status: "synced",
            entityId: op.payload.emprestimoId,
          });
          break;
        }

        case "ALTERAR_EMPRESTIMOS_MASSA": {
          await alterarEmprestimosEmMassa(
            op.payload.clienteId,
            op.payload.ids,
            op.payload.acao,
            op.payload.opcoes
          );
          await recordOperationSynced(op);
          results.push({
            operationId: op.operationId,
            status: "synced",
            entityId: op.payload.clienteId,
          });
          break;
        }

        case "CREATE_CHEQUE": {
          const validId = UUID_RE.test(op.entityId) ? op.entityId : undefined;
          if (validId) {
            const exists = await prisma.cheque.findUnique({ where: { id: validId }, select: { id: true } });
            if (exists) {
              await recordOperationSynced(op);
              results.push({ operationId: op.operationId, status: "already_synced", entityId: validId });
              break;
            }
          }
          const created = await prisma.cheque.create({
            data: {
              ...(validId ? { id: validId } : {}),
              cliente_id: op.payload.cliente_id,
              parceiro_id: op.payload.parceiro_id || null,
              valor: op.payload.valor,
              taxa_desconto: op.payload.taxa_desconto,
              valor_liquido: op.payload.valor_liquido,
              data_compensacao: new Date(op.payload.data_compensacao),
              observacoes: op.payload.observacoes || null,
              foto_url: op.payload.foto_url || null,
              status: "em_maos",
            },
          });
          await recordOperationSynced(op);
          revalidatePath("/cheques");
          results.push({ operationId: op.operationId, status: "synced", entityId: created.id });
          break;
        }

        case "UPDATE_CHEQUE_STATUS": {
          await prisma.cheque.update({
            where: { id: op.payload.id },
            data: { status: op.payload.newStatus },
          });
          await recordOperationSynced(op);
          revalidatePath("/cheques");
          results.push({ operationId: op.operationId, status: "synced", entityId: op.payload.id });
          break;
        }

        case "DELETE_CHEQUE": {
          const existe = await prisma.cheque.findUnique({
            where: { id: op.payload.id },
            select: { id: true },
          });
          if (existe) {
            await prisma.cheque.delete({ where: { id: op.payload.id } });
          }
          await recordOperationSynced(op);
          revalidatePath("/cheques");
          results.push({
            operationId: op.operationId,
            status: existe ? "synced" : "already_synced",
            entityId: op.payload.id,
          });
          break;
        }

        case "CREATE_PARCEIRO": {
          const validId = UUID_RE.test(op.entityId) ? op.entityId : undefined;
          if (validId) {
            const exists = await prisma.parceiro.findUnique({ where: { id: validId }, select: { id: true } });
            if (exists) {
              await recordOperationSynced(op);
              results.push({ operationId: op.operationId, status: "already_synced", entityId: validId });
              break;
            }
          }
          const created = await prisma.parceiro.create({
            data: {
              ...(validId ? { id: validId } : {}),
              nome: op.payload.nome.trim(),
              telefone: op.payload.telefone || null,
            },
          });
          await recordOperationSynced(op);
          revalidatePath("/parceiros");
          revalidatePath("/emprestimos/novo");
          results.push({ operationId: op.operationId, status: "synced", entityId: created.id });
          break;
        }

        case "UPDATE_PARCEIRO": {
          await prisma.parceiro.update({
            where: { id: op.payload.id },
            data: {
              nome: op.payload.nome.trim(),
              telefone: op.payload.telefone || null,
            },
          });
          await recordOperationSynced(op);
          revalidatePath("/parceiros");
          results.push({ operationId: op.operationId, status: "synced", entityId: op.payload.id });
          break;
        }

        case "DELETE_PARCEIRO": {
          const existe = await prisma.parceiro.findUnique({
            where: { id: op.payload.id },
            select: { id: true },
          });
          if (existe) {
            await prisma.parceiro.delete({ where: { id: op.payload.id } });
          }
          await recordOperationSynced(op);
          revalidatePath("/parceiros");
          results.push({
            operationId: op.operationId,
            status: existe ? "synced" : "already_synced",
            entityId: op.payload.id,
          });
          break;
        }

        default: {
          results.push({
            operationId: (op as OfflineOperation).operationId,
            status: "error",
            error: "Tipo de operação desconhecido.",
          });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao sincronizar operação.";
      if (op.entityId) failedEntityIds.add(op.entityId);
      results.push({
        operationId: op.operationId,
        status: "error",
        entityId: op.entityId,
        error: msg,
      });
    }
  }

  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
