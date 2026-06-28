// Day-before reminder scheduler. Finds tomorrow's booked appointments (per
// salon timezone) that haven't been reminded yet and sends them via WhatsApp.
import {
  listSalons, getAppointmentsNeedingReminder, markReminded,
} from "./db.js";
import { getSalon, serviceById } from "./salon.js";
import { addDays, prettyDate, prettyTime, todayISO } from "./calendar.js";
import { isWhatsAppConfigured, sendTemplate, sendText } from "./whatsapp.js";

// Runs one pass across all salons. Returns the number of reminders sent.
export async function runRemindersOnce(): Promise<number> {
  let sent = 0;
  for (const row of listSalons()) {
    const salon = getSalon(row.slug);
    if (!salon || !salon.waPhoneNumberId) continue; // need a number to send from

    const tomorrow = addDays(todayISO(salon.timezone), 1);
    const appts = getAppointmentsNeedingReminder(salon.id, tomorrow);

    for (const a of appts) {
      if (!a.customer_phone) { markReminded(a.id); continue; } // nothing to send to
      const svc = serviceById(salon, a.service_code);
      const serviceName = svc?.name ?? a.service_code;
      const template = process.env.WHATSAPP_REMINDER_TEMPLATE;
      try {
        if (template) {
          // Template params order must match your approved template's {{1}}…{{n}}.
          await sendTemplate(
            salon.waPhoneNumberId, a.customer_phone, template,
            process.env.WHATSAPP_TEMPLATE_LANG || "es",
            [a.customer_name, serviceName, prettyDate(a.date), prettyTime(a.time), salon.name],
          );
        } else {
          // Dev/test path (works only inside the 24h window).
          await sendText(
            salon.waPhoneNumberId, a.customer_phone,
            `Hola ${a.customer_name} 👋 Te recordamos tu cita de ${serviceName} ` +
            `mañana ${prettyDate(a.date)} a las ${prettyTime(a.time)} en ${salon.name}. ` +
            `Responde CONFIRMAR para confirmar o REAGENDAR si necesitas cambiarla.`,
          );
        }
        markReminded(a.id);
        sent++;
      } catch (err) {
        console.error("[reminders] failed for appointment", a.id, err);
      }
    }
  }
  return sent;
}

let timer: ReturnType<typeof setInterval> | null = null;

// Starts the hourly scheduler (no-op if WhatsApp isn't configured).
export function startReminderScheduler(): void {
  if (!isWhatsAppConfigured()) {
    console.log("[reminders] WhatsApp not configured — scheduler disabled.");
    return;
  }
  if (timer) return;
  const everyMs = 60 * 60 * 1000; // hourly
  const tick = () =>
    runRemindersOnce()
      .then((n) => { if (n) console.log(`[reminders] sent ${n} reminder(s)`); })
      .catch((err) => console.error("[reminders] pass failed", err));
  timer = setInterval(tick, everyMs);
  tick(); // run once on boot
  console.log("[reminders] scheduler started (hourly).");
}
