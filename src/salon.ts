import type { Service } from "./types.js";
import { getDefaultSalon, getServicesForSalon } from "./db.js";

// The active salon config + services are loaded from the database at startup.
// (Edit the salon/services in the DB, or in the seed in db.ts, not here.)
const salonRow = getDefaultSalon();

export const SALON = {
  id: salonRow.id,
  slug: salonRow.slug,
  name: salonRow.name,
  tagline: salonRow.tagline,
  openHour: salonRow.open_hour,
  closeHour: salonRow.close_hour,
  closedWeekdays: JSON.parse(salonRow.closed_weekdays) as number[],
  slotStepMin: salonRow.slot_step_min,
};

export const SERVICES: Service[] = getServicesForSalon(salonRow.id).map((s) => ({
  id: s.code,
  name: s.name,
  durationMin: s.duration_min,
  price: s.price,
}));

export function serviceById(id: string): Service | undefined {
  return SERVICES.find((s) => s.id === id);
}

// Match free-text (Spanish) to a service id.
export function matchService(text: string): Service | undefined {
  const t = text.toLowerCase();
  const table: Record<string, string[]> = {
    gel: ["gel", "acrilic", "acríl"],
    mani: ["manicure", "manicura", "uñas de las manos", "uñas manos"],
    pedi: ["pedicure", "pedicura", "pies"],
    corte: ["corte", "cortar", "cabello", "pelo", "recorte"],
    tinte: ["tinte", "color", "teñir", "tinta", "mechas"],
  };
  // Check gel before mani so "uñas de gel" wins over generic "uñas".
  for (const id of ["gel", "tinte", "corte", "pedi", "mani"]) {
    if (table[id]?.some((kw) => t.includes(kw))) return serviceById(id);
  }
  // generic "uñas" / "cita de uñas" -> manicure
  if (t.includes("uña") || t.includes("una ")) return serviceById("mani");
  return undefined;
}
