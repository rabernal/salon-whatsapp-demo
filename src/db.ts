import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---- Connection ----
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, "salon.db");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---- Row types ----
export interface SalonRow {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  timezone: string;
  open_hour: number;
  close_hour: number;
  closed_weekdays: string; // JSON array of weekday indexes
  slot_step_min: number;
}
export interface ServiceRow {
  id: number;
  salon_id: number;
  code: string;
  name: string;
  duration_min: number;
  price: number;
  active: number;
}
export interface BookedRow {
  time: string;
  service_code: string;
}

// ---- Schema ----
function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS salons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT 'America/Chicago',
      open_hour INTEGER NOT NULL DEFAULT 9,
      close_hour INTEGER NOT NULL DEFAULT 19,
      closed_weekdays TEXT NOT NULL DEFAULT '[0]',
      slot_step_min INTEGER NOT NULL DEFAULT 30,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      price INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(salon_id, code)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      name TEXT,
      phone TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(salon_id, phone)
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      service_code TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      status TEXT NOT NULL DEFAULT 'booked',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_appt_salon_date
      ON appointments(salon_id, date, status);

    -- Hard guard against two active bookings at the same start time for a salon.
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_slot
      ON appointments(salon_id, date, time) WHERE status = 'booked';

    -- Conversation history (so chats survive a server restart).
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      session_key TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_msg_session
      ON messages(salon_id, session_key, id);
  `);
}

// ---- Seed definitions (idempotent: each salon added only if its slug is missing) ----
interface SalonSeed {
  slug: string;
  name: string;
  tagline: string;
  timezone: string;
  open_hour: number;
  close_hour: number;
  closed_weekdays: number[];
  slot_step_min: number;
  services: { code: string; name: string; duration_min: number; price: number }[];
  // two service codes to pre-book on the next open days, for realistic availability
  demo: [string, string];
}

const SALON_SEEDS: SalonSeed[] = [
  {
    slug: "studio-bella",
    name: "Studio Bella",
    tagline: "Salón de belleza",
    timezone: "America/Chicago",
    open_hour: 9,
    close_hour: 19,
    closed_weekdays: [0],
    slot_step_min: 30,
    services: [
      { code: "mani", name: "Manicure", duration_min: 45, price: 25 },
      { code: "pedi", name: "Pedicure", duration_min: 60, price: 35 },
      { code: "gel", name: "Uñas de gel", duration_min: 90, price: 55 },
      { code: "corte", name: "Corte de cabello", duration_min: 45, price: 30 },
      { code: "tinte", name: "Tinte", duration_min: 120, price: 80 },
    ],
    demo: ["gel", "pedi"],
  },
  {
    slug: "el-jefe",
    name: "Barbería El Jefe",
    tagline: "Barbería",
    timezone: "America/Chicago",
    open_hour: 10,
    close_hour: 20,
    closed_weekdays: [1], // closed Mondays
    slot_step_min: 30,
    services: [
      { code: "corte", name: "Corte de cabello", duration_min: 45, price: 25 },
      { code: "barba", name: "Arreglo de barba", duration_min: 30, price: 18 },
      { code: "combo", name: "Corte + barba", duration_min: 75, price: 38 },
      { code: "tinte", name: "Tinte", duration_min: 60, price: 35 },
    ],
    demo: ["combo", "corte"],
  },
];

function ensureSalon(seedDef: SalonSeed): void {
  const existing = db.prepare("SELECT id FROM salons WHERE slug = ?").get(seedDef.slug) as
    | { id: number }
    | undefined;
  if (existing) return;

  const info = db
    .prepare(
      `INSERT INTO salons (slug, name, tagline, timezone, open_hour, close_hour, closed_weekdays, slot_step_min)
       VALUES (@slug, @name, @tagline, @timezone, @open_hour, @close_hour, @closed_weekdays, @slot_step_min)`,
    )
    .run({ ...seedDef, closed_weekdays: JSON.stringify(seedDef.closed_weekdays) });
  const salonId = Number(info.lastInsertRowid);

  const insertService = db.prepare(
    "INSERT INTO services (salon_id, code, name, duration_min, price) VALUES (?, ?, ?, ?, ?)",
  );
  const tx = db.transaction(() => {
    for (const s of seedDef.services) {
      insertService.run(salonId, s.code, s.name, s.duration_min, s.price);
    }
  });
  tx();

  seedDemoAppointments(salonId, seedDef.closed_weekdays, seedDef.demo, seedDef.open_hour);
}

// A couple of pre-booked slots so availability looks realistic on first run.
function seedDemoAppointments(
  salonId: number,
  closed: number[],
  codes: [string, string],
  openHour: number,
): void {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const days: string[] = [];
  const d = new Date();
  let guard = 0;
  while (days.length < 2 && guard < 10) {
    d.setDate(d.getDate() + 1);
    if (!closed.includes(d.getDay())) days.push(toISO(d));
    guard++;
  }
  const t1 = `${pad(openHour)}:00`;
  const t2 = `${pad(openHour + 3)}:00`;
  const ins = db.prepare(
    `INSERT INTO appointments (salon_id, service_code, date, time, customer_name, status)
     VALUES (?, ?, ?, ?, ?, 'booked')`,
  );
  for (const day of days) {
    ins.run(salonId, codes[0], day, t1, "Reserva");
    ins.run(salonId, codes[1], day, t2, "Reserva");
  }
}

function seed(): void {
  for (const s of SALON_SEEDS) ensureSalon(s);
}

migrate();
seed();

export function listSalons(): SalonRow[] {
  return db.prepare("SELECT * FROM salons ORDER BY id").all() as SalonRow[];
}

// ---- Repository functions ----
export function getDefaultSalon(): SalonRow {
  return db.prepare("SELECT * FROM salons ORDER BY id LIMIT 1").get() as SalonRow;
}

export function getSalonBySlug(slug: string): SalonRow | undefined {
  return db.prepare("SELECT * FROM salons WHERE slug = ?").get(slug) as SalonRow | undefined;
}

export function getServicesForSalon(salonId: number): ServiceRow[] {
  return db
    .prepare("SELECT * FROM services WHERE salon_id = ? AND active = 1 ORDER BY id")
    .all(salonId) as ServiceRow[];
}

export function getBookedAppointments(salonId: number, date: string): BookedRow[] {
  return db
    .prepare(
      "SELECT time, service_code FROM appointments WHERE salon_id = ? AND date = ? AND status = 'booked'",
    )
    .all(salonId, date) as BookedRow[];
}

// Returns the new appointment id, or null if the slot was already taken
// (the partial unique index rejects a second active booking at the same time).
export function insertAppointment(a: {
  salonId: number;
  serviceCode: string;
  date: string;
  time: string;
  customerName: string;
  customerPhone?: string | null;
}): number | null {
  try {
    const info = db
      .prepare(
        `INSERT INTO appointments (salon_id, service_code, date, time, customer_name, customer_phone)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(a.salonId, a.serviceCode, a.date, a.time, a.customerName, a.customerPhone ?? null);
    return Number(info.lastInsertRowid);
  } catch (err: any) {
    if (typeof err?.code === "string" && err.code.startsWith("SQLITE_CONSTRAINT")) return null;
    throw err;
  }
}

