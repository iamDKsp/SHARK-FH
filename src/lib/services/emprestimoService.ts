import { prisma } from "@/lib/db";
import type { TipoAtraso } from "@/lib/jurosAtraso";
import { montarContexto, renderizarEvento } from "@/lib/mensagens/servidor";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ParcelaInput {
  numero: number;
  valor: number;
  data_vencimento: string;
}

export interface CriarEmprestimoInput {
  id?: string;
  clienteId: string;
  parceiroId?: string | null;
  valorEmprestado: number;
  tipoPagamento: string;
  frequencia: string;
  taxaJuros: number;
  atrasoTipo?: string | null;
  atrasoValor?: number | null;
  dataInicio: string;
  dataVencimento: string;
  categoria?: string | null;
  observacoes?: string | null;
  parcelas?: ParcelaInput[];
  enviarPdfWhatsapp?: boolean;
}

export function sanearRegraAtraso(atrasoTipo?: string | null, atrasoValor?: number | null): {
  tipo: TipoAtraso;
  valor: number;
  taxaMulta: number;
} {
  const tipo: TipoAtraso =
    atrasoTipo === "fixo_dia" || atrasoTipo === "percentual_dia" ? atrasoTipo : "nenhum";
  const valorNum = Number(atrasoValor ?? 0);
  const valor = Number.isFinite(valorNum) && valorNum > 0 ? Math.round(valorNum * 100) / 100 : 0;
  if (tipo === "nenhum" || valor === 0) {
    return { tipo: "nenhum", valor: 0, taxaMulta: 0 };
  }
  return {
    tipo,
    valor,
    taxaMulta: tipo === "percentual_dia" ? Math.min(valor, 999.99) : 0,
  };
}

export async function criarEmprestimoNoBanco(input: CriarEmprestimoInput) {
  if (!input.clienteId || !input.valorEmprestado || !input.dataInicio || !input.dataVencimento) {
    throw new Error("Preencha todos os campos obrigatórios do empréstimo.");
  }

  const validId = input.id && UUID_V4_RE.test(input.id) ? input.id : undefined;

  const regraAtraso = sanearRegraAtraso(input.atrasoTipo, input.atrasoValor);
  const taxaMulta = regraAtraso.taxaMulta;
  const taxaJuros = Number(input.taxaJuros) || 0;
  const valorEmprestado = Number(input.valorEmprestado);

  let parcelas: ParcelaInput[] = Array.isArray(input.parcelas) ? input.parcelas : [];
  if (parcelas.length === 0) {
    parcelas = [
      {
        numero: 1,
        valor:
          valorEmprestado +
          (input.tipoPagamento === "a_vista_juros" ? valorEmprestado * (taxaJuros / 100) : 0),
        data_vencimento: input.dataVencimento,
      },
    ];
  }

  if (validId) {
    const existing = await prisma.emprestimo.findUnique({
      where: { id: validId },
      include: { cliente: true, parcelas: { orderBy: { numero: "asc" } } },
    });
    if (existing) {
      return {
        emprestimo: existing,
        alreadyExisted: true,
        clienteNome: existing.cliente.nome,
        clienteTelefone: existing.cliente.telefone,
        parcelas: existing.parcelas.map((p) => ({
          numero: p.numero,
          valor: Number(p.valor),
          data_vencimento: p.data_vencimento.toISOString().split("T")[0],
        })),
        taxaMulta: Number(existing.taxa_multa),
        atrasoTipo: existing.atraso_tipo,
        atrasoValor: existing.atraso_valor,
        legendaPdf: "Contratação realizada com sucesso!",
      };
    }
  }

  // Valida cliente existente antes da transação (útil para erro legível se cliente dependente falhou)
  const clienteExiste = await prisma.cliente.findUnique({
    where: { id: input.clienteId },
    select: { id: true },
  });
  if (!clienteExiste) {
    throw new Error("Cliente vinculado ainda não foi sincronizado ou não existe no banco.");
  }

  let emprestimoCriado: Awaited<ReturnType<typeof prisma.emprestimo.create>> | null = null;
  let clienteNome = "";
  let clienteTelefone = "";

  await prisma.$transaction(async (tx) => {
    const emprestimo = await tx.emprestimo.create({
      data: {
        ...(validId ? { id: validId } : {}),
        cliente_id: input.clienteId,
        parceiro_id: input.parceiroId || null,
        valor_emprestado: valorEmprestado,
        taxa_juros: taxaJuros,
        taxa_multa: taxaMulta,
        data_vencimento: new Date(input.dataVencimento),
        status: "ativo",
        tipo_pagamento: input.tipoPagamento,
        frequencia: input.frequencia,
        data_inicio: new Date(input.dataInicio),
        juros_atraso: taxaMulta,
        atraso_tipo: regraAtraso.tipo,
        atraso_valor: regraAtraso.valor,
        categoria: input.categoria || "Sem categoria",
        observacoes: input.observacoes || null,
      },
      include: {
        cliente: true,
      },
    });

    emprestimoCriado = emprestimo;
    clienteNome = emprestimo.cliente.nome;
    clienteTelefone = emprestimo.cliente.telefone;

    await tx.parcela.createMany({
      data: parcelas.map((p) => ({
        emprestimo_id: emprestimo.id,
        numero: p.numero,
        valor: p.valor,
        data_vencimento: new Date(p.data_vencimento),
        status: "aberto",
      })),
    });
  });

  const novoEmprestimoId = (emprestimoCriado as { id: string } | null)?.id || "";

  // Legenda do PDF (template editável). Falha aqui nunca bloqueia a criação.
  let legendaPdf = "Contratação realizada com sucesso!";
  if (novoEmprestimoId && input.enviarPdfWhatsapp) {
    try {
      const contexto = await montarContexto({ emprestimoId: novoEmprestimoId });
      const r = await renderizarEvento("emprestimo.contratado", contexto);
      if (r.ativo && r.texto) legendaPdf = r.texto;
    } catch (err) {
      console.error(
        "[mensagens] Falha ao renderizar legenda do novo empréstimo:",
        (err as Error)?.message
      );
    }
  }

  return {
    emprestimo: emprestimoCriado!,
    alreadyExisted: false,
    clienteNome,
    clienteTelefone,
    legendaPdf,
    parcelas,
    taxaMulta,
    atrasoTipo: regraAtraso.tipo,
    atrasoValor: regraAtraso.valor,
  };
}
