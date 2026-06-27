// Offline test suite. Drives the rule-based mock brain through Spanish booking
// scenarios and asserts correct behavior. No API key needed.
//   Run with:  npm test
import fs from "node:fs";
import path from "node:path";

// Use a throwaway database so tests never touch data/salon.db.
const TEST_DB = path.resolve("data", "_test.db");
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  try { fs.unlinkSync(f); } catch { /* ignore */ }
}
process.env.DATABASE_PATH = TEST_DB;
delete process.env.ANTHROPIC_API_KEY; // force MOCK mode

const { getSalon } = await import("../src/salon.js");
const { respondMock } = await import("../src/mockBrain.js");
const {
  availableSlots, book, todayISO, addDays, weekdayIndex,
} = await import("../src/calendar.js");
import type { Session, SalonContext } from "../src/types.js";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}
function freshSession(): Session {
  return { history: [], mock: {} };
}
function say(salon: SalonContext, s: Session, text: string) {
  const r = respondMock(salon, s, text);
  s.history.push({ role: "user", content: text });
  s.history.push({ role: "assistant", content: r.reply });
  return r;
}
// next strict-future date with the given weekday (matches parseDate semantics)
function nextWeekday(salon: SalonContext, wd: number): string {
  let iso = todayISO(salon.timezone);
  for (let i = 0; i < 8; i++) {
    iso = addDays(iso, 1);
    if (weekdayIndex(iso) === wd) return iso;
  }
  return iso;
}

const sb = getSalon("studio-bella")!;
const ej = getSalon("el-jefe")!;
check("default salons load", !!sb && !!ej);

console.log("\nStudio Bella:");

// 1) Price question
{
  const r = say(sb, freshSession(), "¿qué precios manejan?");
  check("price question lists Uñas de gel + $55", r.reply.includes("Uñas de gel") && r.reply.includes("$55"));
}

// 2) Full happy-path booking on an open day (Wednesday)
{
  const s = freshSession();
  const date = nextWeekday(sb, 3); // Wednesday
  const slot = availableSlots(sb, date, "gel")[0];
  say(sb, s, "quiero una cita de uñas de gel");
  say(sb, s, "el miércoles");
  say(sb, s, slot);
  const r = say(sb, s, "me llamo María");
  check("gel booking created", !!r.booking, JSON.stringify(r.booking));
  check("booking service = gel", r.booking?.serviceId === "gel");
  check("booking date = next Wednesday", r.booking?.date === date, `${r.booking?.date} vs ${date}`);
  check("booking name = María", r.booking?.customerName === "María");
}

// 3) Closed day (Sunday) is refused
{
  const s = freshSession();
  say(sb, s, "quiero uñas de gel");
  const r = say(sb, s, "el domingo");
  check("closed Sunday -> no booking", !r.booking);
  check("closed Sunday -> mentions no availability", /no tengo horarios|otro día/i.test(r.reply), r.reply);
}

// 4) One-shot booking in a single message
{
  const s = freshSession();
  const date = nextWeekday(sb, 4); // Thursday
  const slot = availableSlots(sb, date, "mani")[0];
  const r = say(sb, s, `quiero manicure el jueves a las ${slot}, me llamo Ana`);
  check("one-shot manicure booking", !!r.booking && r.booking?.serviceId === "mani", JSON.stringify(r.booking));
}

console.log("\nBarbería El Jefe (second tenant):");

// 5) Barber combo booking (service matching specific to this salon)
{
  const s = freshSession();
  const date = nextWeekday(ej, 3); // Wednesday (El Jefe closed Mondays, open Wed)
  const slot = availableSlots(ej, date, "combo")[0];
  say(ej, s, "quiero corte y barba");
  say(ej, s, "el miércoles");
  say(ej, s, slot);
  const r = say(ej, s, "soy Pedro");
  check("combo booking created", !!r.booking && r.booking?.serviceId === "combo", JSON.stringify(r.booking));
}

console.log("\nIntegrity:");

// 6) Double-booking guard: same slot can't be booked twice
{
  const date = nextWeekday(sb, 5); // Friday
  const slot = availableSlots(sb, date, "corte")[0];
  const first = book(sb, { date, time: slot, serviceId: "corte", customerName: "Uno" });
  const second = book(sb, { date, time: slot, serviceId: "corte", customerName: "Dos" });
  check("first booking ok", first.ok);
  check("second identical booking rejected", !second.ok && second.reason === "taken", JSON.stringify(second));
}

// 7) Tenant isolation: El Jefe has no "gel" service
{
  check("El Jefe has no gel service", !ej.services.find((s) => s.id === "gel"));
  check("Studio Bella has gel service", !!sb.services.find((s) => s.id === "gel"));
}

// 8) Timezone helper returns a valid ISO date
{
  check("nowInTZ-based today is YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(todayISO(sb.timezone)));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
// cleanup
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  try { fs.unlinkSync(f); } catch { /* ignore */ }
}
process.exit(failed ? 1 : 0);
