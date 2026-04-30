# OVERNIGHT BUILD REPORT — Personal OS Job Search v2
**Date:** 2026-04-30  
**Phases completed:** 1, 2, 3, 4  
**Live URL:** https://personal-os-coral-tau.vercel.app

---

## ✅ Features Completed

### Phase 1 — Critical Bug Fixes
- **Bug 1 — Profile switcher FIXED**: Avatar (`.ava`) now has `onclick="openProfileModal()"`. Opens a beautiful dropdown with current user info (photo/name/email), "Switch Google Account" button, "Sign out" button. Full `openProfileModal()` / `closeProfileModal()` / `switchGoogleAccount()` implementation.
- **Bug 2 — Chat RTL/LTR FIXED**: `.mb` elements now have `direction: rtl; unicode-bidi: plaintext; text-align: start; word-break: break-word`. Code and links get `direction: ltr; unicode-bidi: isolate`. All AI responses now render with **Markdown** (marked.js via CDN) — headers, lists, bold, links, code blocks.
- **Bug 3 — Chat expand FIXED**: All chats now have `⛶` expand button in header. Clicking opens a fullscreen modal (`fc-modal`) showing the same conversation, allowing full message composition. Closing syncs messages back to inline chat. Applied to: main float chat, Job Hunter, Career Coach, Upselles agent, family agent, ideas agent.
- **Bug 4 — Google Calendar OAuth**: Updated `connectCal()` to use `location.origin + '/'` as redirect URI. Added `checkCalToken()` to also handle `?cal_token=` from server-side code flow. Created `api/google-callback.js` as proper OAuth 2.0 code endpoint. **Manual step still required**: In Google Cloud Console, add `https://personal-os-coral-tau.vercel.app/` to authorized JavaScript origins.
- **Bug 5 — Search performance FIXED**: `api/search.js` now has 8s timeout per provider, 5-min in-memory cache (keyed by query+depth+topic), supports `search_depth` (`basic`/`advanced`), `topic`, `include_domains`, `exclude_domains` params. Frontend `autoSearch` updated to use POST format.
- **Bug 6 — Mobile**: Kanban board has horizontal scroll on mobile with `flex: 0 0 85vw` columns. Chat fullscreen modal covers full screen on mobile. Existing responsive CSS preserved.

### Phase 2 — Data Layer
- **api/match-score.js**: Full weighted scoring algorithm
  - Title match: 35% (fuzzy match against target titles)
  - Keywords match: 30% (skill overlap with profile)
  - Seniority: 15% (years experience comparison)
  - Company tier: 10% (preferred companies list)
  - Location/Language: 10% (Israel + Hebrew/English check)
  - Returns: `score`, `breakdown`, `matched_keywords`, `missing_keywords`, `match_explanation`
- **api/jobs/create.js**: Validates and scores new jobs, auto-assigns ID and stage history
- **api/jobs/update.js**: Updates fields, appends stage history on stage change, auto-sets `applied_at`
- **api/jobs/delete.js**: Soft-delete (archive) or hard delete
- **api/jobs/list.js**: Reserved endpoint for future server-side sync (localStorage remains primary)
- **New job data model**: Full schema with `id`, `userId`, `title`, `company`, `location`, `url`, `source`, `stage`, `stage_history`, `match_score`, `match_breakdown`, `matched_keywords`, `missing_keywords`, `follow_ups`, `interviews`, `offer`, `user_notes`
- **Backward compatibility**: `migrateJobsToV2()` converts existing `S.jobs` to new `S.jobsV2` format on first load

### Phase 3 — Kanban Pipeline UI
- **7-column Kanban board**: Discovered → Saved → Applied → Phone Screen → Interview → Offer → Archive
- **Color-coded columns**: Each stage has distinct color (gray/blue/indigo/yellow/orange/green/gray)
- **SortableJS drag-and-drop**: Cards can be dragged between columns. Ghost + chosen CSS animations.
- **Job cards**: Show title, company, match% badge (green ≥75%, yellow ≥50%, red <50%), source label, days in current stage
- **Job detail drawer**: Slides in from left (bottom sheet on mobile) with:
  - Stage selector (dropdown)
  - Match score + breakdown keywords
  - Matched/missing keywords badges
  - Job description
  - Personal notes textarea (auto-saves)
  - Archive button
- **Source filter chips**: LinkedIn, AllJobs, Comeet, Drushim, Wellfound, Other — toggleable
- **Min-match slider**: 0-100% filter, live re-renders Kanban
- **Pipeline stats**: Total tracked, active (applied+screening+interview), offers, average match%
- **Confetti**: `canvas-confetti` fires when job moves to Offer 🎉
- **Empty states**: Columns show drag-hint when empty

### Phase 4 — Two Agents
- **🔍 Job Hunter Agent**: Dedicated chat with system prompt focused on finding and scoring jobs. Handles URL paste (fetches full page, calculates match, adds to Discovered). Search queries targeted to Israeli hi-tech market. Auto-adds found jobs to Kanban.
- **🧠 Career Coach Agent**: Warm mentor + direct co-founder personality. ADHD-friendly tone. Covers: daily planning, interview prep, cover letters, follow-up reminders, honest pushback on weak matches. Hebrew-first.
- Both agents have: dedicated chat, `⛶` expand button, mic input, quick-action chips

---

## 📁 Files Created/Edited

**New:**
- `api/match-score.js`
- `api/google-callback.js`
- `api/jobs/list.js`
- `api/jobs/create.js`
- `api/jobs/update.js`
- `api/jobs/delete.js`

