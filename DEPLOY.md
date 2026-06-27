# Deploying the public demo

Goal: a public URL you can drop into outreach DMs ("try it yourself: …").
The app needs no build step — the host runs `npm install` then `npm start`.

## Before you deploy: choose the mode for the PUBLIC link

For a link that strangers can open, run it in **MOCK mode** (the default when
`ANTHROPIC_API_KEY` is not set):

- Free — no Claude API charges from random visitors or bots.
- Safe — no key exposed, no risk of someone running up usage.
- Still looks great — the same WhatsApp UI and full booking flow.

Keep **LIVE mode** (your key) for the videos you record yourself, where the
natural Spanish reads best. If you do want the public link in LIVE mode, set a
low monthly spend cap in the Anthropic Console first (Billing → Limits).

So for the public demo: **do not set `ANTHROPIC_API_KEY` on the host.** That's it.

> Note on data: the SQLite file lives on the host's disk and resets on each
> redeploy (no volume attached). That's fine — even good — for a demo: it
> re-seeds Studio Bella + El Jefe on every boot.

---

## Option A — Render (free, via GitHub)  ← recommended to start

1. Put this project on GitHub:
   ```bash
   git init && git add -A && git commit -m "salon whatsapp demo"
   # create an empty repo on github.com, then:
   git remote add origin https://github.com/<you>/salon-whatsapp-demo.git
   git push -u origin main
   ```
   (`.env` and `data/` are already gitignored, so no secrets get pushed.)
2. Go to render.com → New → Web Service → connect the repo.
3. Settings:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free
4. Create. In ~2 minutes you get a URL like
   `https://salon-whatsapp-demo.onrender.com`.
5. Share links like:
   - `https://<your-app>.onrender.com/?salon=studio-bella`
   - `https://<your-app>.onrender.com/?salon=el-jefe`

Trade-off: the free tier sleeps after ~15 min idle, so the first hit after a
nap takes 30–60s to wake. Fine for demos; upgrade ($7/mo) to remove it.

## Option B — Railway (no sleep, ~$5/mo, CLI — no GitHub needed)

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```
Then in the Railway dashboard, open the service → Settings → Networking →
Generate Domain to get a public URL. Start command is auto-detected (`npm start`).

## Option C — Fly.io (no sleep, free allowance, CLI)

```bash
# install flyctl, then:
fly launch        # accept Node detection; say no to a database
fly deploy
```
Gives a `https://<app>.fly.dev` URL.

---

## After deploying — quick checks

- Open the URL; you should see the WhatsApp UI with a **MOCK** badge.
- Run through a booking and click the 🔔 reminder button.
- Try `?salon=el-jefe` to confirm the second salon loads.

## Troubleshooting

- **Build fails on `better-sqlite3`:** ensure the host uses Node 20+ (set in
  `engines`). Render/Railway/Fly include the build tools it needs.
- **"tsx: not found":** `tsx` is a production dependency now, so `npm install`
  installs it. Re-deploy if you deployed before this change.
- **App crashes on boot:** check the host logs; most often a Node version < 20.
