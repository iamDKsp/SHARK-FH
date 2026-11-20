import type { TipoAtraso } from "@/lib/jurosAtraso";

export interface CachedCliente {
  id: string;
  nome: string;
  telefone: string;
  cidade: string;
  documento: string;
  endereco: string | null;
  referencia: string | null;
  quem_indicou: string | null;
  email: string | null;
  blacklist: boolean;
  observacoes: string | null;
  foto_url?: string | null;
  criado_em: string;
  pendingSync?: boolean;
}

export interface CachedParceiro {
  id: string;
  nome: string;
  telefone: string | null;
  criado_em?: string;
  pendingSync?: boolean;
}

export interface CachedParcela {
  id: string;
  numero: number;
  valor: number;
  valor_pago: number | null;
  data_vencimento: string;
  status: string;
  data_pagamento: string | null;
}

export interface CachedEmprestimo {
  id: string;
  cliente_id: string;
  parceiro_id: string | null;
  valor_emprestado: number;
  taxa_juros: number;
  taxa_multa: number;
  juros_atraso: number;
  atraso_tipo: string;
  atraso_valor: number;
  data_vencimento: string;
  data_inicio: string;
  data_prevista_pagamento: string | null;
  status: string;
  tipo_pagamento: string;
  frequencia: string;
  categoria: string;
  observacoes: string | null;
  criado_em: string;
  cliente: {
    id: string;
    nome: string;
    telefone: string;
    cidade: string;
    blacklist?: boolean;
    foto_src?: string | null;
  };
  parceiro?: { id: string; nome: string } | null;
  parcelas: CachedParcela[];
  pendingSync?: boolean;
}

export interface CachedCheque {
  id: string;
  cliente_id: string | null;
  parceiro_id: string | null;
  titular: string | null;
  banco: string | null;
  valor: number;
  taxa_desconto: number | null;
  valor_liquido: number | null;
  data_compensacao: string;
  status: string;
  foto_url: string | null;
  observacoes: string | null;
  criado_em?: string;
  cliente?: { nome: string; telefone: string } | null;
  parceiro?: { nome: string } | null;
  pendingSync?: boolean;
}

export interface CachedConfig {
  regra_carencia_30_dias: boolean;
  regra_carencia_10_dias: boolean;
  perguntar_whatsapp_renovacao: boolean;
}

export interface ParcelaPayload {
  numero: number;
  valor: number;
  data_vencimento: string;
}

export interface CreateClientePayload {
  nome: string;
  telefone: string;
  cidade: string;
  documento: string;
  endereco: string | null;
  referencia: string | null;
  quemIndicou: string | null;
  email: string | null;
  observacoes: string | null;
  blacklist: boolean;
  fotoBase64: string | null;
  documentosBase64: string | null;
}

export interface UpdateClientePayload extends CreateClientePayload {
  id: string;
  removeFoto?: boolean;
  documentosMantidos?: string | null;
}

export interface CreateEmprestimoPayload {
  clienteId: string;
  clienteNome: string;
  clienteTelefone: string;
  parceiroId: string | null;
  parceiroNome?: string | null;
  valorEmprestado: number;
  tipoPagamento: string;
  frequencia: string;
  taxaJuros: number;
  atrasoTipo: TipoAtraso;
  atrasoValor: number;
  dataInicio: string;
  dataVencimento: string;
  categoria: string;
  observacoes: string | null;
  parcelas: ParcelaPayload[];
  enviarPdfWhatsapp: boolean;
}

export interface UpdateEmprestimoPayload {
  emprestimoId: string;
  clienteId: string;
  parceiroId: string | null;
  valorEmprestado: number;
  tipoPagamento: string;
  frequencia: string;
  taxaJuros: number;
  atrasoTipo: TipoAtraso;
  atrasoValor: number;
  dataInicio: string;
  dataVencimento: string;
  categoria: string;
  observacoes: string | null;
  recriarParcelas: boolean;
  parcelas: ParcelaPayload[];
}

export interface CreateChequePayload {
  cliente_id: string;
  clienteNome?: string;
  clienteTelefone?: string;
  parceiro_id?: string | null;
  parceiroNome?: string | null;
  valor: number;
  taxa_desconto: number;
  valor_liquido: number;
  data_compensacao: string;
  observacoes?: string | null;
  foto_url?: string | null;
}

export interface CreateParceiroPayload {
  nome: string;
  telefone: string | null;
}

export interface UpdateParceiroPayload {
  id: string;
  nome: string;
  telefone: string | null;
}

export type OfflineOperationType =
  | "CREATE_CLIENTE"
  | "UPDATE_CLIENTE"
  | "DELETE_CLIENTE"
  | "TOGGLE_CLIENT_BLACKLIST"
  | "CREATE_EMPRESTIMO"
  | "UPDATE_EMPRESTIMO"
  | "DELETE_EMPRESTIMO"
  | "PAY_NEXT_INSTALLMENT"
  | "PAY_INSTALLMENT_BY_ID"
  | "PAY_FULL_LOAN"
  | "RECEBER_SO_JUROS"
  | "RENEGOCIAR_EMPRESTIMO"
  | "REPROGRAMAR_EMPRESTIMO"
  | "TOGGLE_PAUSAR_EMPRESTIMO"
  | "SALVAR_DATA_PREVISTA"
  | "ATUALIZAR_DATA_PAGAMENTO_PARCELA"
  | "ALTERAR_EMPRESTIMOS_MASSA"
  | "CREATE_CHEQUE"
  | "UPDATE_CHEQUE_STATUS"
  | "DELETE_CHEQUE"
  | "CREATE_PARCEIRO"
  | "UPDATE_PARCEIRO"
  | "DELETE_PARCEIRO";

