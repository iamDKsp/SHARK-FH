"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  CONTEXTO_EXEMPLO,
  getMensagemDef,
  type ConfiguracoesBase,
  type ContextoMensagem,
} from "@/lib/mensagens/catalogo";
import { detectarTipoChavePix, ehTipoChavePix, limparChavePix, type PixTipoChave } from "@/lib/pix";
import { renderizar, validarTexto } from "@/lib/mensagens/render";
import {
  carregarConfiguracoes,
  enviarBotaoPix,
  enviarTextoLivre,
  removerBlocoRenovacao,
  resolverTemplate,
} from "@/lib/mensagens/servidor";

export interface ResultadoAcao {
  ok: boolean;
  erro?: string;
  /** Avisos que não impedem a ação. */
  avisos?: string[];
}

const LIMITE_TEXTO = 2000;

function mensagemDeValidacao(chave: string, texto: string): string | null {
  const def = getMensagemDef(chave);
  if (!def) return "Mensagem desconhecida.";
  const t = texto.trim();
  if (!t) return "O texto não pode ficar vazio. Use “Restaurar padrão” se quiser voltar ao original.";
  if (t.length > LIMITE_TEXTO) return `O texto passou de ${LIMITE_TEXTO} caracteres.`;
  const v = validarTexto(t, def.variaveis);
  if (v.malformadas.length > 0) {
    return `Chave mal fechada: ${v.malformadas.map((x) => `“${x}”`).join(", ")}. Cada variável deve ficar assim: {data}.`;
  }
  if (v.desconhecidas.length > 0) {
    return `Variável inexistente: ${v.desconhecidas.map((x) => `{${x}}`).join(", ")}. Confira a grafia.`;
  }
  if (v.foraDoContexto.length > 0) {
    return `Estas variáveis não se aplicam a esta mensagem (sairiam vazias): ${v.foraDoContexto
      .map((x) => `{${x}}`)
      .join(", ")}.`;
  }
  return null;
}

/** Grava (ou remove, se igual ao padrão) a edição de uma mensagem. */
async function gravarMensagem(chave: string, texto: string, ativo: boolean) {
  const def = getMensagemDef(chave)!;
  const t = texto.trim();
  const igualAoPadrao = t === def.textoPadrao.trim() && ativo === def.padraoAtivo;
  if (igualAoPadrao) {
    await prisma.mensagemTemplate.deleteMany({ where: { chave } });
  } else {
    await prisma.mensagemTemplate.upsert({
      where: { chave },
      create: { chave, texto: t, ativo: def.podeDesativar ? ativo : true },
      update: { texto: t, ativo: def.podeDesativar ? ativo : true },
    });
  }
}

export async function salvarMensagem(chave: string, texto: string, ativo: boolean): Promise<ResultadoAcao> {
  const erro = mensagemDeValidacao(chave, texto);
  if (erro) return { ok: false, erro };
  try {
    await gravarMensagem(chave, texto, ativo);
    revalidatePath("/configuracoes/mensagens");
    revalidatePath("/cobrancas");
    return { ok: true };
  } catch (err: any) {
    console.error("[mensagens] salvarMensagem:", err?.message);
    return { ok: false, erro: "Não foi possível salvar. Tente novamente." };
  }
}

export async function restaurarMensagem(chave: string): Promise<ResultadoAcao> {
  if (!getMensagemDef(chave)) return { ok: false, erro: "Mensagem desconhecida." };
  try {
    await prisma.mensagemTemplate.deleteMany({ where: { chave } });
    revalidatePath("/configuracoes/mensagens");
    revalidatePath("/cobrancas");
    return { ok: true };
  } catch (err: any) {
    console.error("[mensagens] restaurarMensagem:", err?.message);
    return { ok: false, erro: "Não foi possível restaurar. Tente novamente." };
  }
}

async function upsertConfig(chave: string, valor: string) {
  await prisma.configuracao.upsert({
    where: { chave },
    create: { chave, valor },
    update: { valor },
  });
}

