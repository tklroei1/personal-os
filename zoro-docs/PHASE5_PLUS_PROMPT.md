# Personal OS — Phases 5-10 (Comprehensive Build)

You are pre-authorized for ALL operations: file edits, git add/commit/push origin main, npm install, shell commands, new API keys placeholder. Do NOT ask permission. After each phase: commit + push + continue. Do not stop between phases.

**Token budget:** Keep edits minimal-diff. Avoid rewriting whole files when an edit suffices. Reuse existing CSS variables and patterns. Do not add comments to explain every line.

---

## PHASE 5 — User & Profile Hardening

**5.1 Garbled name bug.** In screenshots, user's display name renders as `□×□×§×` boxes (not actual Hebrew). Likely the field is set from `name.split('').reverse()` or similar; or font-family on that element lacks Hebrew. Find every place the user name is rendered (topbar, sidebar bottom card, profile modal). Ensure: (a) the raw string from `google.accounts.id` `JWT.name` is used as-is, (b) the element font-family inherits `Heebo, system-ui` (NOT a code/icon font), (c) no `.split('').reverse()` is applied.

**5.2 Real signup flow.** When a user signs in for the first time, show a one-screen profile setup modal:
- Full name (prefilled from Google)
- Role / job title
- Location (city)
- LinkedIn URL
- Personal website / portfolio
- Goals (multi-select: Job Search, Side Projects, Fitness, Apartment, Family, Finance, Notes)
- Languages (Hebrew/English/etc.)
- Short bio (textarea, optional)

Save to `S.userProfile = {...}`. Show "Edit Profile" button inside the avatar dropdown that re-opens this modal.

**5.3 Each new user starts blank.** Currently `S.projects` is hardcoded with Roei's 5 projects. Refactor:
- Move Roei's 5 projects to a `STARTER_TEMPLATES` constant (with seed tasks/habits).
- New users: empty `S.projects = []`. Show a welcome screen with "Choose templates to start" — checkboxes for: Job Search, Fitness, Apartment, Family, Finance, Notes. Selected templates are cloned into their `S.projects`.
- Existing user (Roei, identified by email `tklroei1@gmail.com`): if `S.projects` exists, leave alone.

**5.4 Add/delete projects UI.** Add "+ Project" button on dashboard. Opens modal: name, color, emoji, optional template. Each project card has a `⋯` menu → Edit, Archive, Delete. Confirm before delete.

**5.5 Update Roei's existing projects:**
- Upselles project: add fields `links: [{label:'Live', url:'https://upselles.app'}, {label:'Base44', url:'<get url from S.projects.upselles or leave placeholder for Roei to fill>'}]`. Render as clickable chips on the project page.
- Add a global profile field `linkedin: 'https://www.linkedin.com/in/roei-klein'` and surface it on Roei's profile card.

**5.6 Calendar OAuth final fix.** The current redirect_uri is `${location.origin}/` → `https://personal-os-coral-tau.vercel.app/`. User reports `redirect_uri_mismatch`. Two possible fixes — try in order:
1. Switch to NO trailing slash: `${location.origin}` (no `+'/'`). Test.
2. If still failing, inspect Google error URL — the `redirect_uri` URL-encoded in Google's error page must match Cloud Console exactly. Whichever variant Google's error message shows is what's being sent. Document which variant the user must paste into Google Cloud Console.

Also: write a Calendar setup helper inside the app — if `gat` token is null, show inline instructions "Add `<exact-url>` to Google Cloud Console → Authorized redirect URIs", with a copy button for the URL.

**Commit:** `Phase 5: profile signup, project templates, name fix, Calendar UX`

---

## PHASE 6 — New Projects: Finance & Notes

