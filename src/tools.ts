import type { Appointment, Session } from "./types.js";
import { SALON, SERVICES, serviceById } from "./salon.js";
import {
  availableSlots, book, prettyDate, prettyTime, todayISO, weekdayIndex,
} from "./calendar.js";

const WEEKDAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// ---- Tool schemas exposed to Claude (task-scoped: booking only) ----
export const TOOLS = [
  {
    name: "get_current_date",
    description:
      "Devuelve la fecha de hoy y el día de la semana. Úsalo para resolver fechas relativas como 'hoy', 'mañana' o 'el jueves'.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_services",
    description: "Lista los servicios del salón con su precio y duración.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "check_availability",
    description: "Devuelve los horarios disponibles para un servicio en una fecha específica.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Fecha en formato YYYY-MM-DD" },
        service_id: {
          type: "string",
          enum: SERVICES.map((s) => s.id),
          description: "ID del servicio",
        },
      },
      required: ["date", "service_id"],
    },
  },
  {
    name: "book_appointment",
    description: "Agenda una cita. Confirma con el cliente antes de llamar a esta herramienta.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "Hora en formato 24h HH:MM" },
        service_id: { type: "string", enum: SERVICES.map((s) => s.id) },
        customer_name: { type: "string", description: "Nombre del cliente" },
      },
      required: ["date", "time", "service_id", "customer_name"],
    },
  },
] as const;

// ---- Tool executors. Return { text } for the model; may set a booking on the session. ----
export function runTool(
  name: string,
  input: any,
  session: Session,
): { text: string; booking?: Appointment } {
  switch (name) {
    case "get_current_date": {
      const iso = todayISO();
      return { text: JSON.stringify({ today: iso, weekday: WEEKDAYS_ES[weekdayIndex(iso)] }) };
    }
    case "list_services": {
      const list = SERVICES.map(
        (s) => `${s.name} — $${s.price} (${s.durationMin} min)`,
      );
      return { text: JSON.stringify({ salon: SALON.name, services: list }) };
    }
    case "check_availability": {
      const slots = availableSlots(input.date, input.service_id);
      const svc = serviceById(input.service_id);
      return {
        text: JSON.stringify({
          date: input.date,
          date_pretty: prettyDate(input.date),
          service: svc?.name ?? input.service_id,
          available: slots.map(prettyTime),
          available_24h: slots,
          note: slots.length ? undefined : "No hay horarios disponibles ese día (o el salón está cerrado).",
        }),
      };
    }
    case "book_appointment": {
      const svc = serviceById(input.service_id);
      if (!svc) return { text: JSON.stringify({ ok: false, error: "servicio inválido" }) };
      const appt: Appointment = {
        date: input.date,
        time: input.time,
        serviceId: input.service_id,
        customerName: input.customer_name,
      };
      const res = book(appt);
      if (!res.ok) {
        return {
          text: JSON.stringify({
            ok: false,
            reason: res.reason,
            available_24h: availableSlots(input.date, input.service_id),
          }),
        };
      }
      session.lastBooking = appt;
      return {
        text: JSON.stringify({
          ok: true,
          confirmation: {
            service: svc.name,
            date: prettyDate(appt.date),
            time: prettyTime(appt.time),
            price: `$${svc.price}`,
            name: appt.customerName,
          },
        }),
        booking: appt,
      };
    }
    default:
      return { text: JSON.stringify({ error: `herramienta desconocida: ${name}` }) };
  }
}
