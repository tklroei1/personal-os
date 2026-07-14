# פרומפט המשך — שדרוג צייד המשרות (Personal OS)

העתק את כל מה שמתחת לקו לשיחה חדשה:

---

אתה ממשיך עבודה על פרויקט Personal OS (תיקייה: `C:\Users\user\Documents\New project\personal-os`, אפליקציית עמוד יחיד `index.html` ~8,250 שורות vanilla JS, פרוסה ב-Vercel: https://personal-os-coral-tau.vercel.app, ריפו GitHub: tklroei1/personal-os).

## מה כבר בוצע (הכל באוויר ומאומת)

קרא קודם את `JOB_HUNT_UPGRADE_PLAN.md` — התוכנית המלאה + נספח ביצוע עם עוגני שורות.

- **שלב 1 (בוצע)**: מתג "🎯 ציד / 📋 ניהול" (localStorage `pos_job_mode`), תור יומי `#daily-queue` ממוין לפי `window.interviewChance(job)`, כרטיסיית הגשה `openSubmitCard()` עם דונאט התאמה + "✅ הגשתי". בלוק מסומן `/* ===== HUNT/MANAGE v2 (Phase 1) ===== */`.
- **שלב 2 (בוצע)**: בבוט `whatsapp-bot/job-hunt-agent.js` — נוק-אאוט (משרות עם דרישת חובה שלא עומדים בה נפסלות), `computeInterviewChance` בשרת, זיהוי משרות רפאים, `scanComeet()` (טוקנים עדיין TODO), לו"ז סריקה 07:30+13:00, קרון בריפינג 08:00 (`api/cron/job-hunt.js` gate=8, `vercel.json` crons 5,6 UTC).
- **מירורינג קו"ח אמיתי (בוצע)**: `downloadTailoredCV` נכתב מחדש — לוקח את קו"ח הבסיס המלא (`ensureJHC().cv`, ~2,900 תווים) + תיאור המשרה → `/api/job-coach` mode=tailor (פרומפט מחוזק ב-`api/ai.js`) → קו"ח מלא נשמר ב-`job.cv_full` + רנדור `renderTailoredCVDoc`. אומת חי (3,872 תווים, כל הסעיפים).
- **פילטר מגישים (בוצע)**: `parseApplicants` בבוט, >100 נפסל, ≤25 בוסט + תג "👥 N מגישים" בתור, מכפיל crowding ב-interviewChance (שני הצדדים).
- **שלב 3 (בוצע)**: `printTailoredCV` (חלון הדפסה ATS-safe → PDF), `atsCheck`/`atsCheckHTML` (5 בדיקות בכרטיסייה), מנוע ממליצים — `POST /api/get-agent-results {mode:'referrers',company,title}` (Tavily×2 + Haiku, כולל בוגרי בר-אילן) → `job.referrers[]` + הודעות פנייה ≤300 תווים עם כפתור העתקה, ו"עם ממליץ: ~X%" בכרטיסייה. אומת חי: נמצאה ממליצה אמיתית ב-SE7EN (סיון מילר, בוגרת בר-אילן).
- **באגים שתוקנו**: `jobTypeHe` הוגדר בבלוק סקריפט מאוחר ונקרא ב-init (הועתק לבלוק הראשי ~שורה 5093); משתני שלב 1 הפכו ל-`var` + ברירת מחדל hunt כי `init()` רץ באמצע הבלוק (שורה ~5640) לפני ההגדרות (~7749).

## ריטואל ONE datAI (הושלם — ממתין לרואי)
משרת Data Product Manager @ ONE datAI: התאמה 65, קו"ח מותאם (docx+PDF) נוצרו, טיוטת מייל בעברית ממתינה ב-Gmail אל Reut.k@onedatai.co.il (לצרף PDF ולשלוח), ממליצה: ניצן שמיר https://www.linkedin.com/in/nitzan-shamir-5428aa88/ — הודעה מוכנה נמסרה בצ'אט. המשרה בתוך המערכת (id: job_1783960745754_840).

## כללי סביבה קריטיים
1. **עריכת קבצים רק דרך Read/Edit בנתיבי Windows** (`C:\Users\user\Documents\New project\personal-os\...`). ה-mount של לינוקס (`/sessions/.../mnt/personal-os/`) **תקוע על עותקים ישנים/קטועים** של index.html וקבצי whatsapp-bot — אסור לסמוך עליו או לקמט ממנו. בדיקות `node --check`: להעתיק תוכן ל-/tmp עם Write ולבדוק שם.
2. **אין git מה-sandbox** — הפריסה: רואי מריץ בפאוורשל `git add -A; git commit -m "..."; git push` (שורה-שורה, בלי &&) → Vercel פורס אוטומטית תוך ~דקה. אם יש `.git/index.lock` תקוע: `Remove-Item ".git\index.lock" -Force`.
3. **אימות אחרי פריסה**: דרך Chrome MCP על personal-os-coral-tau.vercel.app — `fetch(location.href,{cache:'reload'})` לבדוק שהקוד עלה, ואז reload + `goPage('jobs')` + בדיקת קונסול (`read_console_messages`).
4. **Vercel Hobby: מקס' 12 פונקציות** — להוסיף לוגיקת שרת רק לקבצים קיימים (`api/ai.js`, `api/get-agent-results.js`, `api/util.js`).
5. **ביצוע בפועל של שלבים — לשגר סוכן Opus** (Agent tool, model: opus) עם מפרט מפורט; המשתמש ביקש לחסוך קרדיטים.
6. לענות בעברית, לחתום `— מערכת רואי 🤖`.

## הנקודה המדויקת שבה נעצרנו
**המשימה הבאה: שלב 4** — נוצרה משימה (task) אבל סוכן ה-Opus **עדיין לא שוגר**. יש לשגר Opus עם המפרט מסעיף "שלב 4 — ליטוש" בנספח של `JOB_HUNT_UPGRADE_PLAN.md`:
1. **KV persistence**: הרחבת `api/ai.js` ב-`fn=jobs_get`/`fn=jobs_put` על Upstash/Vercel KV (`pos_jobs_{userId}`), סנכרון דו-כיווני ב-`save()` (debounce 5s) וב-load; localStorage נשאר cache. (להשתמש בצנרת ה-KV הקיימת של backup/push ב-`api/ai.js`.)
2. **ליטוש עיצובי מלא** של page-jobs ברמת Apple: משתני CSS קיימים, blur, radius 16–20, אנימציות spring 150–250ms, dark mode תקין, מובייל 380px.
3. **סיכום שבועי** במצב ניהול: הוגשו/תגובות/ראיונות/% המרה מ-`stage_history` (7 ימים).
4. **ניקיונות**: תווית "מרכז הפיקוד"→"דשבורד" בפאנל הצייד; עדכון `docs/SETUP.md` על הלו"ז החדש.

אחרי שהסוכן מסיים: לבקש מרואי פוש, לאמת חי בכל הסעיפים (כולל מובייל-viewport וסיכום שבועי), ולעדכן את הנספח בתוכנית עם "שלב 4 בוצע".

## TODO פתוחים אחרי שלב 4
- טוקני Comeet (uid+token מדפי קריירה דרך Chrome MCP — network requests) לחברות ב-`job-hunt-config.js`.
- לוודא שהבוט ב-Railway מתעדכן מהריפו (אם אין auto-deploy — פריסה ידנית); בלעדיו אין מספרי מגישים/נוק-אאוט בסריקות.
- חיבור מקורות דרושים/AllJobs (הצ'יפים מסומנים "בקרוב").
- מדדי הצלחה לבדיקה שבוע קדימה: ≥15 משרות בתור בבוקר, הגשה <60 שניות, 20 הגשות ≤10 דקות.