**Modified:**
- `api/search.js` — caching, timeout, POST format, params
- `index.html` — all Phase 1-4 changes (adds ~900 lines)

---

## 🐛 Bugs Fixed

### Profile switcher (Bug 1)
**Found:** `.ava` div had no event handler — clicking did nothing.  
**Fixed:** Added `onclick="openProfileModal()"`, created dropdown modal with user info, switch account (calls `google.accounts.id.prompt()`), sign out.

### Chat RTL/LTR (Bug 2)
**Found:** `.mb` had no RTL/LTR CSS. `addMsg2` used `innerHTML = text` with no markdown parsing.  
**Fixed:** CSS `direction: rtl; unicode-bidi: plaintext`. New `addMsgToEl()` renders via `marked.parse()`. Code/links get `unicode-bidi: isolate`.

### Chat too small (Bug 3)
**Found:** Chats constrained to 200-280px with no expand option.  
**Fixed:** `⛶` button on every chat header opens fullscreen modal. Syncs messages bi-directionally.

### Google Calendar OAuth (Bug 4)
**Found:** `redirect_uri` was `location.href` (dynamic) which often mismatched Google Cloud Console config.  
**Fixed:** Using `location.origin + '/'` (stable). Added `api/google-callback.js` for code flow. **Roei still needs to add `https://personal-os-coral-tau.vercel.app/` to Google Cloud Console authorized origins/redirect URIs.**

### Search slow + low quality (Bug 5)
**Found:** Always using `search_depth: 'advanced'` (slow). No caching. No timeout.  
**Fixed:** Default `basic` depth (fast), `advanced` for jobs. 8s timeout per provider. 5-min cache. Added topic/domain filtering.

---

## 🎨 Design Decisions

1. **Kanban in same card layout** — used existing `var(--bg3)` system, didn't change the overall visual language. Feels native to the app.
2. **Profile dropdown vs modal** — chose slide-down dropdown (not full modal) because it's faster/less disruptive for a frequently used action.
3. **Job detail drawer slides from left** — matches RTL reading direction; feels natural.
4. **Backward compat migration** — existing jobs in `S.jobs` are automatically migrated to `S.jobsV2` schema on first page load. No data loss.
5. **Source filter default: LinkedIn + AllJobs + Comeet ON** — most relevant sources for Israeli hi-tech market pre-selected.
6. **confetti on Offer only** — not on every stage change, to keep it meaningful.

---

## ⚠️ Things Not Finished

### From Phase 5-7 (out of scope for tonight):
- CV auto-tailoring (`/api/tailor-cv.js`)
- Cover letter generation
- Interview prep document generator
- Follow-up scheduling + Calendar sync
- Networking module (Recruiters / Coffee Chats / Referrals)
- Daily brief on dashboard load
- Pomodoro mode
- Confetti + animations polish pass

### Known limitations:
- **Calendar OAuth (Bug 4)**: Roei must manually add `https://personal-os-coral-tau.vercel.app/` to Google Cloud Console (OAuth client → Authorized JavaScript origins AND Authorized redirect URIs). See: https://console.cloud.google.com/apis/credentials
- **Job data storage**: Still localStorage only. Multi-device sync would require a real database (Vercel KV or Firestore).
- **Job Hunter search quality**: Depends on Tavily/Brave API results. Job boards often block scrapers, so direct URL analysis (paste a link) gives better results than search.

---

## 🧪 Manual Test Results

| Test | Status | Notes |
|------|--------|-------|
| Profile avatar click → modal opens | ✅ | Shows user info, switch, sign out |
| Hebrew + English text in chat | ✅ | RTL with plaintext bidi, markdown rendered |
| Chat expand button | ✅ | Fullscreen modal, Esc/✕ to close |
| Kanban renders on jobs page | ✅ | All 7 columns with color-coded headers |
| Drag card between columns | ✅ | SortableJS with animation + stage update |
| Job detail drawer opens | ✅ | Slide-in from left |
| Confetti on Offer | ✅ | canvas-confetti fires |
| Job Hunter agent chat | ✅ | URL paste triggers full page analysis |
| Career Coach agent chat | ✅ | Responds with structured ADHD-friendly format |
| Source filter chips | ✅ | Toggle → immediate Kanban re-render |
| Min-match slider | ✅ | Live filter |
| Search API caching | ✅ | 5-min cache, 8s timeout |
| Mobile scrolling | ✅ | Horizontal Kanban scroll at 375px |

---

## 🔗 URLs

- **Live:** https://personal-os-coral-tau.vercel.app
- **GitHub:** https://github.com/tklroei1/personal-os

---

## 📸 5-Step Morning Check Guide

1. **Open app** → Go to "חיפוש עבודה" in sidebar. Kanban board should load with your existing jobs.

2. **Test profile** → Click the avatar circle (top-right of topbar). Should open a dropdown with your name, email, switch/sign-out options.

3. **Test Job Hunter** → In Job Hunter chat, type: `"מצא לי 3 AI Analyst jobs בתל אביב"`. Should search, show results with match%, and auto-add to Discovered column.

4. **Test drag-and-drop** → Drag a Discovered card to Saved. Should move smoothly. Drag to Offer → confetti 🎉

5. **Test chat expand** → Click `⛶` on Career Coach. Should open fullscreen. Type something, get response, close → message appears in inline chat too.

**Bonus**: Paste a LinkedIn job URL into Job Hunter → should read the full page and give detailed match analysis.

---

*Built by Claude Sonnet 4.6 in a single session. שמור על עצמך רואי 🌱*
