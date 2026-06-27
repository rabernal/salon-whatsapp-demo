import type { AgentResult, Session } from "./types.js";
import { SALON, SERVICES } from "./salon.js";
import { TOOLS, runTool } from "./tools.js";
import { respondMock } from "./mockBrain.js";

export function isLiveMode(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const SYSTEM_PROMPT = `Eres el asistente de citas por WhatsApp de "${SALON.name}", un ${SALON.tagline}.
Tu ÚNICA función es ayudar a los clientes a: ver servicios y precios, consultar disponibilidad y agendar citas.

Reglas:
- Responde SIEMPRE en español, con un tono cálido, breve y amable. Puedes usar algún emoji con moderación.
- Mantente estrictamente en el tema de citas del salón. Si te preguntan otra cosa, redirige con amabilidad.
- Usa las herramientas para fechas, disponibilidad y reservas. Nunca inventes horarios; consúltalos con check_availability.
- Para fechas relativas ("hoy", "mañana", "el jueves") usa get_current_date primero.
- Antes de agendar, confirma servicio, fecha, hora y el nombre del cliente.
- Tras agendar, confirma los detalles y menciona que se enviará un recordatorio un día antes.
- Servicios disponibles: ${SERVICES.map((s) => `${s.name} ($${s.price})`).join(", ")}.`;

// Lazily import the SDK so the project runs in mock mode without it installed.
let clientPromise: Promise<any> | null = null;
async function getClient(): Promise<any> {
  if (!clientPromise) {
    clientPromise = import("@anthropic-ai/sdk").then(
      (m) => new m.default({ apiKey: process.env.ANTHROPIC_API_KEY }),
    );
  }
  return clientPromise;
}

async function respondLive(session: Session, userText: string): Promise<AgentResult> {
  const client = await getClient();
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

  // Build message list from history + new user turn.
  const messages: any[] = session.history.map((m) => ({ role: m.role, content: m.content }));
  messages.push({ role: "user", content: userText });

  let booking: AgentResult["booking"];

  // Tool-use loop (cap iterations for safety).
  for (let i = 0; i < 6; i++) {
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS as any,
      messages,
    });

    if (res.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: res.content });
      const toolResults: any[] = [];
      for (const block of res.content) {
        if (block.type === "tool_use") {
          const out = runTool(block.name, block.input, session);
          if (out.booking) booking = out.booking;
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: out.text,
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // Final text answer.
    const text = res.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    return { reply: text || "…", booking };
  }
  return { reply: "Lo siento, tuve un problema procesando eso. ¿Lo intentamos de nuevo?", booking };
}

export async function respond(session: Session, userText: string): Promise<AgentResult> {
  const result = isLiveMode()
    ? await respondLive(session, userText)
    : respondMock(session, userText);

  // Persist conversation history.
  session.history.push({ role: "user", content: userText });
  session.history.push({ role: "assistant", content: result.reply });
  return result;
}
