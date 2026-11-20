"use server";

import { revalidatePath } from "next/cache";
import { lerRegraAtraso } from "@/lib/jurosAtraso";
import { criarEmprestimoNoBanco, type ParcelaInput } from "@/lib/services/emprestimoService";

export async function createEmprestimo(formData: FormData) {
  const clienteId = formData.get("clienteId") as string;
  const parceiroId = (formData.get("parceiroId") as string) || null;
  const valorEmprestado = Number(formData.get("valorEmprestado"));
  const tipoPagamento = formData.get("tipoPagamento") as string;
  const frequencia = formData.get("frequencia") as string;
  const taxaJuros = Number(formData.get("taxaJuros")) || 0;
  const regraAtraso = lerRegraAtraso(formData);
  const dataInicioStr = formData.get("dataInicio") as string;
  const dataVencimentoStr = formData.get("dataVencimento") as string;
  const categoria = formData.get("categoria") as string;
  const observacoes = formData.get("observacoes") as string;
  const parcelasJson = formData.get("parcelasJson") as string;
  const enviarPdfWhatsapp = formData.get("enviarPdfWhatsapp") === "true";

  let parcelas: ParcelaInput[] = [];
  if (parcelasJson) {
    try {
      parcelas = JSON.parse(parcelasJson);
    } catch (err) {
      console.error("Erro ao parsear parcelas do formulário:", err);
    }
  }

  const res = await criarEmprestimoNoBanco({
    clienteId,
    parceiroId,
    valorEmprestado,
    tipoPagamento,
    frequencia,
    taxaJuros,
    atrasoTipo: regraAtraso.tipo,
    atrasoValor: regraAtraso.valor,
    dataInicio: dataInicioStr,
    dataVencimento: dataVencimentoStr,
    categoria,
    observacoes: observacoes || null,
    parcelas,
    enviarPdfWhatsapp,
  });

  const novoEmprestimoId = res.emprestimo?.id || "";

  revalidatePath("/emprestimos");
  revalidatePath("/clientes");
  if (novoEmprestimoId) {
    revalidatePath(`/emprestimos/${novoEmprestimoId}`);
  }

  return {
    success: true,
    redirectUrl: novoEmprestimoId ? `/emprestimos/${novoEmprestimoId}` : "/emprestimos",
    clienteNome: res.clienteNome,
    clienteTelefone: res.clienteTelefone,
    legendaPdf: res.legendaPdf,
    parcelas: res.parcelas,
    tipoPagamento,
    valorEmprestado,
    taxaJuros,
    taxaMulta: res.taxaMulta,
    atrasoTipo: res.atrasoTipo,
    atrasoValor: res.atrasoValor,
    observacoes: observacoes || null,
  };
}
