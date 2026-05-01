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

## Auto Job Search — `/api/cron/job-hunt`

The endpoint exists, but **Vercel Hobby plan does NOT support cron jobs**, so the schedule was removed from `vercel.json`. To run it daily:

**Option A — Upgrade to Vercel Pro** (~$20/mo) and re-add to `vercel.json`:
```json
"crons": [
  { "path": "/api/cron/job-hunt", "schedule": "0 6 * * *" }
]
```

**Option B — External scheduler (free)**: use cron-job.org or GitHub Actions to ping the endpoint daily. The endpoint requires the `Authorization: Bearer <CRON_SECRET>` header to authorize.

```
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
     https://personal-os-coral-tau.vercel.app/api/cron/job-hunt
```

Requires `TAVILY_API_KEY` and `CRON_SECRET` env vars.

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
