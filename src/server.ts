import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Session } from "./types.js";
import type { SalonContext } from "./types.js";
import { getSalon, serviceById, clearSalonCache } from "./salon.js";
import {
  listSalons, getMessages, addMessage, clearMessages,
  getSalonByWaPhoneId, setWaPhoneNumberId,
} from "./db.js";
import { prettyDate, prettyTime } from "./calendar.js";
import { respond, isLiveMode } from "./agent.js";
import { isWhatsAppConfigured, sendText } from "./whatsapp.js";
import { startReminderScheduler, runRemindersOnce } from "./reminders.js";

// Minimal .env loader (avoids a dotenv dependency).
(() => {
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch { /* ignore */ }
})();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const PORT = parseInt(process.env.PORT || "3000", 10);

// For local/test setup: map a single test number to one salon via env, so you
// don't have to edit the database by hand.
if (process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_DEFAULT_SALON) {
  setWaPhoneNumberId(process.env.WHATSAPP_DEFAULT_SALON, process.env.WHATSAPP_PHONE_NUMBER_ID);
  clearSalonCache();
}

// Remember handled WhatsApp message ids (Meta may redeliver webhooks).
const processedMessages = new Set<string>();

// Sessions are keyed by salon slug + client session id, so two salons never
// share conversation state.
const sessions = new Map<string, Session>();
function sessionKey(slug: string, id: string): string {
  return `${slug}:${id}`;
}
function getSession(salon: SalonContext, id: string): Session {
  const key = sessionKey(salon.slug, id);
  let s = sessions.get(key);
  if (!s) {
    // Rehydrate prior conversation from the database (survives restarts).
    s = { history: getMessages(salon.id, key), mock: {} };
    sessions.set(key, s);
  }
  return s;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJSON(res: http.ServerResponse, code: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

function readRawBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

// Verify Meta's X-Hub-Signature-256 if an app secret is configured.
function verifySignature(req: http.IncomingMessage, raw: string): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // not enforced unless configured
  const header = req.headers["x-hub-signature-256"];
  if (typeof header !== "string") return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Handle one inbound WhatsApp text message: run the agent and reply.
async function handleInbound(
  salon: SalonContext, fromPhone: string, text: string, fromPhoneNumberId: string,
): Promise<void> {
  const session = getSession(salon, fromPhone);
  session.customerPhone = fromPhone;
  const result = await respond(salon, session, text);
  const key = sessionKey(salon.slug, fromPhone);
  addMessage(salon.id, key, "user", text);
  addMessage(salon.id, key, "assistant", result.reply);
  await sendText(fromPhoneNumberId, fromPhone, result.reply);
}

// Parse a WhatsApp webhook payload and process any text messages.
async function processWebhook(payload: any): Promise<void> {
  const entries = payload?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId: string | undefined = value.metadata?.phone_number_id;
      for (const msg of value.messages ?? []) {
        if (msg.type !== "text" || !msg.text?.body) continue;
        if (msg.id && processedMessages.has(msg.id)) continue;
        if (msg.id) processedMessages.add(msg.id);

        const salon =
          (phoneNumberId && getSalonByWaPhoneId(phoneNumberId)?.slug
            ? getSalon(getSalonByWaPhoneId(phoneNumberId)!.slug)
            : undefined) ?? getSalon(process.env.WHATSAPP_DEFAULT_SALON || undefined);
        if (!salon || !phoneNumberId) continue;

        try {
          await handleInbound(salon, msg.from, msg.text.body, phoneNumberId);
        } catch (err) {
          console.error("[webhook] handle error", err);
        }
      }
    }
  }
}

