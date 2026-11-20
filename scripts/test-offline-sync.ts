/**
 * Teste de integração da API de sincronização offline (/api/offline/sync e /api/offline/ping).
 *
 * Pré-requisitos:
 * - Servidor rodando em TEST_BASE_URL (padrão: http://localhost:3000)
 * - Banco PostgreSQL acessível via DATABASE_URL
 *
 * Uso:
 *   node --env-file=.env --import tsx scripts/test-offline-sync.ts
 */

import { SignJWT } from "jose";
import { randomUUID } from "crypto";
import { prisma } from "../src/lib/db";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "solucoes-financeiras-super-secret-key-2026"
);

async function makeAuthCookie(userId: string) {
  const token = await new SignJWT({ sub: userId, email: "teste@offline.local", nome: "Teste Offline" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(JWT_SECRET);
  return `sol_auth_token=${token}`;
}

async function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  [OK] ${msg}`);
}

async function run() {
  const userId = "test-user-offline-sync";
  const cookie = await makeAuthCookie(userId);
  const clienteId = randomUUID();
  const emprestimoId = randomUUID();
  const opClienteId = randomUUID();
  const opEmprestimoId = randomUUID();

  try {
    console.log("1. Validando 401 JSON sem cookie...");
    const rUnauth = await fetch(`${BASE_URL}/api/offline/ping`, { redirect: "manual" });
    await assert(rUnauth.status === 401, `GET /api/offline/ping sem cookie retornou ${rUnauth.status}`);

    console.log("2. Validando ping autenticado...");
    const rPing = await fetch(`${BASE_URL}/api/offline/ping`, { headers: { Cookie: cookie } });
    const pingData = await rPing.json();
    await assert(rPing.ok && pingData.ok && pingData.userId === userId, "Ping autenticado OK");

    console.log("3. Validando bloqueio 403 USER_MISMATCH...");
    const rMismatch = await fetch(`${BASE_URL}/api/offline/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ userId: "outro-usuario", operations: [] }),
    });
    await assert(rMismatch.status === 403, `POST /api/offline/sync com userId divergente retornou ${rMismatch.status}`);

    const lote = {
      userId,
      operations: [
        {
          operationId: opClienteId,
          userId,
          type: "CREATE_CLIENTE",
          entityId: clienteId,
          label: "Novo cliente: Teste Offline Sync",
          createdAt: Date.now(),
          status: "pending",
          attempts: 1,
          payload: {
            nome: "Teste Offline Sync",
            telefone: "14999990000",
            cidade: "Bauru",
            documento: "000.000.000-00",
            endereco: null,
            referencia: null,
            quemIndicou: null,
            email: null,
            observacoes: "Registro de teste automático",
            blacklist: false,
            fotoBase64: null,
            documentosBase64: null,
          },
        },
        {
          operationId: opEmprestimoId,
          userId,
          type: "CREATE_EMPRESTIMO",
          entityId: emprestimoId,
          dependsOnEntityId: clienteId,
          label: "Novo empréstimo: R$ 500,00 — Teste Offline Sync",
          createdAt: Date.now() + 1,
          status: "pending",
          attempts: 1,
          payload: {
            clienteId,
            clienteNome: "Teste Offline Sync",
            clienteTelefone: "14999990000",
            parceiroId: null,
            valorEmprestado: 500,
            tipoPagamento: "a_vista_juros",
            frequencia: "mensal",
            taxaJuros: 20,
            atrasoTipo: "fixo_dia",
            atrasoValor: 10,
            dataInicio: "2026-11-20",
            dataVencimento: "2026-12-20",
            categoria: "Pessoal",
            observacoes: null,
            parcelas: [{ numero: 1, valor: 600, data_vencimento: "2026-12-20" }],
            enviarPdfWhatsapp: false,
          },
        },
      ],
    };

    console.log("4. Enviando lote Cliente + Empréstimo dependente...");
    const rSync1 = await fetch(`${BASE_URL}/api/offline/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(lote),
    });
    const dSync1 = await rSync1.json();
    await assert(
      rSync1.ok &&
        dSync1.results?.length === 2 &&
        dSync1.results[0].status === "synced" &&
        dSync1.results[1].status === "synced",
      "Primeiro envio criou cliente e empréstimo dependente"
    );

    console.log("5. Reenviando o MESMO lote para validar idempotência...");
    const rSync2 = await fetch(`${BASE_URL}/api/offline/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(lote),
    });
    const dSync2 = await rSync2.json();
    await assert(
      rSync2.ok &&
        dSync2.results?.length === 2 &&
        dSync2.results[0].status === "already_synced" &&
        dSync2.results[1].status === "already_synced",
      "Reenvio retornou already_synced para ambos sem duplicar"
    );

    const parcelasCount = await prisma.parcela.count({ where: { emprestimo_id: emprestimoId } });
    await assert(parcelasCount === 1, `Parcelas do empréstimo: ${parcelasCount} (esperado 1)`);

    console.log("\nTodos os testes de sincronização offline passaram!");
  } finally {
    // Limpeza dos dados de teste
    await prisma.emprestimo.deleteMany({ where: { id: emprestimoId } }).catch(() => {});
    await prisma.cliente.deleteMany({ where: { id: clienteId } }).catch(() => {});
    await prisma
      .$executeRawUnsafe(
        `DELETE FROM offline_sync_ops WHERE operation_id IN ($1, $2)`,
        opClienteId,
        opEmprestimoId
      )
      .catch(() => {});
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