// ---- Conversation history ----
export function getMessages(
  salonId: number, sessionKey: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  return db
    .prepare(
      "SELECT role, content FROM messages WHERE salon_id = ? AND session_key = ? ORDER BY id",
    )
    .all(salonId, sessionKey) as Array<{ role: "user" | "assistant"; content: string }>;
}

export function addMessage(
  salonId: number, sessionKey: string, role: "user" | "assistant", content: string,
): void {
  db.prepare(
    "INSERT INTO messages (salon_id, session_key, role, content) VALUES (?, ?, ?, ?)",
  ).run(salonId, sessionKey, role, content);
}

export function clearMessages(salonId: number, sessionKey: string): void {
  db.prepare("DELETE FROM messages WHERE salon_id = ? AND session_key = ?").run(salonId, sessionKey);
}

export function upsertCustomer(salonId: number, name: string, phone?: string | null): void {
  if (!phone) return; // only track customers we can identify by phone
  db.prepare(
    `INSERT INTO customers (salon_id, name, phone) VALUES (?, ?, ?)
     ON CONFLICT(salon_id, phone) DO UPDATE SET name = excluded.name`,
  ).run(salonId, name, phone);
}

export function allAppointmentsForSalon(salonId: number): Array<{
  date: string; time: string; service_code: string; customer_name: string; status: string;
}> {
  return db
    .prepare(
      "SELECT date, time, service_code, customer_name, status FROM appointments WHERE salon_id = ? ORDER BY date, time",
    )
    .all(salonId) as any;
}
