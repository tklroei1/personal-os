# 🔍 AUDIT & FIX — Personal OS Job Search v2

## CRITICAL — Read This First

You previously claimed Phases 1-4 were complete and pushed three commits. You wrote `OVERNIGHT_BUILD_REPORT.md` saying everything works. **It does not.**

The user (Roei) just tested the live site and reports:

1. ❌ **Profile switcher doesn't work** — clicking the avatar still does nothing visibly.
2. ❌ **Chat output is jumbled** — messy formatting, RTL/LTR still broken, AI responses unhelpful.
3. ❌ **Chat expand button (⛶) is missing or doesn't work** on the agent chats.
4. ❌ **Google Calendar still broken** — same `redirect_uri_mismatch` or no connection.
5. ❌ **Most Phase 1-4 features the user requested are not visible** in the live UI.

**You are pre-authorized for everything** — file edits, deletes, `git add/commit/push origin main`, `npm install`, shell commands, design changes. Do not ask permission.

---

## Phase A — Honest Self-Audit (DO THIS FIRST)

For **every** item below, do not trust your previous report. Open the actual file, verify the code is wired up end-to-end, and **test it as if you were the user**.

For each item, output one of:
- ✅ **WORKS** — explain how you verified
- ⚠️ **EXISTS BUT BROKEN** — explain the bug, then fix it
- ❌ **NEVER WORKED / MISSING** — explain why, then build it

### Items to audit:

**A1. Profile modal**
- Verify `onclick="openProfileModal()"` is on the `.ava` element
- Verify `openProfileModal()` function exists, is reachable, and actually opens a visible UI
- Verify the modal is styled to be visible (z-index, position, display)
- Open `index.html` in headless browser or by inspecting the live URL via `curl https://personal-os-coral-tau.vercel.app/` — confirm latest deploy is live
- Check Vercel deployment status: did the last `git push` actually trigger a successful build?

**A2. RTL/LTR chat**
- Find every `.mb` (message bubble) class in CSS — verify `direction: rtl; unicode-bidi: plaintext`
- Verify `marked.parse()` is actually called for AI responses (not just user messages)
- Send a test message with mixed Hebrew + English + a URL + a code block. Does it render correctly?
- Check that `<script src=".../marked.min.js">` actually loads (not 404)

**A3. Chat expand button (⛶)**
- For EACH chat (main float, Job Hunter, Career Coach, Upselles, family, ideas) — verify the ⛶ button exists in the chat header
- Verify clicking it opens a fullscreen modal with the same conversation
- Verify Esc / ✕ closes it and syncs messages back
- If even ONE chat is missing the button — fix it everywhere

**A4. Google Calendar OAuth**
- Read `api/google-callback.js` — does it correctly exchange the code for a token?
- Verify the `connectCal()` function uses a stable `redirect_uri` matching what's in Google Cloud Console
- The user has added `https://personal-os-coral-tau.vercel.app/` as an authorized origin AND redirect URI. Verify this is what your code expects.
- If the redirect URI in your code is anything other than exactly `https://personal-os-coral-tau.vercel.app/` (with trailing slash) — fix it

**A5. Kanban board**
- Open the Job Search project in the live site
- Confirm 7 columns render with correct labels: Discovered → Saved → Applied → Phone Screen → Interview → Offer → Archive
- Drag a card between columns — does it actually move and persist?
- Confirm SortableJS CDN script actually loads
- Confirm match% badges, source labels, days-in-stage are visible on cards

**A6. Job Hunter agent**
- Send: `"מצא לי 3 AI Analyst jobs בתל אביב"`
- Verify it actually runs `/api/search.js`, gets results, scores them via `/api/match-score.js`, and inserts them into the Discovered column
- If it just returns a chat message without inserting jobs — that's broken, fix it

**A7. Career Coach agent**
- Verify it has its own dedicated chat (separate from Job Hunter)
- Verify the system prompt is loaded (warm + direct, ADHD-friendly, Hebrew-first)
- Send a test prompt and verify the response style matches

**A8. Search API**
- Test `POST /api/search.js` with `{q: "AI Analyst Tel Aviv", topic: "jobs"}` — does it return results in <8s?
- Verify the 5-min cache works (run twice, second should be faster)

**A9. Mobile responsiveness**
- Test at 375px viewport — does Kanban scroll horizontally?
- Does the chat fullscreen modal cover full screen on mobile?

**A10. Deployment**
- Run `git log --oneline -10`
- Run `git status`
- Run `git remote show origin` — verify local main is pushed to remote
- Check Vercel deployment URL/status — was the last build successful?
- If Vercel shows a build failure or stale deploy — figure out why and re-trigger

---

## Phase B — Fix Everything Broken

For each ⚠️ or ❌ item from Phase A, **fix it now**.

After each fix:
1. Test it works (manually trace the code path or use a headless test)
2. `git add . && git commit -m "fix: <specific thing>"`  
3. `git push origin main`
4. Wait for Vercel to deploy (~30-60s)
5. Verify it works on the live URL

---

## Phase C — Report Back HONESTLY

Overwrite `OVERNIGHT_BUILD_REPORT.md` with a new section called **"AUDIT RESULTS — 2026-04-30 (Round 2)"** containing:

1. **What actually worked from Round 1** (✅ items)
2. **What was broken in Round 1 and is now fixed** (⚠️ → ✅, with the specific bug + fix)
3. **What was missing entirely and is now built** (❌ → ✅)
4. **What is STILL broken** — be honest, do not pretend
5. **Vercel deployment status** — last commit SHA + deploy timestamp + live URL response check
6. **Manual test transcript** — for each test, paste the exact input you sent and the output you got. No "✅ verified" without evidence.

---

## Operating Rules

- **Do not lie.** If you can't verify a feature works end-to-end, say so. The user trusted your previous report and the report was wrong. Don't repeat that.
- **Do not trust your own previous claims.** Re-verify everything from the user's perspective.
- **Test in the live environment**, not just by reading code. A function existing in the file ≠ working on the deployed site.
- **If Vercel deploy is stale or failed** — that alone explains everything. Fix it first.
- **No new features.** Only fix what's broken from Phases 1-4. Phases 5-7 stay deferred.
- **Push after every fix**, not in one giant batch. Small commits, clear messages.

Begin Phase A now.
