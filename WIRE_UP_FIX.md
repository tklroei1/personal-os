# WIRE-UP FIX — Round 4 (deploy + UI wiring)

**CRITICAL — NEW INFO:** Vercel deployment is FAILING. The latest commit `c326b7f` did NOT deploy successfully — Vercel sent a "Failed production deployment" email and the deployment overview shows a red error icon with 2 warnings/errors after the API files compile (after `Build Completed in /vercel/output [2s]`). That is why none of the Phase 5-10 features appear in the live site — the live site is still serving an OLDER successful build.

You are pre-authorized for ALL operations: file edits, git add/commit/push origin main, npm install, vercel CLI. Do NOT ask permission. Commit + push after each fix.

---

## STEP 0 — Diagnose & fix the failed deploy (DO THIS FIRST)

1. Run `vercel logs --prod` or `vercel inspect <latest-deployment-url> --logs` to fetch the latest deployment build log. The error is AFTER `Build Completed in /vercel/output [2s]`, likely during the deployment phase. Possible causes:
   - **Hobby tier limit: max 12 serverless functions.** Count `find api -name '*.js' | wc -l`. Phase 5-10 added several new APIs — likely over the limit.
   - **Hobby tier limit: only 1 cron job (or 0 daily crons).** If `vercel.json` added cron entries in Phase 7, this will fail.
   - Missing dependency in `package.json` for one of the new API files.
   - Invalid `vercel.json` syntax.
   - Module-load-time crash in `api/cron/job-hunt.js` from missing env vars.
   - Missing exports / syntax error in one of the new files.

2. **Fix Hobby plan over-limits by consolidating:**
   - Merge `api/email/send.js` + `api/whatsapp/send.js` → single `api/messages/send.js` routing by `?channel=email|whatsapp`.
   - Merge `api/projects/create.js` + `delete.js` + `list.js` + `update.js` → single `api/projects.js` routing by `?action=create|delete|list|update`.
   - If `vercel.json` has crons, REMOVE the crons block (paid feature on Hobby) and document in `docs/SETUP.md` that auto-run requires Pro plan or external scheduler (cron-job.org pinging the API).
   - Re-count: `find api -name '*.js' | wc -l` must be ≤ 12.

3. Push and verify: 
   - `curl -I https://personal-os-coral-tau.vercel.app` returns `HTTP/2 200`
   - `x-vercel-id` shows a recent deploy ID
   - Vercel dashboard `https://vercel.com/tklroei1s-projects/personal-os/deployments` shows latest deploy is GREEN ✓ (not the red ! icon Roei sees now)

**Do not proceed to Step 1 until the deploy is green.** Without a green deploy, nothing else matters.

---

## STEP 1 — Sidebar wiring

Open `index.html` and find where the sidebar HTML is rendered (search for "פרויקטים", "כלים", existing items like `רעיונות`, `יומן`, `מטרות`). Add new entries:
- Under "פרויקטים": "💰 כספים" → `goPage('finance')`
- Under "כלים": "📝 פתקים" → `goPage('notes')`, "📥 Inbox" → `goPage('inbox')`
- Add a "+ פרויקט" button at the top of the projects section → `openNewProjectModal()`

Verify each click actually navigates and renders the page. If `goPage('finance')` doesn't render anything, find the corresponding `renderFinance()` / `FinancePage` function and ensure it's called from the page router.

---

## STEP 2 — Hebrew name garbled (`□×□×§×`)

User confirmed in incognito the topbar avatar shows `□×□×§×` instead of "רואי קליין". Find every `<div class="ava">` and the username display in:
- topbar (next to "Personal OS")
- bottom-left card (above email)
- profile dropdown header

The displayed value is corrupted Hebrew. Likely cause:
- (a) Reading from a wrong field (e.g. `S.userProfile.name` is empty so falling back to `S.userProfile.id.split` or similar mangled value)
- (b) Font on that element doesn't include Hebrew — fix by ensuring `font-family: 'Heebo', system-ui, -apple-system, sans-serif`
- (c) Text is being reversed somewhere via `.split('').reverse()`
- (d) Default fallback name in code is set to a non-UTF-8 string that the browser displays as boxes

Test by hardcoding `userProfile.name = 'רואי קליין'` temporarily and seeing if it renders correctly. If yes → field is wrong. If no → font/CSS is wrong. Fix accordingly.

**Important:** in incognito with no Google sign-in, `S.userProfile` is null. Whatever the default placeholder is, it must NOT be `□×□×§×`. Make the default either an empty string or "אורח".

---

## STEP 3 — Profile setup modal trigger

On first sign-in (no `S.userProfile.name` saved), the setup modal should pop. If it doesn't:
- Find where `S.userProfile` is read on app load.
- Ensure: `if (!S.userProfile?.name) { showProfileSetupModal(); }`

Also: verify clicking "Edit Profile" in the avatar dropdown opens the same modal (re-use the function).

---

## STEP 4 — Live voice button (`🎙️ Live`)

Find each chat header (main chat, Job Hunter, Career Coach, Upselles, family, ideas, finance agent if any). Each must have a `🎙️ Live` button next to the `⊞` expand button. Verify it toggles `startLiveVoice()` / `stopLiveVoice()`.

---

## STEP 5 — Mobile bottom nav

At <768px viewport, a 5-tab bottom bar should appear. If not, check the CSS media query and ensure the nav element exists in the DOM.

---

## STEP 6 — FedCM / Google Sign-In console errors

Console shows `FedCM was disabled either temporarily or permanently based on previous user action` and `[GSI_LOGGER]: FedCM get() rejects with NetworkError: Error retrieving a token`. This is Google's Federated Credential Management API misbehaving in incognito.

Update the GSI initialization in `index.html`:
```js
google.accounts.id.initialize({
  client_id: '<existing>',
  callback: handleCredentialResponse,
  use_fedcm_for_prompt: true,    // opt into FedCM
  auto_select: false,
  cancel_on_tap_outside: false
});
```

If the FedCM error persists, fall back to the OAuth code flow (`google.accounts.oauth2.initCodeClient`) which is more reliable for incognito.

Surface a visible "Sign in with Google" button — don't rely only on One Tap, which is blocked in incognito.

---

## Process for each step

1. Make the fix
2. `git add -A && git commit -m "<short message>" && git push`
3. Wait 60s for Vercel deploy
4. **Verify the deploy is GREEN** in Vercel dashboard before moving on. If red, fix the deploy first.
5. Open https://personal-os-coral-tau.vercel.app in a fresh incognito window
6. Verify the feature appears AND works
7. Move to next item

After all items: append to `OVERNIGHT_BUILD_REPORT.md` a "Wire-up Fixes — round 4" section listing:
- The root cause of the failed deploy and how it was fixed
- What was actually wired up
- What (if anything) is still missing
- Output of `curl -I https://personal-os-coral-tau.vercel.app` showing the latest deploy
- Output of `find api -name '*.js'` confirming function count is ≤ 12 (Hobby limit)

**Do not lie. Do not claim "fixed" without verifying in the browser. The previous round's report claimed Phase 5-10 was shipped, but the deploy actually failed and nothing went live. Verify deploy status BEFORE writing any "done" status.**

Begin with Step 0 NOW.
