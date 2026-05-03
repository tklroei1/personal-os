# Personal OS — Claude Code Context

## Project
Single-page app (index.html) deployed on Vercel at https://personal-os-coral-tau.vercel.app  
Stack: vanilla JS + Vercel serverless functions. No build step.

---

## WhatsApp Bot (via whatsapp-claude-plugin)

When receiving WhatsApp messages, **always respond in Hebrew**, keep replies short (WhatsApp style).

### API endpoint
`https://personal-os-coral-tau.vercel.app/api/whatsapp-command`

### Command mapping

**הוסף מבחן [שם] בתאריך [תאריך]**
```bash
curl -s -X POST https://personal-os-coral-tau.vercel.app/api/whatsapp-command \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"ds_add_exam\",\"params\":{\"title\":\"[שם]\",\"date\":\"[YYYY-MM-DD]T09:00\",\"type\":\"exam\"}}"
```

**הוסף שיעורי בית [שם] עד [תאריך]**
```bash
curl -s -X POST https://personal-os-coral-tau.vercel.app/api/whatsapp-command \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"ds_add_hw\",\"params\":{\"title\":\"[שם]\",\"dueDate\":\"[YYYY-MM-DD]\"}}"
```

**הוסף הוצאה [סכום] [תיאור]**
```bash
curl -s -X POST https://personal-os-coral-tau.vercel.app/api/whatsapp-command \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"finance_add_expense\",\"params\":{\"amount\":[סכום],\"description\":\"[תיאור]\"}}"
```

**מה הדדליינים השבוע?**
```bash
curl -s "https://personal-os-coral-tau.vercel.app/api/whatsapp-command?action=get_deadlines"
```

### Response handling
Parse the JSON response and use the `response` field as your WhatsApp reply:
- `{"ok":true,"response":"✅ מבחן 'X' נוסף ל-2026-05-15"}` → reply: `✅ מבחן 'X' נוסף ל-2026-05-15`

### Date parsing rules
- "מחר" → tomorrow YYYY-MM-DD
- "ביום שישי" / "בשישי" → next Friday YYYY-MM-DD  
- "ב-15 למאי" → 2026-05-15
- Always ISO format (YYYY-MM-DD) in the API call

### All other messages
Answer naturally in Hebrew without calling the API.
