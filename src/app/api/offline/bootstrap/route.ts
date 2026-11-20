import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyRequestAuth } from "@/lib/authServer";
import { obterConfiguracoesSistema } from "@/app/configuracoes/actions";
import { fotosDosClientes } from "@/lib/clienteFotos";

export async function GET(request: NextRequest) {
  const auth = await verifyRequestAuth(request);
  if (!auth) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const [clientesRaw, parceirosRaw, emprestimosRaw, chequesRaw, config, fotos] = await Promise.all([
      // Campos leves: exclui foto_url base64 e documentos_urls para manter o cache rápido no iPhone
      prisma.cliente.findMany({
        select: {
          id: true,
          nome: true,
          telefone: true,
          cidade: true,
          documento: true,
          endereco: true,
          referencia: true,
          quem_indicou: true,
          email: true,
          blacklist: true,
          observacoes: true,
          criado_em: true,
        },
        orderBy: { nome: "asc" },
      }),
      prisma.parceiro.findMany({
        select: {
          id: true,
          nome: true,
          telefone: true,
          criado_em: true,
        },
        orderBy: { nome: "asc" },
      }),
      prisma.emprestimo.findMany({
        select: {
          id: true,
          cliente_id: true,
          parceiro_id: true,
          valor_emprestado: true,
          taxa_juros: true,
          taxa_multa: true,
          juros_atraso: true,
          atraso_tipo: true,
          atraso_valor: true,
          data_vencimento: true,
          data_inicio: true,
          data_prevista_pagamento: true,
          status: true,
          tipo_pagamento: true,
          frequencia: true,
          categoria: true,
          observacoes: true,
          criado_em: true,
          cliente: {
            select: {
              id: true,
              nome: true,
              telefone: true,
              cidade: true,
              blacklist: true,
            },
          },
          parceiro: {
            select: { id: true, nome: true },
          },
          parcelas: {
            select: {
              id: true,
              numero: true,
              valor: true,
              valor_pago: true,
              data_vencimento: true,
              status: true,
              data_pagamento: true,
            },
            orderBy: { numero: "asc" },
          },
        },
        orderBy: { data_vencimento: "asc" },
      }),
      prisma.cheque.findMany({
        select: {
          id: true,
          cliente_id: true,
          parceiro_id: true,
          titular: true,
          banco: true,
          valor: true,
          taxa_desconto: true,
          valor_liquido: true,
          data_compensacao: true,
          status: true,
          observacoes: true,
          criado_em: true,
          cliente: {
            select: { nome: true, telefone: true },
          },
          parceiro: {
            select: { nome: true },
          },
        },
        orderBy: { data_compensacao: "asc" },
      }),
      obterConfiguracoesSistema(),
      fotosDosClientes(),
    ]);

    const clientes = clientesRaw.map((c) => ({
      ...c,
      foto_url: null,
      criado_em: c.criado_em.toISOString(),
    }));

    const parceiros = parceirosRaw.map((p) => ({
      ...p,
      criado_em: p.criado_em.toISOString(),
    }));

    const emprestimos = emprestimosRaw.map((e) => ({
      ...e,
      valor_emprestado: Number(e.valor_emprestado),
      taxa_juros: Number(e.taxa_juros),
      taxa_multa: Number(e.taxa_multa),
      juros_atraso: Number(e.juros_atraso),
      atraso_valor: Number(e.atraso_valor || 0),
      data_vencimento: e.data_vencimento.toISOString(),
      data_inicio: e.data_inicio.toISOString(),
      data_prevista_pagamento: e.data_prevista_pagamento
        ? e.data_prevista_pagamento.toISOString().split("T")[0]
        : null,
      criado_em: e.criado_em.toISOString(),
      cliente: {
        ...e.cliente,
        foto_src: fotos.get(e.cliente.id) ?? null,
      },
      parcelas: e.parcelas.map((p) => ({
        ...p,
        valor: Number(p.valor),
        valor_pago: p.valor_pago != null ? Number(p.valor_pago) : null,
        data_vencimento: p.data_vencimento.toISOString(),
        data_pagamento: p.data_pagamento ? p.data_pagamento.toISOString() : null,
      })),
    }));

    const cheques = chequesRaw.map((ch) => ({
      ...ch,
      valor: Number(ch.valor),
      taxa_desconto: ch.taxa_desconto != null ? Number(ch.taxa_desconto) : null,
      valor_liquido: ch.valor_liquido != null ? Number(ch.valor_liquido) : null,
      data_compensacao: ch.data_compensacao.toISOString(),
      foto_url: null,
      criado_em: ch.criado_em.toISOString(),
    }));

    return NextResponse.json(
      {
        clientes,
        parceiros,
        emprestimos,
        cheques,
        config: {
          regra_carencia_30_dias: config.regra_carencia_30_dias,
          regra_carencia_10_dias: config.regra_carencia_10_dias,
          perguntar_whatsapp_renovacao: config.perguntar_whatsapp_renovacao,
        },
        syncedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("GET /api/offline/bootstrap error:", error);
    return NextResponse.json(
      { error: "Erro ao preparar cache offline." },
      { status: 500 }
    );
  }
}
