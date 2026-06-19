# Build prompt for Claude Code — "Voice Hotspot" (real-time AI sales-closing co-pilot)
> Paste this entire file into Claude Code as the task. It creates a NEW project in its own folder.

## Instruction to Claude Code
Create a **new project in a new folder named `voice-hotspot`** (do NOT modify the `personal-os` project). Build the MVP below. Treat this as a strong starting spec — understand the goal, push back where you see better options, and expand it. A de-branded visual reference UI already exists at `personal-os/showcase/voice-hotspot.html` — reuse its dark look & feel as the starting sidebar.

---

## 1. What it is (scope: SALES, for now)
**Voice Hotspot** = a real-time co-pilot that sits beside a live sales call and helps the rep **understand the other side AND close the deal — live**. It:
- **Transcribes** the call in real time.
- **Reads emotion two ways:** from the **words** (NLP/LLM) and from the **voice tone/prosody** (audio) — and fuses them. Tone can reveal what words hide; flag disagreement between the two.
- **Coaches in the moment:** on the monitor it shows the emotional register **and** concrete, context-aware **closing recommendations** — *what to say next, what to offer, what to emphasize* — based on what the prospect just said, the emotion behind it, and **what's being sold**.
- Example: prospect sounds hesitant on price → the co-pilot tells the rep, live: *"Hesitation, not a real price objection. Don't discount — reframe on ROI, offer a 2-week pilot, and ask who else needs to approve."*
- **Post-call:** summary of emotional moments, objections, buying signals, and the recommended next step.

## 2. Setup (gives the AI context to recommend well)
Before/at call start the rep enters (or picks a saved profile): **what they sell**, key value props, pricing, common objections, target buyer, and goal of this call. The coach uses this as context for every recommendation.

## 3. The monitor (live UI)
- **Live transcript** (speaker-labelled, streaming).
- **Emotion register** per prospect turn: label + confidence for **text-signal** and **voice-tone-signal** + a fused state, on a meter.
- **Coaching cards (the core):** real-time "next best move" — a one-line read of what's happening + a suggested line to say + what to offer/emphasize. Triggered by emotion shifts, objections, buying signals, hesitation, compliance questions, etc.
- Post-call summary panel.

---

## 4. THE MODEL'S KNOWLEDGE LAYER (this is what makes it smart — build it deliberately)
The coaching engine must be grounded in four bodies of knowledge + the connections between them. Encode these as a structured system prompt + a small knowledge base (JSON/markdown the LLM is given as context; RAG optional later).

**A. Sales methodology & psychology**
- **SPIN** (Situation/Problem/Implication/Need-payoff) — diagnostic questioning for complex deals.
- **Sandler** — psychology-based, consultative; upfront contracts, "permission to say no," pain funnel; don't chase.
- **Challenger** — teach, tailor, take control; reframe the prospect's thinking.
- **MEDDIC** — qualification: Metrics, Economic buyer, Decision criteria/process, Identify pain, Champion.
- **Objection handling** — acknowledge → clarify → reframe → confirm; price objection vs. hesitation vs. stall.
- **Buying-signal taxonomy** — compliance/security questions, "how soon could we start", asking about pricing tiers, looping in others = intent.

**B. Emotion psychology**
- Valence (positive↔negative) × arousal (calm↔activated); Plutchik's primary emotions.
- Map emotions → buying behavior: hesitation/uncertainty → needs reassurance; frustration → unmet pain (opportunity); enthusiasm → move to close; skepticism → proof/social proof.

**C. Vocal prosody (emotion from the voice itself)**
- **Pitch:** fear/anxiety → higher pitch, little variation; anger → lower pitch, higher intensity.
- **Pace:** faster → excitement/urgency/fear; slower → sadness/deliberation.
- **Pauses/hesitation:** halting pace + filled pauses ("um", "I guess") → low confidence / unspoken objection.
- **Loudness/stress:** loud steady → confidence; soft/halting + higher pitch → uncertainty.
- Use these to interpret the Hume tone signal and to catch when **tone contradicts words** ("sounds fine" said hesitantly).

**D. Linguistic & contextual cues**
- Hedging ("maybe", "I think", "need to check") → uncertainty; commitment language ("when we", "our team") → buy-in.
- Questions as signals; silence after price; speed of reply; topic shifts.
- **Context fusion:** combine emotion(text) + emotion(tone) + linguistic cues + what's being sold + sales stage → the recommended move. This fusion IS the product's IP.

