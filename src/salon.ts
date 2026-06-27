import type { Service, SalonContext } from "./types.js";
import {
  getDefaultSalon, getSalonBySlug, getServicesForSalon, type SalonRow,
} from "./db.js";

// Loaded salons are cached by slug (config/services rarely change at runtime).
const cache = new Map<string, SalonContext>();

function build(row: SalonRow): SalonContext {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    timezone: row.timezone,
    openHour: row.open_hour,
    closeHour: row.close_hour,
    closedWeekdays: JSON.parse(row.closed_weekdays) as number[],
    slotStepMin: row.slot_step_min,
    services: getServicesForSalon(row.id).map((s) => ({
      id: s.code,
      name: s.name,
      durationMin: s.duration_min,
      price: s.price,
    })),
  };
}

// Resolve a salon by slug (or the default salon if no slug). Returns undefined
// if the slug doesn't exist.
export function getSalon(slug?: string): SalonContext | undefined {
  const key = slug && slug.trim() ? slug.trim() : "__default__";
  const cached = cache.get(key);
  if (cached) return cached;

  const row = slug && slug.trim() ? getSalonBySlug(slug.trim()) : getDefaultSalon();
  if (!row) return undefined;
  const ctx = build(row);
  cache.set(key, ctx);
  cache.set(row.slug, ctx);
  return ctx;
}

export function serviceById(salon: SalonContext, id: string): Service | undefined {
  return salon.services.find((s) => s.id === id);
}

// Synonyms for common service codes (used in addition to matching service names).
const SYNONYMS: Record<string, string[]> = {
  gel: ["gel", "acrilic", "acríl"],
  mani: ["manicure", "manicura", "uñas de las manos", "uñas manos"],
  pedi: ["pedicure", "pedicura", "pies"],
  corte: ["corte", "cortar", "cabello", "pelo", "recorte"],
  tinte: ["tinte", "color", "teñir", "tinta", "mechas"],
  barba: ["barba", "afeitar", "afeitado", "bigote"],
  combo: ["corte y barba", "corte + barba", "combo", "completo"],
};

// Match free-text (Spanish) to one of THIS salon's services.
export function matchService(salon: SalonContext, text: string): Service | undefined {
  const t = text.toLowerCase();

  // 1) combo-style multi-word services first (most specific)
  const combo = salon.services.find((s) => s.id === "combo");
  if (combo && SYNONYMS.combo.some((kw) => t.includes(kw))) return combo;

  // 2) synonym table, restricted to services this salon actually offers
  for (const svc of salon.services) {
    const kws = SYNONYMS[svc.id];
    if (kws && kws.some((kw) => t.includes(kw))) return svc;
  }

  // 3) direct match on the service's own name
  for (const svc of salon.services) {
    if (t.includes(svc.name.toLowerCase())) return svc;
  }

  // 4) generic "uñas" -> manicure if offered
  if (t.includes("uña") || t.includes("una ")) {
    return salon.services.find((s) => s.id === "mani");
  }
  return undefined;
}