**6.1 Finance project (template).** Add to `STARTER_TEMPLATES`:
- Schema: `{id, ts, type:'expense'|'income', amount, currency:'ILS', merchant, category, location, rating(1-10), enjoyment(1-10, optional), note}`
- Quick-add bar: amount + merchant + (category auto-detected by Claude API, can be overridden) + auto-timestamp.
- Categories (default): Food, Coffee, Groceries, Restaurants, Transport, Subscriptions, Shopping, Health, Entertainment, Bills, Income, Other.
- Views: by day, by week, by month. Charts: pie by category, bar by day.
- Insights tab: Claude-powered weekly summary ("You spent ₪X on coffee — 18% above average. Consider..."). Triggered by button, cached for 24h.
- Mobile: floating "+" button → quick capture (amount input opens numeric keypad).
- Inspiration to mirror feature-wise (without copying): YNAB, Spendee, MoneyView. Pick 2-3 best ideas (recurring detection, savings goals, "if you cut X you'd save Y/month").

**6.2 Notes project (tool, not project).** Add to sidebar under "כלים" alongside ideas/journal:
- iPhone Notes-style: list of notes, each with title (auto from first line), preview, edited timestamp.
- Click → fullscreen editor. Markdown-supported via marked.js.
- Pin to top, search, tags, color labels.
- Mobile: swipe-left to delete.

**Commit:** `Phase 6: Finance project + Notes tool`

---

## PHASE 7 — Project Enhancements

**7.1 Apartment project upgrade:**
- Each apartment card: thumbnail (first image from URL preview), title, price, neighborhood, link icon → opens listing in new tab.
- Photo gallery section: paste URL or drag images.
- Agent acts as broker: when user adds an apartment, automatically (or on-demand button) shows: walking distance to nearest beach (km), nearest train/light-rail station, nearest grocery, average rent in neighborhood. Use Tavily search via existing `/api/search.js` with focused queries; cache per-apartment for 7 days.
- "Compare" button: select 2-3 apartments → side-by-side table (price, size, distance, rating).

**7.2 Nutrition project upgrade:**
- Menu upload: file input accepts .docx/.pdf/.txt/image. Send to Claude API (vision-enabled) with prompt: "Extract structured meal plan: meals × days × items × macros". Return JSON. Save as `S.projects.fitness.menu`.
- Render as interactive checklist: each meal × day → checkbox. Checked → adds to today's calorie/macro counter. Daily resets at midnight (Israel time).
- Recipe upload: file input. Claude extracts {name, ingredients[], steps[], calories, macros}. Save to `S.projects.fitness.cookbook[]`.
- Cookbook tab: searchable list of saved recipes.
- Agent power: "find recipes matching my macros today" → searches both internal cookbook AND web (Tavily), with toggle.

**7.3 Job Search & Apartment auto-run mode:**
- Add "Auto-Run" toggle per project (job search, apartment search).
- Settings: frequency (daily/weekly), filters (titles, locations, sources), N results to return.
- Implementation: `/api/cron/job-hunt.js` — scheduled via Vercel Cron (`vercel.json` crons). Uses existing search + match-score, inserts top N into Discovered column. Stores last-run-timestamp.
- For Facebook: real auto-scraping is blocked. Instead provide:
  - (a) Saved-search URLs the user opens manually with one click.
  - (b) Browser bookmarklet that, when clicked while on a Facebook group/listing, sends the page HTML to `/api/fetch-page.js` and adds it to the project. Document this in a `docs/bookmarklet.md`.
  - (c) Optional Apify integration — leave a stub `/api/apify-scrape.js` that reads `APIFY_TOKEN` from env. If unset, return helpful message.

**Commit:** `Phase 7: Apartment broker info, Nutrition menu/cookbook, Auto-run mode`

---

## PHASE 8 — Integrations

**8.1 Email send via Gmail API.**
- Extend Google OAuth scope to include `https://www.googleapis.com/auth/gmail.send`.
- Add UI: any project with a "leads" or "contacts" section gets a "Send Email" button per contact. Opens compose modal: To, Subject, Body (markdown supported, rendered as HTML on send), AI-draft button (Claude generates a draft based on context).
- API: `/api/email/send.js` — uses Gmail REST API with the user's stored access token.
- Sent emails log: store `{ts, to, subject, snippet, project, threadId}` in `S.emailLog`.

**8.2 WhatsApp integration (Twilio Sandbox MVP).**
- API: `/api/whatsapp/send.js` — reads `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` from env. POST `{to, body}`.
- UI: same as email — "Send WhatsApp" button on contact cards.
- Document setup in `docs/whatsapp-setup.md`: how to register Twilio sandbox, get sandbox number, env vars to set in Vercel.