> Research/expand each of these as you build, and write them into a `knowledge/` directory the coach loads. Cite framework names so output is explainable.

---

## 4.5 COLLECT THE DATA & RESOURCES FIRST (research step — do this before/while building)
Before finalizing the coaching engine, **gather and evaluate real data and existing tools** so emotion analysis is grounded in reality, not guesses. Create a `research/` folder and a `research/findings.md` documenting everything.

**A. Speech-emotion datasets (to learn/validate voice → emotion):**
IEMOCAP, RAVDESS, CREMA-D, MSP-Podcast, MELD (multimodal, conversational), CMU-MOSEI, TESS, SAVEE. Use them to calibrate the tone model and as test fixtures for the analyzer.

**B. Sales / conversation data (to learn the patterns):**
Public sales & customer-service call corpora and transcripts, recorded discovery/sales calls (e.g. on YouTube) for transcription tests, negotiation-dialogue datasets. Note: labeled real sales calls are scarce (privacy) → supplement with **synthetic / role-play calls you generate** (scripted prospect+rep dialogues annotated with emotion + ideal move).

**C. Existing tools/APIs to evaluate and REUSE (don't reinvent):**
- Voice-tone emotion: **Hume AI**, audEERING devAIce, Deepgram add-ons.
- STT: Deepgram, AssemblyAI, Whisper.
- Meeting capture: Recall.ai, Zoom Apps SDK, `chrome.tabCapture`.
- Competitors to study for features/positioning/GAPS: Gong, Chorus, Clari Copilot, Sybill, Cresta, Attention, Balto, Observe.AI, Uniphore.

**D. Sales-knowledge sources:** methodology references (SPIN, Sandler, Challenger, MEDDIC), objection-handling playbooks, buying-signal lists → distill into the `knowledge/` base.

**Deliverable of this step — `research/findings.md`:** which datasets to use, which APIs to integrate (and why), a competitor gap analysis (where Voice Hotspot wins), and the distilled sales + emotion + prosody knowledge that feeds the coaching engine. Use this to decide what to BUILD vs. what existing tool to PLUG IN.

## 5. Tech stack (recommended)
- **Frontend:** vanilla JS + the existing dark UI (or React). Reuse `showcase/voice-hotspot.html` layout.
- **Live STT:** Deepgram **streaming** (low latency) / AssemblyAI realtime. v0 fallback: browser Web Speech API.
- **Voice-tone emotion:** **Hume AI — Expression Measurement (prosody, streaming)** — emotion from audio itself.
- **Text emotion + coaching engine:** Claude (Haiku for low latency; Sonnet for the richer "what to say" generation). System prompt grounded in §4 + the rep's product context. Small rules layer for hard triggers.
- **Fusion:** weighted combine of text+tone; surface disagreement.
- **Backend:** Node serverless (Vercel) holding keys (DEEPGRAM_API_KEY, HUME_API_KEY, ANTHROPIC_API_KEY) — **never expose keys client-side**; relay streams via WS/SSE.

## 6. Form factor (priority order)
1. **v0 — browser web app** (mic or tab audio) → works end-to-end, demo-able.
2. **v1 — Chrome extension** for **Google Meet** + **Zoom (web)** via `chrome.tabCapture`, overlay sidebar.
3. **v2 — Recall.ai bot** for native Zoom/Meet/Teams + phone.

## 7. MVP acceptance (v0 must actually work)
- Rep enters what they're selling → starts session → speaks/plays a call → transcript streams (~1s).
- Each prospect turn shows text-emotion + voice-tone-emotion.
- ≥4 trigger types produce **contextual closing recommendations** (hesitation, price objection, compliance/buying-signal, positive-shift) — each with a suggested line + what to offer/emphasize.
- Tone-vs-words contradiction is detected at least once.
- Post-call summary with next step.

## 8. Build order
1. Scaffold `voice-hotspot/` (frontend + `/api` + README + `.env.example`).
2. v0: mic → streaming STT → transcript.
3. Text emotion + the §4-grounded coaching engine + product-context setup.
4. Hume voice-tone emotion; fuse; dual display; contradiction flag.
5. Post-call summary.
6. v1 Chrome extension (Meet/Zoom-web). 7. v2 Recall.ai.

## 9. Guardrails / expand later
- Consent + privacy: process audio in-memory, don't store raw audio by default.
- Explainable cards ("why" + which framework).
- Rep-editable playbook (triggers → suggested moves).
- Keep providers swappable (STT/emotion/LLM).
