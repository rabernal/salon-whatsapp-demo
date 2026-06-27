import type { AgentResult, Session } from "./types.js";
import { SALON, SERVICES, matchService, serviceById } from "./salon.js";
import {
  addDays, availableSlots, book, prettyDate, prettyTime, todayISO, weekdayIndex,
} from "./calendar.js";

// Offline, rule-based Spanish brain. No API key required.
// Good enough to demonstrate the full booking flow for screen recordings.

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseDate(text: string): string | undefined {
  const t = norm(text);
  if (t.includes("pasado manana")) return addDays(todayISO(), 2);
  if (t.includes("manana")) return addDays(todayISO(), 1);
  if (t.includes("hoy")) return todayISO();
  for (let i = 0; i < 7; i++) {
    if (t.includes(norm(WEEKDAYS[i]))) {
      let iso = todayISO();
      for (let step = 0; step < 8; step++) {
        iso = addDays(iso, 1);
        if (weekdayIndex(iso) === i) return iso;
      }
    }
  }
  return undefined;
}

function parseTime(text: string): string | undefined {
  const t = norm(text);
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.?m\.?|p\.?m\.?)?/);
  if (!m) return undefined;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (h < 1 || h > 23) return undefined;
  const explicit = m[3] || "";
  const tarde = /tarde|noche/.test(t);
  const manana = /manana|de la manana/.test(t) && !t.includes("para manana");
  if (explicit.startsWith("p")) {
    if (h < 12) h += 12;
  } else if (explicit.startsWith("a")) {
    if (h === 12) h = 0;
  } else if (tarde && h < 12) {
    h += 12;
  } else if (!manana && h >= 1 && h <= 8) {
    h += 12; // bare "a las 3" in a salon context -> afternoon
  }
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

function parseName(text: string, expecting: boolean): string | undefined {
  const patterns = [
    /me llamo\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)?)/i,
    /mi nombre es\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)?)/i,
    /a nombre de\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)?)/i,
    /soy\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)?)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return titleCase(m[1]);
  }
  if (expecting) {
    const cleaned = text.trim().replace(/[.!¡¿?]/g, "");
    const words = cleaned.split(/\s+/);
    if (words.length >= 1 && words.length <= 3 && /^[a-záéíóúñ\s]+$/i.test(cleaned)) {
      return titleCase(cleaned);
    }
  }
  return undefined;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function listServices(): string {
  return SERVICES.map((s) => `• ${s.name} — $${s.price} (${s.durationMin} min)`).join("\n");
}

function slotsLine(iso: string, serviceId: string): string {
  const slots = availableSlots(iso, serviceId).slice(0, 6).map(prettyTime);
  return slots.join(", ");
}

export function respondMock(session: Session, userText: string): AgentResult {
  const t = norm(userText);
  const st = session.mock;
  const greetedBefore = session.history.some((m) => m.role === "assistant");

  // Price / service-list questions can be answered any time.
  if (/precio|cuanto cuesta|cuanto vale|costo|tarifa/.test(t)) {
    return { reply: `Con gusto 😊 Estos son nuestros precios en ${SALON.name}:\n${listServices()}\n\n¿Te gustaría agendar alguno?` };
  }
  if (/que servicios|servicios tienen|que ofrecen|que hacen/.test(t)) {
    return { reply: `En ${SALON.name} ofrecemos:\n${listServices()}\n\n¿Cuál te gustaría agendar?` };
  }

  // Extract whatever slots are present in this message.
  const svc = matchService(userText);
  if (svc) st.serviceId = svc.id;
  const date = parseDate(userText);
  if (date) st.date = date;

  const expectingName = !!(st.serviceId && st.date && st.time && !st.customerName);
  const name = parseName(userText, expectingName);
  if (name) st.customerName = name;

  // Only accept a time once we know the service (so we can validate availability).
  if (st.serviceId) {
    const time = parseTime(userText);
    if (time) {
      if (st.date && availableSlots(st.date, st.serviceId).includes(time)) {
        st.time = time;
      } else if (st.date) {
        const opts = slotsLine(st.date, st.serviceId);
        return {
          reply: opts
            ? `Uy, las ${prettyTime(time)} ya no está disponible 😅 Para el ${prettyDate(st.date)} tengo: ${opts}. ¿Cuál te acomoda?`
            : `Para el ${prettyDate(st.date)} no tengo horarios libres. ¿Probamos otro día?`,
        };
      } else {
        st.time = time; // keep it; we'll validate after we have a date
      }
    }
  }

  // All slots present -> book.
  if (st.serviceId && st.date && st.time && st.customerName) {
    const service = serviceById(st.serviceId)!;
    const res = book({
      date: st.date, time: st.time, serviceId: st.serviceId, customerName: st.customerName,
    });
    if (!res.ok) {
      const opts = slotsLine(st.date, st.serviceId);
      st.time = undefined;
      return {
        reply: opts
          ? `Esa hora se acaba de ocupar 😅 Para el ${prettyDate(st.date)} tengo: ${opts}. ¿Cuál prefieres?`
          : `Ese día se llenó. ¿Te muestro otro día?`,
      };
    }
    const booking = { date: st.date, time: st.time, serviceId: st.serviceId, customerName: st.customerName };
    session.lastBooking = booking;
    session.mock = {};
    return {
      reply:
        `¡Listo, ${booking.customerName}! 🎉 Tu cita quedó agendada:\n\n` +
        `💅 ${service.name}\n📅 ${prettyDate(booking.date)}\n🕒 ${prettyTime(booking.time)}\n💵 $${service.price}\n\n` +
        `Te enviaré un recordatorio un día antes. ¡Te esperamos en ${SALON.name}! 😊`,
      booking,
    };
  }

  // Otherwise, ask for the next missing piece.
  if (!st.serviceId) {
    const opener = greetedBefore ? "Claro 😊" : `¡Hola! Bienvenida a ${SALON.name} 💖`;
    return {
      reply: `${opener} Con gusto te agendo una cita. ¿Qué servicio te gustaría?\n${listServices()}`,
    };
  }
  const serviceName = serviceById(st.serviceId)!.name;
  if (!st.date) {
    return { reply: `¡Perfecto, ${serviceName.toLowerCase()}! 📅 ¿Qué día te gustaría venir? (por ejemplo: hoy, mañana, o el jueves)` };
  }
  if (!st.time) {
    const opts = slotsLine(st.date, st.serviceId);
    if (!opts) {
      st.date = undefined;
      return { reply: `Para ese día no tengo horarios libres 😕 ¿Probamos otro día?` };
    }
    return { reply: `Para el ${prettyDate(st.date)} tengo estos horarios disponibles: ${opts}. ¿Cuál prefieres? 🕒` };
  }
  // need name
  return { reply: `¡Excelente! Para confirmar tu cita, ¿a nombre de quién la agendo? 😊` };
}
