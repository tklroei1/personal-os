# Voice Hotspot v2 — rebuild prompt for Claude Code (3 clear functions + real design)
> Paste into Claude Code in the `voice-hotspot` project. This replaces the prior UI/structure direction.

## 0. ACTUALLY USE THE SKILLS (this was skipped — do not skip again)
- The **frontend-design** skill must be at `.claude/skills/frontend-design/SKILL.md`. If it's missing, STOP and ask me for it. The current UI looks basic/generic — that's the main problem. You MUST follow the skill: before writing any UI, produce a **design plan** (a warm palette as 5–7 named hex, a real display+body type pairing, layout concept, ONE signature element), show it to me, get approval, THEN build.
- Use **Superpowers** methodology (brainstorm → plan → build → self-critique, screenshots).

## THE PRODUCT = 3 MODULAR FUNCTIONS (keep each clear and separable)

### Function 1 — Dual emotion analysis (voice + text → one fused read)
- **From the VOICE/audio itself:** detect vocal cues — tremor/shakiness, speech rate (fast/slow), pitch (high/low), volume, pauses/hesitation, energy — as indicators of emotional state.
- **From the WORDS (transcript):** NLP/LLM emotion + intent.
- **Fuse both** into ONE read of what the person feels/wants; **flag contradiction** (tone vs words). Output per turn: emotion label + confidence + short "why" (which cues triggered it).

### Function 2 — Speaker separation + target selection
- **Diarization:** distinguish the different voices in the call (use Deepgram diarization for real separation).
- **Name-binding:** when someone introduces themselves ("Hi, I'm Dana") bind that voice → the name "Dana", and keep using it.
- **Target selection:** the user chooses who the AI analyzes — one person / only the client / all participants (2+). **Switchable mid-call.** Only the selected target(s) get deep analysis + coaching.

### Function 3 — The "Prompter" (live side panel, like a teleprompter; works as an add-on)
- A calm, readable panel beside the call showing:
  - **Transcript as chat bubbles** — the **speaker's name** each turn, and a **distinct color per speaker** (caller A vs caller B vs ...).
  - **The AI's messages in a DIFFERENT bubble style + different color**, clearly separated from the transcript. The AI bubble's color can **match the emotion it conveys** (e.g., urgency/anger → red, positive → green).
  - Per turn: the **interpretation + explanation**, e.g. "started speaking fast → may indicate stress."
- **Live, adaptive sales coaching woven in:** when it detects e.g. stress after you offered X → it writes: *"the client tensed after X — try Y so Z happens, then move to W."* It keeps adapting as the conversation + analysis evolve.
- **Reading pace:** comfortable and readable — pace the reveal, don't flood the screen.

## UI / STRUCTURE — clarity is the #1 fix
- **Separate, clear pages (a real flow, not one cramped screen):**
  1. **Prepare for a specific call** (page): enter what you sell, value props, common objections, the goal of the call, and choose the target speaker(s).
  2. **Live call + Prompter** (separate page / the add-on panel): transcript bubbles + AI coaching bubbles + the dual emotion read.
  - Clear navigation between the two.
- **Design:** bigger, warmer, prettier, pleasant on the eyes, high readability. **Strong color separation** (per-speaker colors; the AI's color distinct from all transcript; emotion-colored AI bubbles). Follow the frontend-design skill — NOT a generic dark dashboard.

## ADD-ON / PLATFORM
- Architect it to run as an **add-on that connects to Zoom and Google Meet (primary).** MVP path: a **Chrome extension** that captures Meet/Zoom-web tab audio via `chrome.tabCapture` and overlays the Prompter panel. Later: Recall.ai bot for native Zoom/Meet/Teams.

## EVERYTHING LIVE
- Real mic/call audio → live STT (Deepgram) → live voice-tone emotion (Hume) + text emotion (Gemini/Claude via the existing auto-router) → live Prompter + adaptive coaching.

## BUILD ORDER
1. Put + FOLLOW the frontend-design skill → design plan (palette/type/layout/signature) → show me → approve.
2. Rebuild the structure into the 2-page flow (Prepare → Live Prompter).
3. Function 1 (dual analysis) → Function 2 (diarization + target select + name-binding) → Function 3 (Prompter: per-speaker colored bubbles + distinct emotion-colored AI bubbles + explanations + adaptive coaching).
4. Verify LIVE end-to-end (English AND Hebrew).
5. Chrome-extension path for Meet/Zoom audio capture.
6. Screenshots + self-critique against the skill at each UI step.

---

## A. FREE MODE (no paid keys) — build this first, make it fully usable
Run everything on free building blocks, with a clean upgrade path when paid keys are added later:
- **Live transcription:** browser **Web Speech API** (free, live, Hebrew + English).
- **Voice cues without Hume:** extract basic prosody **in-browser via the Web Audio API** — pitch, volume, speech rate, pauses/energy. Map these to arousal/stress signals. (Coarser than Hume, but it gives Function 1 a real voice layer for free.)
- **Speaker separation without Deepgram:** heuristic diarization — cluster turns by pitch/energy + silence gaps to guess speaker switches, plus **name-binding** from "my name is X". Let the user manually correct/tag. (Real auto-diarization is the Deepgram upgrade.)
- **Text emotion + coaching:** **Gemini 2.5 Flash free tier** (key already in .env) via the existing auto-router.
- **Upgrade path:** wrap STT, diarization, and voice-emotion behind interfaces so adding `DEEPGRAM_API_KEY` / `HUME_API_KEY` later swaps the free module for the paid one with NO rewrite. If a paid key is absent, fall back gracefully and show a small "Free mode" badge.

## B. SKILLS — install and actually use them
- Install the **frontend-design** skill into the project at `.claude/skills/frontend-design/SKILL.md` (and `obra/superpowers`). Source: github.com/anthropics/skills. You may fetch it yourself from the repo, or I'll drop the SKILL.md in — either way, READ it and FOLLOW it before any UI work.
- Confirm in your first reply that the skill is present and that you're using it (name the palette/type/layout it produced).

## C. HOW YOU ASK ME QUESTIONS (until I say otherwise)
- From now on, whenever you need a decision, ask me with **multiple-choice options I can pick from**, and write the questions **in Hebrew**. Keep this style for every clarifying question until I explicitly tell you to stop.