export async function salvarConfiguracoes(dados: ConfiguracoesBase): Promise<ResultadoAcao> {
  const pixChave = String(dados.pix_chave ?? "").trim();
  const pixTitular = String(dados.pix_titular ?? "").trim();
  const pixBanco = String(dados.pix_banco ?? "").trim();
  const pixTipo: PixTipoChave = ehTipoChavePix(dados.pix_tipo)
    ? dados.pix_tipo
    : detectarTipoChavePix(pixChave);
  const pixEnviarBotao = Boolean(dados.pix_enviar_botao);
  const empresa = String(dados.empresa_nome ?? "").trim();

  if (
    pixChave.length > 200 ||
    pixTitular.length > 200 ||
    pixBanco.length > 200 ||
    empresa.length > 200
  ) {
    return { ok: false, erro: "Os campos aceitam no máximo 200 caracteres." };
  }

  if (pixEnviarBotao && pixChave && !limparChavePix(pixChave, pixTipo)) {
    return {
      ok: false,
      erro: `A chave Pix informada não parece válida para o tipo ${pixTipo}. Confira a chave ou troque o tipo.`,
    };
  }

  try {
    await upsertConfig("pix_chave", pixChave);
    await upsertConfig("pix_tipo", pixTipo);
    await upsertConfig("pix_titular", pixTitular);
    await upsertConfig("pix_banco", pixBanco);
    await upsertConfig("pix_enviar_botao", pixEnviarBotao ? "true" : "false");
    await upsertConfig("empresa_nome", empresa);
    revalidatePath("/configuracoes/mensagens");
    revalidatePath("/cobrancas");
    const avisos: string[] = [];
    if (!pixChave) avisos.push("Sem chave Pix, o rodapé de pagamento e o botão Pix não serão enviados nas cobranças.");
    return { ok: true, avisos };
  } catch (err: any) {
    console.error("[mensagens] salvarConfiguracoes:", err?.message);
    return { ok: false, erro: "Não foi possível salvar. Tente novamente." };
  }
}

function limparRespostas(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= LIMITE_TEXTO)
    .slice(0, 30);
}

export async function salvarRespostasRapidas(lista: string[]): Promise<ResultadoAcao> {
  const limpa = limparRespostas(lista);
  const avisos: string[] = [];
  for (const t of limpa) {
    const v = validarTexto(t, Object.keys(CONTEXTO_EXEMPLO) as any);
    if (v.desconhecidas.length > 0) {
      return { ok: false, erro: `Variável inexistente em “${t.slice(0, 40)}…”: ${v.desconhecidas.map((x) => `{${x}}`).join(", ")}` };
    }
  }
  try {
    await upsertConfig("respostas_rapidas", JSON.stringify(limpa));
    revalidatePath("/configuracoes/mensagens");
    return { ok: true, avisos };
  } catch (err: any) {
    console.error("[mensagens] salvarRespostasRapidas:", err?.message);
    return { ok: false, erro: "Não foi possível salvar. Tente novamente." };
  }
}

/** Envia um teste (com dados fictícios) para o número informado, sem precisar salvar antes. */
export async function enviarTeste(chave: string, texto: string, telefone: string): Promise<ResultadoAcao> {
  const def = getMensagemDef(chave);
  if (!def) return { ok: false, erro: "Mensagem desconhecida." };
  const digitos = (telefone || "").replace(/\D/g, "");
  if (digitos.length < 10) return { ok: false, erro: "Informe um número de WhatsApp válido com DDD." };
  const erro = mensagemDeValidacao(chave, texto);
  if (erro) return { ok: false, erro };

  const cfg = await carregarConfiguracoes();
  const pixChaveFmt =
    cfg.pix_chave && cfg.pix_banco && !cfg.pix_chave.toLowerCase().includes(cfg.pix_banco.toLowerCase())
      ? `${cfg.pix_chave} (${cfg.pix_banco})`
      : cfg.pix_chave;
  const contexto: ContextoMensagem = {
    ...CONTEXTO_EXEMPLO,
    // Se a base já tem Pix/empresa cadastrados, o teste usa os dados reais.
    ...(pixChaveFmt ? { pix_chave: pixChaveFmt } : {}),
    ...(cfg.pix_titular ? { pix_titular: cfg.pix_titular } : {}),
    ...(cfg.empresa_nome ? { empresa: cfg.empresa_nome } : {}),
  };

  let corpo = renderizar(texto, contexto).texto;
  const ehCobranca = chave.startsWith("cobranca.") && chave !== "cobranca.rodape";
  if (ehCobranca) {
    const rodape = await resolverTemplate("cobranca.rodape");
    if (rodape.ativo && cfg.pix_chave) {
      const textoRodape = chave.endsWith(".parcelado")
        ? removerBlocoRenovacao(rodape.texto)
        : rodape.texto;
      corpo += `\n\n${renderizar(textoRodape, contexto).texto}`;
    }
  }

  const r = await enviarTextoLivre(`🧪 *[TESTE]*\n${corpo}`, {
    telefone: digitos,
    contexto: {},
    chave: `teste.${chave}`,
  });

  if (r.enviado && ehCobranca && cfg.pix_enviar_botao && cfg.pix_chave) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const rPix = await enviarBotaoPix({
      telefone: digitos,
      chaveLog: "teste.pix.botao",
    });
    if (!rPix.enviado) {
      return {
        ok: true,
        avisos: [`Texto enviado, mas o botão Pix falhou: ${rPix.erro || "verifique o servidor WhatsApp"}.`],
      };
    }
  }

  return r.enviado ? { ok: true } : { ok: false, erro: r.erro || "Falha ao enviar o teste." };
}

