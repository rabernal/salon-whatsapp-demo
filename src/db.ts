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
  `);
}

// ---- Seed (only when empty) ----
function seed(): void {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM salons").get() as { n: number }).n;
  if (count > 0) return;

  const insertSalon = db.prepare(`
    INSERT INTO salons (slug, name, tagline, timezone, open_hour, close_hour, closed_weekdays, slot_step_min)
    VALUES (@slug, @name, @tagline, @timezone, @open_hour, @close_hour, @closed_weekdays, @slot_step_min)
  `);
  const info = insertSalon.run({
    slug: "studio-bella",
    name: "Studio Bella",
    tagline: "Salón de belleza",
    timezone: "America/Chicago",
    open_hour: 9,
    close_hour: 19,
    closed_weekdays: "[0]",
    slot_step_min: 30,
  });
  const salonId = Number(info.lastInsertRowid);

  const services: Omit<ServiceRow, "id" | "salon_id" | "active">[] = [
    { code: "mani", name: "Manicure", duration_min: 45, price: 25 },
    { code: "pedi", name: "Pedicure", duration_min: 60, price: 35 },
    { code: "gel", name: "Uñas de gel", duration_min: 90, price: 55 },
    { code: "corte", name: "Corte de cabello", duration_min: 45, price: 30 },
    { code: "tinte", name: "Tinte", duration_min: 120, price: 80 },
  ];
  const insertService = db.prepare(`
    INSERT INTO services (salon_id, code, name, duration_min, price)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction(() => {
    for (const s of services) {
      insertService.run(salonId, s.code, s.name, s.duration_min, s.price);
    }
  });
  insertMany();

  seedDemoAppointments(salonId);
}

// A couple of pre-booked slots so availability looks realistic on first run.
function seedDemoAppointments(salonId: number): void {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const closed = [0];
  const days: string[] = [];
  const d = new Date();
  let guard = 0;
  while (days.length < 2 && guard < 10) {
    d.setDate(d.getDate() + 1);
    if (!closed.includes(d.getDay())) days.push(toISO(d));
    guard++;
  }
  const ins = db.prepare(`
    INSERT INTO appointments (salon_id, service_code, date, time, customer_name, status)
    VALUES (?, ?, ?, ?, ?, 'booked')
  `);
  for (const day of days) {
    ins.run(salonId, "gel", day, "09:00", "Reserva");
    ins.run(salonId, "pedi", day, "13:00", "Reserva");
  }
}

migrate();
seed();

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

export function insertAppointment(a: {
  salonId: number;
  serviceCode: string;
  date: string;
  time: string;
  customerName: string;
  customerPhone?: string | null;
}): number {
  const info = db
    .prepare(
      `INSERT INTO appointments (salon_id, service_code, date, time, customer_name, customer_phone)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(a.salonId, a.serviceCode, a.date, a.time, a.customerName, a.customerPhone ?? null);
  return Number(info.lastInsertRowid);
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
