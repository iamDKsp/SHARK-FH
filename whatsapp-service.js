const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  generateWAMessageFromContent,
  generateMessageIDV2,
} = require("@whiskeysockets/baileys");
const http = require("http");
const crypto = require("crypto");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");

let sock = null;
let connectionStatus = "disconnected"; // 'disconnected', 'connecting', 'qr', 'connected'
let lastQr = null;
let isResetting = false; // flag to abort auto-reconnect during manual reset
let reconnectDelay = 3000; // starts at 3s, doubles on each failure (max 60s)

function destroySocket() {
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.end();
    } catch (_) {}
    sock = null;
  }
}

function clearAuthFiles() {
  const authDir = path.join(__dirname, "auth_info_baileys");
  if (fs.existsSync(authDir)) {
    const entries = fs.readdirSync(authDir);
    for (const entry of entries) {
      const fullPath = path.join(authDir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          fs.unlinkSync(fullPath); // only delete files, skip dirs like lost+found
        }
      } catch (e) {
        console.error("Error removing auth entry:", fullPath, e.message);
      }
    }
  }
}

async function connectToWhatsApp() {
  if (isResetting) return; // do not start a new connection during reset

  const authDir = path.join(__dirname, "auth_info_baileys");
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys),
    },
    printQRInTerminal: false,
    defaultQueryTimeoutMs: undefined,
  });

  sock.ev.on("connection.update", async (update) => {
    if (isResetting) return; // ignore events during reset

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connectionStatus = "qr";
      try {
        lastQr = await QRCode.toDataURL(qr);
      } catch (err) {
        console.error("Failed to generate QR data URL:", err);
      }
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("Connection closed, reconnecting: ", shouldReconnect, "| delay:", reconnectDelay, "ms");

      if (isResetting) return;

      connectionStatus = "disconnected";
      lastQr = null;

      if (shouldReconnect) {
        const delay = reconnectDelay;
        reconnectDelay = Math.min(reconnectDelay * 2, 60000); // exponential backoff, cap at 60s
        setTimeout(connectToWhatsApp, delay);
      } else {
        reconnectDelay = 3000; // reset backoff on clean logout
        console.log("Logged out from WhatsApp. Clearing auth info and generating new QR.");
        clearAuthFiles();
        setTimeout(connectToWhatsApp, 2000);
      }
    } else if (connection === "open") {
      reconnectDelay = 3000; // reset backoff on successful connection
      console.log("Opened connection successfully");
      connectionStatus = "connected";
      lastQr = null;
    } else if (connection === "connecting") {
      if (lastQr) {
        connectionStatus = "qr";
      } else {
        connectionStatus = "connecting";
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

async function resolveWhatsAppJid(phone) {
  let clean = (phone || "").replace(/\D/g, "");
  if (!clean.startsWith("55") && (clean.length === 10 || clean.length === 11)) {
    clean = "55" + clean;
  }

  // Se não for número brasileiro (+55) ou formato fora do padrão, envia diretamente
  if (!clean.startsWith("55") || clean.length < 12 || clean.length > 13) {
    return clean + "@s.whatsapp.net";
  }

  const ddd = clean.slice(2, 4);
  const rest = clean.slice(4);
  const candidates = [];

  // No Brasil, muitas contas antigas estão registradas no WhatsApp sem o 9º dígito (8 dígitos locais).
  // Se enviarmos para o JID errado, o WhatsApp aceita mas NUNCA entrega ao cliente.
  if (rest.length === 9 && rest.startsWith("9")) {
    candidates.push(clean);                       // com 9 dígitos
    candidates.push(`55${ddd}${rest.slice(1)}`); // sem 9 dígitos
  } else if (rest.length === 8) {
    candidates.push(`55${ddd}9${rest}`);         // com 9 dígitos
    candidates.push(clean);                       // sem 9 dígitos
  } else {
    candidates.push(clean);
  }

  if (sock && typeof sock.onWhatsApp === "function") {
    try {
      const results = await sock.onWhatsApp(...candidates);
      if (Array.isArray(results) && results.length > 0) {
        const found = results.find(r => r.exists && r.jid);
        if (found) {
          console.log(`[WhatsApp] Resolvido JID para ${phone}: ${found.jid}`);
          return found.jid;
        }
      }
    } catch (err) {
      console.warn(`[WhatsApp] Falha ao consultar onWhatsApp para ${phone}:`, err.message);
    }
  }

  // Fallback se a consulta não achar
  return candidates[0] + "@s.whatsapp.net";
}

function normalizePixPayload(pix) {
  const rawKey = String(pix?.key || "").replace(/\([^)]*\)/g, " ").trim();
  if (!rawKey) {
    throw new Error("Chave Pix não informada.");
  }

  let keyType = String(pix?.keyType || "").trim().toUpperCase();
  const validTypes = ["CNPJ", "CPF", "EMAIL", "PHONE", "EVP"];
  if (!validTypes.includes(keyType)) {
    const digits = rawKey.replace(/\D/g, "");
    if (/[^\s()<>]+@[^\s()<>]+\.[^\s()<>]+/.test(rawKey)) keyType = "EMAIL";
    else if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(rawKey)) keyType = "EVP";
    else if (digits.length === 14) keyType = "CNPJ";
    else if (digits.length === 11 && /\d{3}\.\d{3}\.\d{3}-\d{2}/.test(rawKey)) keyType = "CPF";
    else if (digits.length >= 10 && digits.length <= 13) keyType = "PHONE";
    else keyType = "CNPJ";
  }

  let cleanKey = rawKey;
  if (keyType === "CNPJ" || keyType === "CPF") {
    cleanKey = rawKey.replace(/\D/g, "");
    const expected = keyType === "CNPJ" ? 14 : 11;
    if (cleanKey.length !== expected) {
      throw new Error(`Chave Pix ${keyType} inválida (esperado ${expected} dígitos).`);
    }
  } else if (keyType === "PHONE") {
    const digits = rawKey.replace(/\D/g, "");
    if (digits.length === 10 || digits.length === 11) {
      cleanKey = `+55${digits}`;
    } else if (digits.length >= 12 && digits.length <= 15) {
      cleanKey = `+${digits}`;
    } else {
      throw new Error("Chave Pix de telefone inválida.");
    }
  } else if (keyType === "EMAIL") {
    const m = rawKey.match(/[^\s()<>]+@[^\s()<>]+\.[^\s()<>]+/);
    if (!m) throw new Error("Chave Pix de e-mail inválida.");
    cleanKey = m[0].trim().toLowerCase();
  } else if (keyType === "EVP") {
    const m = rawKey.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (!m) throw new Error("Chave Pix aleatória (EVP) inválida.");
    cleanKey = m[0].trim().toLowerCase();
  }

  const merchantName = String(pix?.merchantName || "Pix").trim().slice(0, 60) || "Pix";
  const bodyText = typeof pix?.text === "string" ? pix.text.trim() : "";
  const footerText = typeof pix?.footer === "string" ? pix.footer.trim() : "";

  return { key: cleanKey, keyType, merchantName, bodyText, footerText };
}

function generatePixReferenceId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  const bytes = crypto.randomBytes(11);
  for (let i = 0; i < 11; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

async function sendPixButtonMessage(jid, pix) {
  const { key, keyType, merchantName } = normalizePixPayload(pix);

  const nowSec = Math.floor(Date.now() / 1000);
  const buttonParams = {
    referral: "chat_attachment",
    reference_id: generatePixReferenceId(),
    type: "physical-goods",
    currency: "BRL",
    additional_note: "",
    order: {
      items: [
        {
          quantity: 0,
          name: "",
          retailer_id: `custom-item-${nowSec}`,
          amount: { offset: 1, value: 0 },
        },
      ],
      status: "payment_requested",
      subtotal: { offset: 1, value: 0 },
      order_type: "ORDER_WITHOUT_AMOUNT",
    },
    payment_settings: [
      {
        type: "pix_static_code",
        pix_static_code: {
          key,
          flow_type: "NATIVE",
          key_type: keyType,
          merchant_name: merchantName,
        },
      },
      {
        cards: { enabled: false },
        type: "cards",
      },
    ],
    total_amount: { value: 0, offset: 1 },
  };

  const interactiveMessage = {
    nativeFlowMessage: {
      buttons: [
        {
          name: "payment_info",
          buttonParamsJson: JSON.stringify(buttonParams),
        },
      ],
    },
  };

  const userJid = sock?.authState?.creds?.me?.id || sock?.user?.id;
  const fullMsg = generateWAMessageFromContent(
    jid,
    {
      messageContextInfo: {
        deviceListMetadata: {},
        deviceListMetadataVersion: 2,
        messageSecret: crypto.randomBytes(32),
      },
      interactiveMessage,
    },
    {
      userJid,
      messageId: generateMessageIDV2(userJid),
      timestamp: new Date(),
    }
  );

  const additionalNodes = [
    {
      tag: "biz",
      attrs: {
        native_flow_name: "payment_info",
      },
    },
  ];

  console.log(`[WhatsApp] Sending native Pix button (${keyType}) to: ${jid}`, {
    msgId: fullMsg.key.id,
    ref: buttonParams.reference_id,
  });
  await sock.relayMessage(jid, fullMsg.message, {
    messageId: fullMsg.key.id,
    additionalNodes,
  });
}

// Start WhatsApp socket connection
connectToWhatsApp().catch(err => console.error("Error in Baileys startup:", err));

// Start HTTP server on port 3529
const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname.replace(/\/+/g, '/'); // Normalize multiple slashes to a single slash

  if (pathname === "/status" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: connectionStatus, qr: lastQr }));
    return;
  }

  if (pathname === "/logout" && req.method === "POST") {
    try {
      // Signal all active loops to stop
      isResetting = true;
      connectionStatus = "disconnected";
      lastQr = null;

      // Destroy the current socket completely
      destroySocket();

      // Wait a moment for pending events to drain
      await new Promise(resolve => setTimeout(resolve, 500));

      // Wipe saved credentials so next connection asks for a new QR
      clearAuthFiles();

      // Re-enable connection and start fresh (reset backoff too)
      reconnectDelay = 3000;
      isResetting = false;
      setTimeout(connectToWhatsApp, 500);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      isResetting = false;
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === "/send" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const { messages } = data; // Array details: { phone, text }

        if (!messages || !Array.isArray(messages)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid payload format" }));
          return;
        }

        if (connectionStatus !== "connected" || !sock) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "WhatsApp is not connected. Scan QR Code first." }));
          return;
        }

        const logs = [];
        for (const item of messages) {
          const jid = await resolveWhatsAppJid(item.phone);
          console.log(`Sending message to: ${jid}`);
          if (item.pix) {
            await sendPixButtonMessage(jid, item.pix);
          } else if (item.document) {
            const docBuffer = Buffer.isBuffer(item.document)
              ? item.document
              : Buffer.from(item.document, "base64");
            console.log(`Sending document (${item.fileName || "cronograma.pdf"}, ${Math.round(docBuffer.length / 1024)}KB) to: ${jid}`);
            await sock.sendMessage(jid, {
              document: docBuffer,
              mimetype: item.mimetype || "application/pdf",
              fileName: item.fileName || "cronograma.pdf",
              caption: item.caption || item.text || undefined,
            });
          } else {
            await sock.sendMessage(jid, { text: item.text });
          }
          logs.push({ phone: item.phone, jid, status: "sent" });
          
          // delay to mitigate anti-spam restrictions
          if (messages.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, logs }));
      } catch (err) {
        console.error("[WhatsApp] Erro em /send:", err?.message || err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

const PORT = process.env.PORT || 3529;
server.listen(PORT, () => {
  console.log(`WhatsApp server listening on port ${PORT}`);
});
