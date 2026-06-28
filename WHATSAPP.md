# WhatsApp Cloud API integration

This wires the booking assistant to real WhatsApp. It's optional: with no
WhatsApp env vars set, the app runs exactly as before (web demo only). Set the
vars and the webhook + reminders activate.

## What it adds

- `GET /webhook` — Meta verification handshake.
- `POST /webhook` — receives WhatsApp messages, routes each to the right salon
  (by the inbound `phone_number_id`), runs the agent, and replies via the
  Cloud API. Conversation history persists per customer phone.
- A reminder scheduler that sends day-before reminders (hourly check, per salon
  timezone). Manual trigger: `POST /api/run-reminders?token=<verify_token>`.

## How it routes to a salon

Each salon row has a `wa_phone_number_id`. Inbound messages carry the
`phone_number_id` of the number they were sent to, so the server looks up the
matching salon. For local testing you can map one number to one salon with
`WHATSAPP_DEFAULT_SALON` (it's applied on boot).

---

## Local testing with Meta's free test number

You do NOT need business verification or a paid number to test.

1. **Create the app**: developers.facebook.com → create an app → add the
   "WhatsApp" product. This gives you a **test phone number**, a temporary
   **token**, and a **phone number id** under WhatsApp → API Setup.
2. **Fill `.env`**:
   ```
   WHATSAPP_TOKEN=<temporary token from API Setup>
   WHATSAPP_PHONE_NUMBER_ID=<phone number id>
   WHATSAPP_VERIFY_TOKEN=<make up any string, e.g. salon-verify-123>
   WHATSAPP_APP_SECRET=<App settings → Basic → App secret>   # optional but recommended
   WHATSAPP_DEFAULT_SALON=studio-bella
   ```
3. **Expose your local server** so Meta can reach the webhook:
   ```
   npx cloudflared tunnel --url http://localhost:3000
   # or: ngrok http 3000
   ```
   Copy the public https URL it prints.
4. **Configure the webhook** in the Meta dashboard (WhatsApp → Configuration):
   - Callback URL: `https://<your-tunnel>/webhook`
   - Verify token: the same `WHATSAPP_VERIFY_TOKEN` you set
   - Subscribe to the **messages** field.
   Meta calls `GET /webhook`; you should see it verify successfully.
5. **Add your own phone** as a test recipient (API Setup → add recipient number),
   then message the test number from your phone:
   - "Hola, quiero una cita de uñas de gel" → the assistant replies and books,
     all over real WhatsApp.

### Test the reminder
Book an appointment for **tomorrow**, then trigger a pass:
```
curl -X POST "http://localhost:3000/api/run-reminders?token=<your_verify_token>"
```
(Plain-text reminders only deliver inside the 24h window during testing — that's
fine for a self-test. In production you use an approved template; see below.)

---

## Going to production (when you have a client)

- **Business verification**: required by Meta for higher limits and to message
  customers who haven't opted in recently. Start it early — review takes days.
- **Reminder template**: create and submit a "utility" template (e.g. a cita
  reminder with placeholders for name, service, date, time, salon). Once
  approved, set `WHATSAPP_REMINDER_TEMPLATE` + `WHATSAPP_TEMPLATE_LANG`. The
  scheduler then sends via the template (works outside the 24h window).
- **Permanent token**: replace the temporary token with a System User token.
- **Per-salon numbers**: set each salon's `wa_phone_number_id` (via the DB or a
  future onboarding screen). Routing already supports many salons on one server.

## Security notes

- Set `WHATSAPP_APP_SECRET` so inbound webhooks are signature-verified.
- Keep all tokens in `.env` (gitignored) or the host's env vars — never in code.
