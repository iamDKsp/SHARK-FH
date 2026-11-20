import { prisma } from "@/lib/db";
import { hojeEmBrasilia } from "@/lib/dateUtils";
import FaturamentoView, {
  type LancamentoFaturamento,
  type PotencialMensal,
} from "./FaturamentoView";

export const revalidate = 0;

export default async function FaturamentoPage() {
  const hojeUTC = hojeEmBrasilia();
  const hojeStr = `${hojeUTC.getUTCFullYear()}-${String(hojeUTC.getUTCMonth() + 1).padStart(2, "0")}-${String(hojeUTC.getUTCDate()).padStart(2, "0")}`;

  const [parcelasPagas, emprestimosAtivos] = await Promise.all([
    prisma.parcela.findMany({
      where: {
        status: {
          in: ["pago", "pago_com_atraso", "pago_renovacao"],
        },
      },
      select: {
        id: true,
        numero: true,
        valor: true,
        valor_pago: true,
        status: true,
        data_pagamento: true,
        data_vencimento: true,
        criado_em: true,
        emprestimo: {
          select: {
            id: true,
            tipo_pagamento: true,
            valor_emprestado: true,
            taxa_juros: true,
            cliente: {
              select: {
                id: true,
                nome: true,
              },
            },
          },
        },
      },
      orderBy: [{ data_pagamento: "desc" }, { criado_em: "desc" }],
    }),
    prisma.emprestimo.findMany({
      where: { status: "ativo" },
      select: {
        id: true,
        tipo_pagamento: true,
        valor_emprestado: true,
        taxa_juros: true,
        parcelas: {
          where: { status: "aberto" },
          select: {
            numero: true,
            valor: true,
            data_vencimento: true,
          },
          orderBy: { numero: "asc" },
        },
      },
    }),
  ]);

  // 1. Previsão mensal ("se todos os ativos renovarem + pagarem a parcela do mês")
  let jurosRenovacaoTotal = 0;
  let countRolagem = 0;
  let parcelasAcordosMes = 0;
  let countParcelados = 0;
  let avistaSemJurosTotal = 0;
  let countAVista = 0;

  for (const emp of emprestimosAtivos) {
    const principal = Number(emp.valor_emprestado);
    const taxa = Number(emp.taxa_juros);

    if (emp.tipo_pagamento === "a_vista_juros" && taxa > 0) {
      const jurosMes = Number((principal * (taxa / 100)).toFixed(2));
      jurosRenovacaoTotal += jurosMes;
      countRolagem++;
    } else if (emp.tipo_pagamento === "parcelado" || emp.tipo_pagamento === "parcela_juros_mes") {
      const prox = emp.parcelas[0];
      if (prox) {
        parcelasAcordosMes += Number(prox.valor);
        countParcelados++;
      }
    } else {
      const aberto = emp.parcelas.reduce((acc, p) => acc + Number(p.valor), 0);
      if (aberto > 0) {
        avistaSemJurosTotal += aberto;
        countAVista++;
      }
    }
  }

  const potencial: PotencialMensal = {
    jurosRenovacaoTotal: Number(jurosRenovacaoTotal.toFixed(2)),
    countRolagem,
    parcelasAcordosMes: Number(parcelasAcordosMes.toFixed(2)),
    countParcelados,
    avistaSemJurosTotal: Number(avistaSemJurosTotal.toFixed(2)),
    countAVista,
    totalRecorrenteMes: Number((jurosRenovacaoTotal + parcelasAcordosMes).toFixed(2)),
  };

  // 2. Histórico real de recebimentos (renovações, parcelas/quitações e diárias de atraso)
  const toIsoDate = (d: Date | null | undefined) => {
    if (!d) return hojeStr;
    const dt = new Date(d);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  };

  const lancamentos: LancamentoFaturamento[] = parcelasPagas.map((p) => {
    const valorBase = Number(p.valor);
    const valorPago = p.valor_pago != null ? Number(p.valor_pago) : valorBase;
    const diariaAtraso = Math.max(0, Number((valorPago - valorBase).toFixed(2)));
    const isRenovacao = p.status === "pago_renovacao";

    return {
      id: p.id,
      emprestimoId: p.emprestimo.id,
      clienteId: p.emprestimo.cliente.id,
      clienteNome: p.emprestimo.cliente.nome,
      numeroParcela: p.numero,
      tipo: isRenovacao ? "renovacao" : "parcela",
      status: p.status,
      dataPagamento: toIsoDate(p.data_pagamento ?? p.data_vencimento),
      valorBase,
      diariaAtraso,
      valorTotal: valorPago,
    };
  });

  return (
    <FaturamentoView
      hojeStr={hojeStr}
      potencial={potencial}
      lancamentos={lancamentos}
    />
  );
}