export interface OfflineOperationBase {
  operationId: string;
  userId: string;
  entityId: string;
  dependsOnEntityId?: string;
  label: string; // Ex.: "Quitar empréstimo — João Silva"
  createdAt: number;
  status: "pending" | "syncing" | "error";
  attempts: number;
  lastError?: string;
}

export type OfflineOperation =
  | (OfflineOperationBase & { type: "CREATE_CLIENTE"; payload: CreateClientePayload })
  | (OfflineOperationBase & { type: "UPDATE_CLIENTE"; payload: UpdateClientePayload })
  | (OfflineOperationBase & { type: "DELETE_CLIENTE"; payload: { clienteId: string; clienteNome?: string } })
  | (OfflineOperationBase & {
      type: "TOGGLE_CLIENT_BLACKLIST";
      payload: { clientId: string; currentStatus: boolean; emprestimoId?: string };
    })
  | (OfflineOperationBase & { type: "CREATE_EMPRESTIMO"; payload: CreateEmprestimoPayload })
  | (OfflineOperationBase & { type: "UPDATE_EMPRESTIMO"; payload: UpdateEmprestimoPayload })
  | (OfflineOperationBase & { type: "DELETE_EMPRESTIMO"; payload: { emprestimoId: string } })
  | (OfflineOperationBase & {
      type: "PAY_NEXT_INSTALLMENT";
      payload: { emprestimoId: string; withDelay: boolean; cobrarJurosAtraso: boolean; enviarWhatsapp: boolean };
    })
  | (OfflineOperationBase & {
      type: "PAY_INSTALLMENT_BY_ID";
      payload: {
        emprestimoId: string;
        parcelaId: string;
        numeroParcela?: number;
        withDelay: boolean;
        cobrarJurosAtraso: boolean;
        enviarWhatsapp: boolean;
      };
    })
  | (OfflineOperationBase & {
      type: "PAY_FULL_LOAN";
      payload: { emprestimoId: string; withDelay: boolean; cobrarJurosAtraso: boolean; enviarWhatsapp: boolean };
    })
  | (OfflineOperationBase & {
      type: "RECEBER_SO_JUROS";
      payload: { emprestimoId: string; enviarWhatsapp: boolean };
    })
  | (OfflineOperationBase & {
      type: "RENEGOCIAR_EMPRESTIMO";
      payload: { emprestimoId: string; valorAbatido: number; aplicarJuros: boolean; taxaJuros: number };
    })
  | (OfflineOperationBase & {
      type: "REPROGRAMAR_EMPRESTIMO";
      payload: {
        emprestimoId: string;
        novaDataVencimento: string;
        principalExtra: number;
        taxaJuros: number;
        frequencia: string;
        enviarWhatsapp: boolean;
      };
    })
  | (OfflineOperationBase & {
      type: "TOGGLE_PAUSAR_EMPRESTIMO";
      payload: { emprestimoId: string; statusAtual: string };
    })
  | (OfflineOperationBase & {
      type: "SALVAR_DATA_PREVISTA";
      payload: { emprestimoId: string; data: string | null };
    })
  | (OfflineOperationBase & {
      type: "ATUALIZAR_DATA_PAGAMENTO_PARCELA";
      payload: { emprestimoId: string; parcelaId: string; novaDataIso: string };
    })
  | (OfflineOperationBase & {
      type: "ALTERAR_EMPRESTIMOS_MASSA";
      payload: {
        clienteId: string;
        ids: string[];
        acao: "excluir" | "renovar" | "reprogramar" | "quitar";
        opcoes: { novaData?: string; cobrarJurosAtraso?: boolean; enviarWhatsapp?: boolean };
      };
    })
  | (OfflineOperationBase & { type: "CREATE_CHEQUE"; payload: CreateChequePayload })
  | (OfflineOperationBase & { type: "UPDATE_CHEQUE_STATUS"; payload: { id: string; newStatus: string } })
  | (OfflineOperationBase & { type: "DELETE_CHEQUE"; payload: { id: string } })
  | (OfflineOperationBase & { type: "CREATE_PARCEIRO"; payload: CreateParceiroPayload })
  | (OfflineOperationBase & { type: "UPDATE_PARCEIRO"; payload: UpdateParceiroPayload })
  | (OfflineOperationBase & { type: "DELETE_PARCEIRO"; payload: { id: string } });

export interface SyncWhatsappPdfMeta {
  clienteNome: string;
  clienteTelefone: string;
  legendaPdf: string;
  parcelas: ParcelaPayload[];
  tipoPagamento: string;
  valorEmprestado: number;
  taxaJuros: number;
  taxaMulta: number;
  atrasoTipo: string;
  atrasoValor: number;
  observacoes: string | null;
}

export interface SyncOperationResult {
  operationId: string;
  status: "synced" | "already_synced" | "error";
  entityId?: string;
  error?: string;
  whatsappPdfMeta?: SyncWhatsappPdfMeta;
  whatsappEnviado?: boolean;
  whatsappErro?: string;
  whatsappTexto?: string;
}

export interface BootstrapResponse {
  clientes: CachedCliente[];
  parceiros: CachedParceiro[];
  emprestimos: CachedEmprestimo[];
  cheques: CachedCheque[];
  config: CachedConfig;
  syncedAt: string;
}

export interface OfflineSession {
  userId: string;
  userName: string;
}
