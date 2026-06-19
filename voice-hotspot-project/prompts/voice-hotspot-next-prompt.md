# Claude Code prompt — Voice Hotspot: skills + Gemini/Claude + UI upgrade + go live
> Paste into Claude Code (in the `C:\Users\user\voice-hotspot` project).

## 0. Use the skills on everything you've built and will build
- Install Superpowers if not installed: `/plugin install superpowers@claude-plugins-official`. Follow its methodology (brainstorm → spec → plan → TDD → self-review) for every change here.
- Use the **frontend-design** skill (at `.claude/skills/frontend-design/SKILL.md`; if missing, ask me — I have it) as the design authority for ALL UI work below.

## 1. Dual LLM: Anthropic + Gemini (router)
Add a model router with BOTH providers via `.env`:
- `ANTHROPIC_API_KEY` and `GEMINI_API_KEY`.
- **Use Gemini for the conversational / language layer** (the live coaching phrasing, emotion-from-text nuance, and especially **Hebrew**) — it's stronger at natural communication. **Use Claude for structured reasoning** (methodology selection, JSON insight cards, fusion logic). Make the provider per-task configurable; if a key is missing, fall back gracefully to the other, then to the local rules engine.
- Never expose keys client-side — all model calls go through the Node server.

## 2. Go live (make it a real working MVP, not just the demo)
- Wire the live **microphone** path (Web Speech / Deepgram) end-to-end and verify real transcription + real voice-tone analysis from the mic — not only the scripted demo.
- Confirm the 6 triggers, the tone-vs-words contradiction, speaker distinction, and target-switch all fire on LIVE audio.
- **Hebrew support:** Web Speech handles Hebrew STT, but the rules engine is English regex. Add a Hebrew lexicon/rules layer, OR route Hebrew utterances to Gemini for emotion+coaching. Test a Hebrew sales call end-to-end.


## 2.5 Dual analysis + combined FINAL read (REQUIRED — in the demo and live)
- Give the user a selector for the analysis mode: **Text only / Voice only / Both** (toggle in the UI; default Both).
- Show each selected signal SEPARATELY: **text-emotion** (from the words) and **voice-tone-emotion** (from prosody) — each with its own label + confidence.
- Always produce a **combined FINAL read** — one clear assessment of the other side: what they're really feeling/thinking and what it means for the conversation. If only one mode is selected, base it on that mode; when **Both** is selected, the final read explicitly reconciles the two and flags any contradiction (tone ≠ words).
- This combined final read is the key takeaway that helps the rep understand the person — show it prominently (it fits the "Duet" final-state).

## 3. UI upgrade (apply the frontend-design skill)
Redesign the UI as a distinctive product with its own identity — NOT a generic dark dashboard. Before coding, show me a short design plan (palette of 4–6 named hex, a real display+body type pairing, layout concept, and ONE signature element — e.g. the live dual-emotion meter or how insight cards arrive). After I approve, build it. Keep: live transcript, dual emotion register (text + voice tone) with a clear visual for "tone contradicts words", urgent scannable coaching cards. Quality floor: responsive to mobile, visible keyboard focus, reduced-motion respected, accessible contrast. Use motion deliberately. Take screenshots and self-critique.

## 4. Order
1) Router (Claude+Gemini) + `.env.example`. 2) Live mic verification (EN). 3) Hebrew path. 4) UI redesign (design plan → approve → build). 5) Update README + `research/findings.md` if anything changed.

Tell me exactly which env keys to set and where.
