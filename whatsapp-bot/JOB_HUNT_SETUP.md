# סוכן ציד משרות — בתוך בוט ה-Railway

## מה זה
`job-hunt-agent.js` רץ בתוך הבוט הקיים, 24/7, בלי תלות במחשב של רואי:
- **09:00** — חיפוש AI/Growth + Product (ת"א)
- **17:00** — חיפוש פיננסים (EY, בתי השקעות, PE, VC) + AI/Product
- פקודת וואטסאפ ידנית: **"חפש משרות"** — מריץ מיד

## צינור
Apify (LinkedIn scrape, פילטר entry-level + שבוע אחרון) → סינון חוקים חינמי (Senior/חו"ל נזרקים) → ניקוד Claude Haiku מול הפרופיל + מטרת הסטארט-אפ → משרות ≥70% מועלות ל-Personal OS דרך `/api/webhook` (action: add_job) → דוח וואטסאפ לרואי.

## תקציב
- 2 חיפושים × 10 תוצאות = 20 לריצה (~$0.02). תקרה חודשית קשיחה: 4,000 תוצאות (~$4).
- מונה חודשי נשמר ב-`/data/jobhunt-state.json` (volume של Railway) + דה-דופ של משרות שהועלו.
- ניקוד Haiku: ~$0.5-1/חודש על חשבון ה-ANTHROPIC_API_KEY הקיים.

## התקנה (פעם אחת)
1. דחוף לגיטהאב את: `whatsapp-bot/job-hunt-agent.js` + `whatsapp-bot/index.js` (המעודכן).
2. ב-Railway → Variables → הוסף:
   - `APIFY_TOKEN` — מ-https://console.apify.com/settings/integrations (רואי מדביק בעצמו)
   - `WEBHOOK_SECRET` — רק אם מוגדר גם ב-Vercel (אותו ערך)
3. Redeploy. בלוג אמור להופיע: `[jobhunt] scheduler armed`.
4. בדיקה: שלח "חפש משרות" בוואטסאפ.

## הערות
- המשרות נקלטות באפליקציה דרך תור webhook — צריך לפתוח את Personal OS אחרי דוח כדי שייקלטו (הדוח מזכיר את זה).
- אחרי אימות שהכל עובד — אפשר לכבות את המשימה המתוזמנת המקבילה ב-Claude (job-hunt-agent) כדי לא לקבל דוחות כפולים.