**8.3 Share Target API (PWA).**
- Add to `manifest.json`:
```json
"share_target": {
  "action": "/share",
  "method": "GET",
  "params": {"title":"title","text":"text","url":"url"}
}
```
- Handle `?share=1&title=...&text=...&url=...` in app entry. Auto-route to a new `S.inbox` array.
- Inbox page (sidebar item under "כלים"): list of shared items. Each item has buttons: Send to Apartment, Send to Job Search, Send to Notes, Delete.
- Selected destination → AI parses the shared content and creates appropriate record (job/apartment/note).

**Commit:** `Phase 8: Gmail send, Twilio WhatsApp, PWA share target inbox`

---

## PHASE 9 — Live Voice Chat

**9.1 Continuous voice mode** for every agent chat:
- Add `🎙️ Live` toggle in chat header (next to ⊞ expand).
- When ON:
  1. Start `webkitSpeechRecognition` with `continuous=true`, `interimResults=true`, `lang='he-IL'` (auto-switch to `en-US` if interim text contains mostly Latin chars).
  2. On `result` event, when `isFinal=true` and silence detected for 1.2s — auto-send to Claude.
  3. Stream Claude response (use `stream:true` if `/api/claude.js` supports it; otherwise add streaming).
  4. As tokens arrive, speak via `window.speechSynthesis` (Hebrew voice if `voice.lang.startsWith('he')`, else English voice). Set rate=1.05.
  5. While speaking, pause recognition. Resume after speech ends.
- Stop toggle: cleanly cancels recognition, synthesis, and pending stream.
- Visual: pulsing mic icon while listening; soundwave bars while AI speaks; user message bubbles render in real-time as interim text.

**9.2 Optional ElevenLabs upgrade** (if `ELEVENLABS_API_KEY` is set in env):
- `/api/tts.js` — POST `{text, voice}` → audio stream. Frontend plays via Audio element.
- Quality toggle in profile: "Browser TTS" (default, free) | "Premium TTS" (ElevenLabs, requires key).

**Commit:** `Phase 9: Live voice chat with continuous recognition + TTS`

---

## PHASE 10 — Final Polish & Performance

**10.1 Agent speed.**
- Confirm `/api/claude.js` uses Sonnet 4.6 (current). For chat replies <200 tokens, switch to Haiku 4.5 by default; explicit "deep think" toggle uses Sonnet.
- Enable streaming end-to-end (SSE) — frontend renders tokens as they arrive.
- Pre-warm common requests via Vercel edge cache where possible.

**10.2 Mobile pass.**
- All modals: bottom sheet on mobile.
- Bottom nav (4-5 tabs) for top-level navigation on screens <768px.
- Topbar: collapse to logo + avatar + chat-toggle on mobile.

**10.3 Error tracking.**
- Add Sentry-lite: catch all `window.onerror` and `unhandledrejection`, post to `/api/log-error.js` which appends to a Vercel KV list (or in-memory if KV not set). Show last 50 errors at `/admin/errors` (only for Roei email).

**Commit:** `Phase 10: Speed, mobile polish, error tracking`

---

## After all phases:

1. Update `OVERNIGHT_BUILD_REPORT.md` adding "Phase 5-10 results" section: what shipped, what didn't, what requires manual user action (env vars, Google scopes, Twilio setup).
2. Create `docs/SETUP.md` listing every env var and external account needed, with links to where to get them.
3. Final `git push origin main`.

## Operating rules

- Test each feature in the deployed environment, not just by reading code.
- Honest reporting only. If a feature isn't fully working, mark `⚠️` and explain what's missing.
- For features blocked on external user action (env keys, Google Cloud Console settings, Twilio sandbox approval), build the feature anyway and clearly surface "Configuration needed: <X>" in the UI.
- Phases 5 → 10 in order. Within a phase, parallelize where safe.
- Commit per logical unit (not per file). Push after each commit.
- If you hit a rate limit or credit issue, wait, retry, continue. Do not stop.

Begin Phase 5 now.