function serveStatic(res: http.ServerResponse, urlPath: string) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath)) {
    res.writeHead(404); res.end("Not found"); return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/api/config") {
    const salon = getSalon(url.searchParams.get("salon") || undefined);
    if (!salon) return sendJSON(res, 404, { error: "salon no encontrado" });
    return sendJSON(res, 200, {
      slug: salon.slug,
      salon: salon.name,
      tagline: salon.tagline,
      mode: isLiveMode() ? "live" : "mock",
      salons: listSalons().map((s) => ({ slug: s.slug, name: s.name })),
      suggestions: [
        "Hola, quiero agendar una cita 💅",
        "¿Qué precios manejan?",
        "¿Tienen disponible mañana en la tarde?",
      ],
    });
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    const { sessionId, message, salon: salonSlug } = await readBody(req);
    if (!sessionId || typeof message !== "string") {
      return sendJSON(res, 400, { error: "sessionId y message son requeridos" });
    }
    const salon = getSalon(salonSlug);
    if (!salon) return sendJSON(res, 404, { error: "salon no encontrado" });
    try {
      const session = getSession(salon, sessionId);
      const result = await respond(salon, session, message);
      const key = sessionKey(salon.slug, sessionId);
      addMessage(salon.id, key, "user", message);
      addMessage(salon.id, key, "assistant", result.reply);
      return sendJSON(res, 200, { reply: result.reply, booking: result.booking ?? null });
    } catch (err: any) {
      console.error("chat error:", err?.message || err);
      return sendJSON(res, 500, { error: "Error del asistente", detail: String(err?.message || err) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    const { sessionId, salon: salonSlug } = await readBody(req);
    const salon = getSalon(salonSlug);
    if (salon && sessionId) {
      const key = sessionKey(salon.slug, sessionId);
      sessions.delete(key);
      clearMessages(salon.id, key);
    }
    return sendJSON(res, 200, { ok: true });
  }

  // Returns a reminder message for the most recent booking (for the demo button).
  if (req.method === "GET" && url.pathname === "/api/reminder") {
    const salon = getSalon(url.searchParams.get("salon") || undefined);
    const sessionId = url.searchParams.get("sessionId") || "";
    if (!salon) return sendJSON(res, 404, { error: "salon no encontrado" });
    const b = sessions.get(`${salon.slug}:${sessionId}`)?.lastBooking;
    if (!b) return sendJSON(res, 200, { reminder: null });
    const svc = serviceById(salon, b.serviceId);
    const reminder =
      `Hola ${b.customerName} 👋 Te recordamos tu cita en ${salon.name}:\n` +
      `💅 ${svc?.name}\n📅 ${prettyDate(b.date)}\n🕒 ${prettyTime(b.time)}\n\n` +
      `Responde *CONFIRMAR* para confirmar o *REAGENDAR* si necesitas cambiarla. ¡Te esperamos! 😊`;
    return sendJSON(res, 200, { reminder });
  }

  // ---- WhatsApp webhook: verification handshake ----
  if (req.method === "GET" && url.pathname === "/webhook") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(challenge || "");
    }
    res.writeHead(403); return res.end("Forbidden");
  }

  // ---- WhatsApp webhook: incoming messages ----
  if (req.method === "POST" && url.pathname === "/webhook") {
    const raw = await readRawBody(req);
    if (!verifySignature(req, raw)) { res.writeHead(401); return res.end("invalid signature"); }
    // Acknowledge immediately (Meta requires a fast 200), then process async.
    res.writeHead(200); res.end("EVENT_RECEIVED");
    let payload: any = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
    processWebhook(payload).catch((err) => console.error("[webhook] process error", err));
    return;
  }

  // ---- Manual reminder trigger (for testing) ----
  if (req.method === "POST" && url.pathname === "/api/run-reminders") {
    const token = url.searchParams.get("token");
    if (process.env.WHATSAPP_VERIFY_TOKEN && token !== process.env.WHATSAPP_VERIFY_TOKEN) {
      return sendJSON(res, 403, { error: "forbidden" });
    }
    const sent = await runRemindersOnce();
    return sendJSON(res, 200, { sent });
  }

  if (req.method === "GET") return serveStatic(res, url.pathname);

  res.writeHead(405); res.end("Method not allowed");
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nERROR: Port ${PORT} is already in use. Stop the other process or set a different PORT in .env.\n`);
    process.exit(1);
  }
  console.error("Server error:", err);
  process.exit(1);
});

server.listen(PORT, () => {
  const salons = listSalons();
  console.log(`\n  WhatsApp booking demo running`);
  console.log(`  Mode: ${isLiveMode() ? "LIVE (Claude)" : "MOCK (offline, no API key)"}`);
  console.log(`  WhatsApp: ${isWhatsAppConfigured() ? "configured (webhook active)" : "not configured (web demo only)"}`);
  console.log(`  Salons: ${salons.map((s) => s.slug).join(", ")}`);
  console.log(`  Open: http://localhost:${PORT}  (add ?salon=<slug> to switch)\n`);
  startReminderScheduler();
});
