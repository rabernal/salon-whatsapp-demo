# Studio Bella — WhatsApp Booking Assistant (Recordable Demo)

A WhatsApp-style AI booking assistant for a Spanish-speaking salon. Built to be
**screen-recorded** for client outreach. It runs in two modes:

- **MOCK mode (default):** fully offline, no API key, no paid packages. Great for
  previewing the UI and recording a quick clip immediately.
- **LIVE mode:** uses **Claude** for natural Spanish conversation and real
  tool-calling (availability + booking). This is the version you'll record to
  show prospects.

The customer chats; the assistant answers instantly in Spanish, checks
availability, books the appointment, and can send an automatic reminder.

---

## Quick start

Requires Node.js 18+.

```bash
# 1. Install dependencies
npm install

# 2a. Run in MOCK mode (no key needed)
npm run dev

# 2b. OR run in LIVE mode with Claude
cp .env.example .env
#   then edit .env and set ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

Open http://localhost:3000

The header shows a **MOCK** or **LIVE** badge so you always know which mode you're in.

---

## Recording the demo (for outreach)

1. Run in **LIVE** mode (natural Spanish reads best on camera).
2. Use a screen recorder (Loom is free). Set the window to a phone-ish width.
3. Walk through a natural booking:
   - "Hola, quiero agendar una cita de uñas de gel"
   - "¿Qué precios manejan?"
   - "¿Tienen para mañana en la tarde?"
   - pick a time, give a name
4. Click the 🔔 button to show the **automatic reminder** — this is the
   no-show-reducer that owners care about.
5. Keep it under 60 seconds. Personalize the intro with the salon's name when you
   send it (see the Outreach Kit).

---

## How it works

```
public/            WhatsApp-style chat UI (HTML/CSS/JS)
src/
  server.ts        Native Node HTTP server + tiny .env loader
  agent.ts         Dispatches to LIVE (Claude tool-use loop) or MOCK
  mockBrain.ts     Offline rule-based Spanish brain (no key)
  tools.ts         Tool schemas + executors (services, availability, booking)
  calendar.ts      In-memory calendar + availability logic
  salon.ts         Salon profile + services (edit these per demo)
  types.ts         Shared types
```

- **Task-scoped agent.** In LIVE mode the assistant is constrained to booking
  tasks only (services, availability, scheduling). This matches WhatsApp's 2026
  rule allowing task-specific agents (appointment booking) rather than
  open-ended chatbots.
- **Tools the model can call:** `get_current_date`, `list_services`,
  `check_availability`, `book_appointment`.
- **State is in memory.** Appointments reset when you restart the server. A few
  slots are pre-booked on startup so availability looks realistic.

## Customize for a specific salon

Edit `src/salon.ts`:
- `SALON.name`, hours, closed days.
- `SERVICES` — names, prices, durations.

Change the model with `ANTHROPIC_MODEL` in `.env` (default `claude-sonnet-4-6`).

---

## What this is NOT (yet)

This is the **demo**, not the production product. It does not connect to the real
WhatsApp Cloud API. The next phase wires the same `agent.ts` / `tools.ts` to
Meta's Cloud API webhooks, a real calendar, and a reminder scheduler — multi-tenant,
one codebase per many salons. (See the architecture in the project plan.)
