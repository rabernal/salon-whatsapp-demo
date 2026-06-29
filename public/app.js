const chat = document.getElementById("chat");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const resetBtn = document.getElementById("resetBtn");
const reminderBtn = document.getElementById("reminderBtn");
const suggestionsEl = document.getElementById("suggestions");

let sessionId = "s_" + Math.random().toString(36).slice(2);
let busy = false;

// Which salon (tenant) to talk to — from the path /s/<slug> or ?salon=<slug>.
const pathMatch = location.pathname.match(/^\/s\/([^/]+)/);
const salonSlug = pathMatch
  ? decodeURIComponent(pathMatch[1])
  : (new URLSearchParams(location.search).get("salon") || "");
// Debug-only UI (mode badge, reminder button) shown when ?debug is present.
const debug = new URLSearchParams(location.search).has("debug");
let reminderHinted = false;

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
      body: JSON.stringify({ sessionId, message: text, salon: salonSlug }),
    });
    const data = await res.json();
    await delay;
    hideTyping();
    addBubble(data.reply || data.error || "…", "in");
    if (data.booking && debug) showReminderHint();
  } catch (e) {
    hideTyping();
    addBubble("⚠️ No se pudo conectar con el servidor.", "in");
  } finally {
    busy = false;
    input.focus();
  }
}

async function showReminder() {
  const res = await fetch(
    "/api/reminder?sessionId=" + encodeURIComponent(sessionId) +
    "&salon=" + encodeURIComponent(salonSlug),
  );
  const data = await res.json();
  if (!data.reminder) {
    addBubble("Primero agenda una cita para ver el recordatorio 😉", "in");
    return;
  }
  showTyping();
  setTimeout(() => { hideTyping(); addBubble(data.reminder, "in", { reminder: true }); }, 700);
}

// After a booking, gently point the visitor to the reminder feature (once).
function showReminderHint() {
  if (reminderHinted) return;
  reminderHinted = true;
  setTimeout(() => {
    const n = document.createElement("div");
    n.style.cssText = "align-self:center;background:#fff3cd;color:#7a5d00;font-size:12px;text-align:center;padding:7px 12px;border-radius:8px;max-width:88%;margin:8px 0;";
    n.textContent = "👇 Toca el botón 🔔 para ver el recordatorio automático que recibe la clienta antes de su cita.";
    chat.appendChild(n);
    chat.scrollTop = chat.scrollHeight;
  }, 900);
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

// Small salon switcher (demonstrates multi-tenant). Renders below the chat.
function renderSalonSwitcher(salons, activeSlug) {
  if (!salons || salons.length < 2) return;
  let bar = document.getElementById("salonSwitcher");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "salonSwitcher";
    bar.style.cssText = "display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:8px;font-size:13px;";
    document.querySelector(".hint")?.after(bar);
  }
  bar.innerHTML = "<span style='color:#5b6b73'>Salón:</span> ";
  salons.forEach((s) => {
    const a = document.createElement("a");
    a.textContent = s.name;
    a.href = "?salon=" + encodeURIComponent(s.slug);
    a.style.cssText = "color:#075e54;text-decoration:none;font-weight:" + (s.slug === activeSlug ? "700" : "400");
    bar.appendChild(a);
  });
}

async function init() {
  try {
    const cfg = await (await fetch("/api/config?salon=" + encodeURIComponent(salonSlug))).json();
    if (cfg.brandColor) {
      document.documentElement.style.setProperty("--brand", cfg.brandColor);
      const tc = document.querySelector('meta[name="theme-color"]');
      if (tc) tc.setAttribute("content", cfg.brandColor);
    }
    document.getElementById("salonName").textContent = cfg.salon;
    document.getElementById("avatar").textContent = cfg.salon.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
    const badge = document.getElementById("modeBadge");
    if (debug) {
      badge.textContent = cfg.mode.toUpperCase();
      if (cfg.mode === "live") badge.classList.add("live");
    } else {
      badge.style.display = "none";
    }
    if (!debug) reminderBtn.style.display = "none"; // reminder demo button is debug-only
    renderSuggestions(cfg.suggestions);
    if (debug) renderSalonSwitcher(cfg.salons, cfg.slug);
  } catch { /* ignore */ }
  setTimeout(() => addBubble("¡Hola! 👋 Soy el asistente de citas. ¿En qué te puedo ayudar hoy?", "in"), 400);
}

sendBtn.onclick = () => send(input.value);
input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(input.value); });
reminderBtn.onclick = showReminder;
resetBtn.onclick = async () => {
  await fetch("/api/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, salon: salonSlug }) });
  sessionId = "s_" + Math.random().toString(36).slice(2);
  reminderHinted = false;
  chat.querySelectorAll(".bubble, .typing").forEach((n) => n.remove());
  init();
};

init();
