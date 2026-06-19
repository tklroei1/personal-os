# מפת התיקייה — שתי מערכות נפרדות

התיקייה הזו מכילה שתי מערכות **נפרדות לחלוטין**. אין ביניהן קשר תפעולי.

## 🟦 זורו / Personal OS (האפליקציה החיה)
פרוסה ב‑Vercel: https://personal-os-coral-tau.vercel.app
> ⚠️ קבצי הליבה נשארים בשורש — **אסור להזיז אותם**, זה ישבור את הפריסה ב‑Vercel.

קוד חי (שורש):
- `index.html`, `agent.js`, `assistant.js`, `jarvis.js`, `voice.js`, `sw.js`, `manifest.json`, `icon.svg`
- `api/` — פונקציות שרת (Claude, Gemini, סוכן עבודה, וכו')
- `vercel.json`, `package.json`
- `scripts/`, `cloudflare-worker/`, `whatsapp-bot/`
- `showcase/` — דמואים (כולל clarity‑* של מטלת Grammarly)
- `docs/` — מסמכי הקמה (SETUP, whatsapp‑setup, bookmarklet)
- `CLAUDE.md` — הוראות הפרויקט של זורו

מסמכים/פרומפטים היסטוריים של זורו:
- `zoro-docs/` — דוחות ופרומפטים של בנייה/אודיט (הועברו לכאן לסדר)

## 🟧 Voice Hotspot (המערכת החדשה, נפרדת)
קו‑פיילוט חי לשיחות מכירה. הקוד עצמו נבנה ב‑Claude Code בתיקייה חיצונית
`C:\Users\user\voice-hotspot` (לא כאן). רץ מקומית: http://localhost:3000

- `voice-hotspot-project/` — כל מה שקשור למערכת החדשה:
  - `README.md` — hub מרכזי + סטטוס
  - `prompts/` — כל הפרומפטים לקלוד‑קוד
  - `research-grammarly-tone.md` — מחקר
- (הערה: `showcase/voice-hotspot.html` הוא דמו ויזואלי שמוגש דרך פריסת זורו, ולכן נשאר בצד זורו.)
