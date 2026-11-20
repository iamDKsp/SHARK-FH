import { prisma } from "@/lib/db";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CriarClienteInput {
  id?: string;
  nome: string;
  telefone: string;
  cidade?: string | null;
  documento?: string | null;
  endereco?: string | null;
  referencia?: string | null;
  quemIndicou?: string | null;
  email?: string | null;
  observacoes?: string | null;
  blacklist?: boolean;
  fotoBase64?: string | null;
  documentosBase64?: string | null;
}

export async function criarClienteNoBanco(input: CriarClienteInput) {
  const nome = (input.nome || "").trim();
  const telefone = (input.telefone || "").replace(/\D/g, "");

  if (!nome) {
    throw new Error("Nome do cliente é obrigatório.");
  }
  if (!telefone) {
    throw new Error("Telefone do cliente é obrigatório.");
  }

  const validId = input.id && UUID_V4_RE.test(input.id) ? input.id : undefined;

  if (validId) {
    const existing = await prisma.cliente.findUnique({ where: { id: validId } });
    if (existing) {
      return { cliente: existing, alreadyExisted: true };
    }
  }

  const cliente = await prisma.cliente.create({
    data: {
      ...(validId ? { id: validId } : {}),
      nome,
      telefone,
      cidade: (input.cidade || "").trim() || "Bauru",
      documento: input.documento || "",
      endereco: input.endereco || null,
      referencia: input.referencia || null,
      quem_indicou: input.quemIndicou || null,
      email: input.email || null,
      observacoes: input.observacoes || null,
      blacklist: Boolean(input.blacklist),
      foto_url: input.fotoBase64 || null,
      documentos_urls: input.documentosBase64 || null,
    },
  });

  return { cliente, alreadyExisted: false };
}

export interface AtualizarClienteInput extends CriarClienteInput {
  id: string;
  removeFoto?: boolean;
  documentosMantidos?: string | null;
}

export async function atualizarClienteNoBanco(input: AtualizarClienteInput) {
  const clienteAtual = await prisma.cliente.findUnique({ where: { id: input.id } });
  if (!clienteAtual) {
    throw new Error("Cliente não encontrado.");
  }

  let fotoUrl = clienteAtual.foto_url;
  if (input.removeFoto) {
    fotoUrl = null;
  } else if (input.fotoBase64) {
    fotoUrl = input.fotoBase64;
  }

  let documentosFinais: string[] = [];
  if (input.documentosMantidos !== undefined) {
    try {
      if (input.documentosMantidos) {
        const parsed = JSON.parse(input.documentosMantidos);
        if (Array.isArray(parsed)) documentosFinais = parsed;
      }
    } catch {
      documentosFinais = [];
    }
    if (input.documentosBase64) {
      try {
        const novos = JSON.parse(input.documentosBase64);
        if (Array.isArray(novos)) documentosFinais.push(...novos);
      } catch {
        // ignora
      }
    }
  } else if (input.documentosBase64) {
    try {
      const atuais = clienteAtual.documentos_urls ? JSON.parse(clienteAtual.documentos_urls) : [];
      if (Array.isArray(atuais)) documentosFinais.push(...atuais);
      const novos = JSON.parse(input.documentosBase64);
      if (Array.isArray(novos)) documentosFinais.push(...novos);
    } catch {
      // ignora
    }
  } else if (clienteAtual.documentos_urls) {
    try {
      const atuais = JSON.parse(clienteAtual.documentos_urls);
      if (Array.isArray(atuais)) documentosFinais = atuais;
    } catch {
      documentosFinais = [];
    }
  }

  const documentosUrlsStr = documentosFinais.length > 0 ? JSON.stringify(documentosFinais) : null;

  const cliente = await prisma.cliente.update({
    where: { id: input.id },
    data: {
      nome: (input.nome || "").trim(),
      telefone: (input.telefone || "").replace(/\D/g, ""),
      cidade: (input.cidade || "").trim() || "Bauru",
      documento: input.documento || "",
      endereco: input.endereco || null,
      referencia: input.referencia || null,
      quem_indicou: input.quemIndicou || null,
      email: input.email || null,
      observacoes: input.observacoes || null,
      blacklist: Boolean(input.blacklist),
      foto_url: fotoUrl,
      documentos_urls: documentosUrlsStr,
    },
  });

  return cliente;
}
