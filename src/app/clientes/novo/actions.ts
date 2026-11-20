"use server";

import { revalidatePath } from "next/cache";
import { criarClienteNoBanco } from "@/lib/services/clienteService";

export async function createCliente(formData: FormData) {
  const nome = formData.get("nome") as string;
  const telefone = formData.get("telefone") as string;
  const cidade = formData.get("cidade") as string;
  const documento = formData.get("documento") as string;
  const endereco = formData.get("endereco") as string;
  const referencia = formData.get("referencia") as string;
  const quemIndicou = formData.get("quemIndicou") as string;
  const email = formData.get("email") as string;
  const observacoes = formData.get("observacoes") as string;
  const blacklist = formData.get("blacklist") === "true";
  const fotoUrl = formData.get("fotoBase64") as string | null;
  const documentosUrlsStr = formData.get("documentosBase64") as string | null;

  await criarClienteNoBanco({
    nome,
    telefone,
    cidade,
    documento,
    endereco,
    referencia,
    quemIndicou,
    email,
    observacoes,
    blacklist,
    fotoBase64: fotoUrl,
    documentosBase64: documentosUrlsStr,
  });

  revalidatePath("/clientes");
  return { success: true, redirectUrl: "/clientes" };
}
