import type { Service } from "./types.js";

// ---- Demo salon profile (edit freely for each demo recording) ----
export const SALON = {
  name: "Studio Bella",
  tagline: "Salón de belleza",
  // Business hours in 24h. Open 9:00–19:00, closed Sundays.
  openHour: 9,
  closeHour: 19,
  closedWeekdays: [0], // 0 = Sunday
  slotStepMin: 30,
};

export const SERVICES: Service[] = [
  { id: "mani", name: "Manicure", durationMin: 45, price: 25 },
  { id: "pedi", name: "Pedicure", durationMin: 60, price: 35 },
  { id: "gel", name: "Uñas de gel", durationMin: 90, price: 55 },
  { id: "corte", name: "Corte de cabello", durationMin: 45, price: 30 },
  { id: "tinte", name: "Tinte", durationMin: 120, price: 80 },
];

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
    if (table[id].some((kw) => t.includes(kw))) return serviceById(id);
  }
  // generic "uñas" / "cita de uñas" -> manicure
  if (t.includes("uña") || t.includes("una ")) return serviceById("mani");
  return undefined;
}
