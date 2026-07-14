# Personal OS — Setup Guide

## Required Vercel Environment Variables

Set these in the Vercel dashboard → Project → Settings → Environment Variables.

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | ✅ Yes | Claude API key from console.anthropic.com |
| `TAVILY_API_KEY` | ✅ Recommended | Web search (primary). Get at app.tavily.com |
| `BRAVE_API_KEY` | Optional | Brave Search fallback. Get at api.search.brave.com |
| `GOOGLE_CLIENT_ID` | Already set | Google OAuth client ID (already in code) |
| `GOOGLE_CLIENT_SECRET` | For server flow | Only needed if using `/api/google-callback` code flow |
| `TWILIO_SID` | For WhatsApp | Twilio Account SID from console.twilio.com |
| `TWILIO_TOKEN` | For WhatsApp | Twilio Auth Token |
| `TWILIO_FROM` | For WhatsApp | Your Twilio sandbox number, e.g. `whatsapp:+14155238886` |
| `ELEVENLABS_API_KEY` | For premium TTS | Optional, ElevenLabs voice quality |
| `CRON_SECRET` | For job-hunt cron | Any random string — used to authorize cron endpoint |

---

## Google Cloud Console — OAuth Setup

1. Go to https://console.cloud.google.com/apis/credentials
2. Click your OAuth 2.0 Client → Edit
3. Under **Authorized JavaScript origins**, add:
   ```
   https://personal-os-coral-tau.vercel.app
   ```
4. Under **Authorized redirect URIs**, add:
   ```
   https://personal-os-coral-tau.vercel.app
   https://personal-os-coral-tau.vercel.app/api/google-callback
   ```
5. Save and wait ~5 minutes for changes to propagate.

**OAuth Scopes enabled:**
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/gmail.send`

---

## WhatsApp via Twilio — Setup

See [whatsapp-setup.md](./whatsapp-setup.md) for full instructions.

Quick start:
1. Create Twilio account at twilio.com
2. Enable WhatsApp Sandbox in Messaging → Try it Out → Send a WhatsApp message
3. Sandbox number: `+14155238886` (or your dedicated number)
4. Set env vars: `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`

---

## Job Hunt — the daily schedule (single source of truth)

All Israel local time (Asia/Jerusalem).

| Time (Israel) | What runs | Where | Notes |
|---|---|---|---|
| **07:30** | Job scan #1 (Apify LinkedIn + Greenhouse/Lever/Comeet) | Railway bot — `whatsapp-bot/job-hunt-agent.js` | Scores against the profile, tailors the CV for ≥70 matches, uploads via webhook |
| **08:00** | Daily briefing + push ("התור היומי שלך מוכן") | Vercel cron — `api/cron/job-hunt.js` | The handler **gates on `israelHour === 8`** and silently skips at any other hour |
| **13:00** | Job scan #2 | Railway bot | Same pipeline as the morning scan |

### Vercel cron wiring
`vercel.json` fires the endpoint at **05:00 and 06:00 UTC**:

```json
"crons": [
  { "path": "/api/cron/job-hunt", "schedule": "0 5 * * *" },
  { "path": "/api/cron/job-hunt", "schedule": "0 6 * * *" }
]
```

Two entries because Vercel crons are UTC-only and Israel switches between UTC+3 (IDT, summer) and UTC+2 (IST, winter). One of them always lands on 08:00 Israel; the other hits the `israelHour !== 8` guard in `api/cron/job-hunt.js` and returns `{skipped:...}` without doing any work. **Do not "fix" the duplicate — it is the DST guard.**

Manual trigger (requires the `Authorization: Bearer <CRON_SECRET>` header):

```
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
     https://personal-os-coral-tau.vercel.app/api/cron/job-hunt
```

Requires `TAVILY_API_KEY` and `CRON_SECRET` env vars.

### Railway bot schedule
The 07:30 / 13:00 scans are scheduled inside the Railway worker (`whatsapp-bot/`). "חפש משרות" over WhatsApp triggers the same scan on demand.

---

## Job list cloud sync (KV) — `fn=jobs_get` / `fn=jobs_put`

`S.jobsV2` is mirrored to Upstash / Vercel KV so the pipeline survives a device change.

- Routes: `/api/jobs-get` → `api/ai.js?fn=jobs_get`, `/api/jobs-put` → `api/ai.js?fn=jobs_put` (no new serverless function — Hobby is capped at 12).
- Key: `pos_jobs_{userId}` (userId = the Google `sub`, same source as backup/restore; `anon` when signed out).
- Client: pulls on boot, pushes debounced 5s from `save()`. localStorage stays the cache / instant-read source of truth.
- Env vars: `KV_REST_API_URL` + `KV_REST_API_TOKEN` (also accepts `UPSTASH_REDIS_REST_*` / `STORAGE_KV_REST_API_*`).
- **Without KV env vars** the endpoints return `{ok:false, reason:'no_kv'}` and the client silently ignores it — the app works exactly as before, fully local.

---

## PWA Share Target

To share links from mobile browser to Personal OS:
1. Install the app as PWA (Add to Home Screen)
2. Open any webpage → Share → Personal OS
3. The URL/title lands in Inbox page automatically

---

## Facebook Apartment Bookmarklet

Add to browser bookmarks bar and click while viewing a Facebook listing:

```javascript
javascript:(function(){
  window.open('https://personal-os-coral-tau.vercel.app/?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title));
})();
```

---

## Error Log (Admin)

View the last 50 client-side errors:
```
https://personal-os-coral-tau.vercel.app/api/log-error?user=tklroei1@gmail.com
```
