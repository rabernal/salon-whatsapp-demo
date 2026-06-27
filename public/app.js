const chat = document.getElementById("chat");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const resetBtn = document.getElementById("resetBtn");
const reminderBtn = document.getElementById("reminderBtn");
const suggestionsEl = document.getElementById("suggestions");

let sessionId = "s_" + Math.random().toString(36).slice(2);
let busy = false;

function now() {
  const d = new Date();
  return d.getHours() + ":" + d.getMinutes().toString().padStart(2, "0");
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Render *bold* (WhatsApp style) and newlines.
function format(text) {
  return escapeHtml(text).replace(/\*([^*]+)\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
}

function addBubble(text, dir, opts = {}) {
  const b = document.createElement("div");
  b.className = "bubble " + dir + (opts.reminder ? " reminder" : "");
  const tick = dir === "out" ? ' <span class="tick">✓✓</span>' : "";
  b.innerHTML = `${format(text)}<span class="meta">${now()}${tick}</span>`;
  chat.appendChild(b);
  chat.scrollTop = chat.scrollHeight;
  return b;
}

function showTyping() {
  const t = document.createElement("div");
  t.className = "typing";
  t.id = "typing";
  t.innerHTML = "<span></span><span></span><span></span>";
  chat.appendChild(t);
  chat.scrollTop = chat.scrollHeight;
}
function hideTyping() {
  document.getElementById("typing")?.remove();
}

async function send(text) {
  if (busy || !text.trim()) return;
  busy = true;
  addBubble(text, "out");
  input.value = "";
  suggestionsEl.innerHTML = "";
  showTyping();

  const delay = new Promise((r) => setTimeout(r, 650)); // human-like pause
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text }),
    });
    const data = await res.json();
    await delay;
    hideTyping();
    addBubble(data.reply || data.error || "…", "in");
  } catch (e) {
    hideTyping();
    addBubble("⚠️ No se pudo conectar con el servidor.", "in");
  } finally {
    busy = false;
    input.focus();
  }
}

async function showReminder() {
  const res = await fetch("/api/reminder?sessionId=" + encodeURIComponent(sessionId));
  const data = await res.json();
  if (!data.reminder) {
    addBubble("Primero agenda una cita para ver el recordatorio 😉", "in");
    return;
  }
  showTyping();
  setTimeout(() => { hideTyping(); addBubble(data.reminder, "in", { reminder: true }); }, 700);
}

function renderSuggestions(list) {
  suggestionsEl.innerHTML = "";
  (list || []).forEach((s) => {
    const btn = document.createElement("button");
    btn.textContent = s;
    btn.onclick = () => send(s);
    suggestionsEl.appendChild(btn);
  });
}

async function init() {
  try {
    const cfg = await (await fetch("/api/config")).json();
    document.getElementById("salonName").textContent = cfg.salon;
    document.getElementById("avatar").textContent = cfg.salon.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const badge = document.getElementById("modeBadge");
    badge.textContent = cfg.mode.toUpperCase();
    if (cfg.mode === "live") badge.classList.add("live");
    renderSuggestions(cfg.suggestions);
  } catch { /* ignore */ }
  setTimeout(() => addBubble("¡Hola! 👋 Soy el asistente de citas. ¿En qué te puedo ayudar hoy?", "in"), 400);
}

sendBtn.onclick = () => send(input.value);
input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(input.value); });
reminderBtn.onclick = showReminder;
resetBtn.onclick = async () => {
  await fetch("/api/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
  sessionId = "s_" + Math.random().toString(36).slice(2);
  chat.querySelectorAll(".bubble, .typing").forEach((n) => n.remove());
  init();
};

init();
