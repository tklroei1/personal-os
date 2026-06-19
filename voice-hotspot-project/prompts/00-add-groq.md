# Voice Hotspot — הוסף את Groq כספק חינמי בראוטר
> להעתיק לקלוד‑קוד.

- הוסף `GROQ_API_KEY` ל‑.env ולשרשרת ה‑providers ב‑`api/_llm.js` (אני אכניס את המפתח עצמי — אל תזין מפתחות).
- Groq endpoint תואם‑OpenAI: `https://api.groq.com/openai/v1/chat/completions`. מודל מומלץ: `llama-3.3-70b-versatile` (או הזמין הנדיב ביותר).
- מקם בשרשרת fallback: Gemini (חינם) → **Groq (חינם, מהיר, מכסה נדיבה)** → Claude (בתשלום, אם מפתח קיים) → מנוע מקומי.
- שמור retry על שגיאות זמניות (429/5xx/timeout) ומעבר אוטומטי לספק הבא.
- לוג: איזה ספק ענה + זמן תגובה.
- **אימות:** קריאת בדיקה ל‑Groq מחזירה 200, והרץ את ה‑LLM eval גם דרך Groq והשווה ל‑Gemini.
