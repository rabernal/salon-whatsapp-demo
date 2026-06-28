// WhatsApp Cloud API client (Meta Graph API).
// Reads config from env; when WHATSAPP_TOKEN is unset it runs in "dry-run" mode
// (logs instead of calling the API) so the rest of the app works without WhatsApp.

const GRAPH_VERSION = process.env.GRAPH_API_VERSION || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export function isWhatsAppConfigured(): boolean {
  return !!process.env.WHATSAPP_TOKEN;
}

async function callGraph(phoneNumberId: string, payload: unknown): Promise<any> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) {
    console.log("[whatsapp:dry-run]", phoneNumberId, JSON.stringify(payload));
    return { dryRun: true };
  }
  try {
    const res = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) console.error("[whatsapp] send error", res.status, JSON.stringify(data));
    return data;
  } catch (err) {
    console.error("[whatsapp] network error", err);
    return { error: String(err) };
  }
}

// Free-form text — only allowed inside the 24h customer-service window
// (i.e. when the customer messaged first). Used for live conversation replies.
export async function sendText(phoneNumberId: string, to: string, body: string): Promise<any> {
  return callGraph(phoneNumberId, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body, preview_url: false },
  });
}

// Pre-approved template — required to message a customer OUTSIDE the 24h window
// (e.g. day-before reminders). `bodyParams` fill the {{1}}, {{2}}… placeholders.
export async function sendTemplate(
  phoneNumberId: string,
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[] = [],
): Promise<any> {
  const components = bodyParams.length
    ? [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }]
    : [];
  return callGraph(phoneNumberId, {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: { name: templateName, language: { code: languageCode }, components },
  });
}