/** Envia somente o botão nativo de copiar Pix para teste no número informado. */
export async function enviarTesteBotaoPix(dados: {
  telefone: string;
  pix_chave: string;
  pix_tipo: PixTipoChave;
  pix_titular: string;
  empresa_nome?: string;
}): Promise<ResultadoAcao> {
  const digitos = (dados.telefone || "").replace(/\D/g, "");
  if (digitos.length < 10) {
    return { ok: false, erro: "Informe um número de WhatsApp válido com DDD no topo da página." };
  }

  const pixChave = String(dados.pix_chave ?? "").trim();
  const pixTipo: PixTipoChave = ehTipoChavePix(dados.pix_tipo)
    ? dados.pix_tipo
    : detectarTipoChavePix(pixChave);
  if (!limparChavePix(pixChave, pixTipo)) {
    return { ok: false, erro: `A chave Pix informada não é válida para o tipo ${pixTipo}.` };
  }

  const r = await enviarBotaoPix({
    telefone: digitos,
    chaveLog: "teste.pix.botao",
    override: {
      pix_chave: pixChave,
      pix_tipo: pixTipo,
      pix_titular: String(dados.pix_titular ?? "").trim(),
      empresa_nome: String(dados.empresa_nome ?? "").trim(),
    },
  });
  return r.enviado ? { ok: true } : { ok: false, erro: r.erro || "Falha ao enviar o botão Pix." };
}

export interface DadosImportacao {
  /** chave do catálogo → texto antigo salvo no navegador */
  templates: Record<string, string>;
  pix_chave?: string;
  pix_titular?: string;
  respostas?: string[];
}

/** Importa o que estava salvo no localStorage deste navegador (modelos antigos). */
export async function importarModelosAntigos(dados: DadosImportacao): Promise<ResultadoAcao & { importados: number }> {
  let importados = 0;
  const avisos: string[] = [];
  try {
    for (const [chave, texto] of Object.entries(dados.templates ?? {})) {
      const def = getMensagemDef(chave);
      if (!def || typeof texto !== "string") continue;
      const erro = mensagemDeValidacao(chave, texto);
      if (erro) {
        avisos.push(`${def.titulo}: ${erro}`);
        continue;
      }
      await gravarMensagem(chave, texto, def.padraoAtivo);
      importados++;
    }

    const atual = await carregarConfiguracoes();
    // Só preenche se a base ainda não tem valor (não sobrescreve o que já foi configurado)
    if (dados.pix_chave?.trim() && !atual.pix_chave) {
      await upsertConfig("pix_chave", dados.pix_chave.trim());
      importados++;
    }
    if (dados.pix_titular?.trim() && !atual.pix_titular) {
      await upsertConfig("pix_titular", dados.pix_titular.trim());
      importados++;
    }

    const respostas = limparRespostas(dados.respostas);
    if (respostas.length > 0) {
      await upsertConfig("respostas_rapidas", JSON.stringify(respostas));
      importados += respostas.length;
    }

    revalidatePath("/configuracoes/mensagens");
    revalidatePath("/cobrancas");
    return { ok: true, importados, avisos };
  } catch (err: any) {
    console.error("[mensagens] importarModelosAntigos:", err?.message);
    return { ok: false, importados, erro: "Falha ao importar. Nada foi apagado do navegador." };
  }
}
