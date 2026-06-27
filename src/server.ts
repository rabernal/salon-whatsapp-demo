import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Session } from "./types.js";
import type { SalonContext } from "./types.js";
import { getSalon, serviceById } from "./salon.js";
import { listSalons, getMessages, addMessage, clearMessages } from "./db.js";
import { prettyDate, prettyTime } from "./calendar.js";
import { respond, isLiveMode } from "./agent.js";

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
  console.log(`  Salons: ${salons.map((s) => s.slug).join(", ")}`);
  console.log(`  Open: http://localhost:${PORT}  (add ?salon=<slug> to switch)\n`);
});
