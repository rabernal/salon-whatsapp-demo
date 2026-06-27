import type { Appointment } from "./types.js";
import { SALON, serviceById } from "./salon.js";
import { getBookedAppointments, insertAppointment, upsertCustomer } from "./db.js";

const WEEKDAYS_ES = [
  "domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado",
];
const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(iso: string): Date {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y, m - 1, day);
}

export function todayISO(): string {
  return toISO(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function weekdayIndex(iso: string): number {
  return fromISO(iso).getDay();
}

export function prettyDate(iso: string): string {
  const d = fromISO(iso);
  return `${WEEKDAYS_ES[d.getDay()]} ${d.getDate()} de ${MONTHS_ES[d.getMonth()]}`;
}

export function prettyTime(time: string): string {
  // 24h "HH:MM" -> "h:MM am/pm"
  const [h, m] = time.split(":").map(Number);
  const period = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${period}`;
}

function isClosed(iso: string): boolean {
  return SALON.closedWeekdays.includes(weekdayIndex(iso));
}

function timeToMin(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// All free start times for a service on a given date (read from the DB).
export function availableSlots(iso: string, serviceId: string): string[] {
  const service = serviceById(serviceId);
  if (!service || isClosed(iso)) return [];

  const open = SALON.openHour * 60;
  const close = SALON.closeHour * 60;
  const step = SALON.slotStepMin;

  // Booked intervals for that day, from the database.
  const booked = getBookedAppointments(SALON.id, iso).map((a) => {
    const start = timeToMin(a.time);
    const dur = serviceById(a.service_code)?.durationMin ?? 30;
    return [start, start + dur] as [number, number];
  });

  // If today, don't offer times already past (with 60-min lead time).
  const now = new Date();
  const isToday = iso === todayISO();
  const earliest = isToday ? now.getHours() * 60 + now.getMinutes() + 60 : 0;

  const slots: string[] = [];
  for (let t = open; t + service.durationMin <= close; t += step) {
    if (t < earliest) continue;
    const overlaps = booked.some(([bs, be]) => t < be && t + service.durationMin > bs);
    if (!overlaps) slots.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  }
  return slots;
}

export function isSlotFree(iso: string, time: string, serviceId: string): boolean {
  return availableSlots(iso, serviceId).includes(time);
}

export function book(
  appt: Appointment & { customerPhone?: string | null },
): { ok: boolean; reason?: string } {
  if (isClosed(appt.date)) return { ok: false, reason: "closed" };
  if (!isSlotFree(appt.date, appt.time, appt.serviceId)) {
    return { ok: false, reason: "taken" };
  }
  insertAppointment({
    salonId: SALON.id,
    serviceCode: appt.serviceId,
    date: appt.date,
    time: appt.time,
    customerName: appt.customerName,
    customerPhone: appt.customerPhone ?? null,
  });
  upsertCustomer(SALON.id, appt.customerName, appt.customerPhone ?? null);
  return { ok: true };
}
