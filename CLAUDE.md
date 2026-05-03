# Personal OS — Claude Code Context

## Project
Single-page app (index.html) deployed on Vercel at https://personal-os-coral-tau.vercel.app  
Stack: vanilla JS + Vercel serverless functions. No build step.

---

## WhatsApp Bot (via whatsapp-claude-plugin)

When receiving WhatsApp messages, **always respond in Hebrew**, keep replies short (WhatsApp style).

### API helper (run via bash)

Use this Node.js snippet to call the Personal OS API from bash:

```bash
node -e "
fetch('https://personal-os-coral-tau.vercel.app/api/whatsapp-command', {
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify(PAYLOAD)
}).then(r=>r.json()).then(d=>console.log(d.response||'error')).catch(e=>console.error(e));
"
```

Replace `PAYLOAD` with the actual object for each command below.

---

### Command mapping

**הוסף מבחן [שם] בתאריך [תאריך]**  
Payload: `{action:"ds_add_exam",params:{title:"[שם]",date:"[YYYY-MM-DD]T09:00",type:"exam"}}`

**הוסף שיעורי בית [שם] עד [תאריך]**  
Payload: `{action:"ds_add_hw",params:{title:"[שם]",dueDate:"[YYYY-MM-DD]"}}`

**הוסף הוצאה [סכום] [תיאור]**  
Payload: `{action:"finance_add_expense",params:{amount:[סכום],description:"[תיאור]"}}`

**מה הדדליינים השבוע?**
```bash
node -e "
fetch('https://personal-os-coral-tau.vercel.app/api/whatsapp-command?action=get_deadlines')
  .then(r=>r.json()).then(d=>console.log(d.response||'error')).catch(e=>console.error(e));
"
```

---

### Response handling
The API returns `{"ok":true,"response":"Hebrew confirmation text"}`.  
Log the `response` field and use it as your WhatsApp reply.

### Date parsing rules
- "מחר" → tomorrow YYYY-MM-DD
- "ביום שישי" / "בשישי" → next Friday YYYY-MM-DD  
- "ב-15 למאי" → 2026-05-15
- Always ISO format (YYYY-MM-DD) in the API call

### All other messages
Answer naturally in Hebrew without calling the API.
