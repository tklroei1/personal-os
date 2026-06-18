// api/claude.js — v4.0 Real Agent Backend
const AGENT_TOOLS = [
  {
    name: 'add_task',
    description: 'Add a task to the user\'s task list',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title in Hebrew' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        project: { type: 'string', description: 'Project ID: jobs/upselles/health/apartment/family/none' },
        category: { type: 'string', enum: ['work', 'health', 'family', 'project', 'home'], description: 'Task category' }
      },
      required: ['title']
    }
  },
  {
    name: 'complete_task',
    description: 'Mark a task as completed by fuzzy-matching its title',
    input_schema: {
      type: 'object',
      properties: {
        task_title: { type: 'string', description: 'Task title to complete (fuzzy match)' }
      },
      required: ['task_title']
    }
  },
  {
    name: 'add_event',
    description: 'Add an event or appointment to the calendar',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title in Hebrew' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        time: { type: 'string', description: 'Time in HH:MM format (optional)' },
        notes: { type: 'string', description: 'Optional notes' }
      },
      required: ['title', 'date']
    }
  },
  {
    name: 'add_habit',
    description: 'Add a new habit to track',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Habit name in Hebrew' }
      },
      required: ['name']
    }
  },
  {
    name: 'log_habit',
    description: 'Log a habit as completed for today',
    input_schema: {
      type: 'object',
      properties: {
        habit_name: { type: 'string', description: 'Habit name to log (fuzzy match)' }
      },
      required: ['habit_name']
    }
  },
  {
    name: 'search_web',
    description: 'Search the web for current information, job listings, news, apartments, etc.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: { type: 'string', enum: ['general', 'jobs', 'news', 'apartments'], description: 'Type of search' }
      },
      required: ['query']
    }
  },
  {
    name: 'add_note',
    description: 'Save a note or important information',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Note title in Hebrew' },
        content: { type: 'string', description: 'Note content' }
      },
      required: ['content']
    }
  },
  {
    name: 'get_context',
    description: 'Get the user\'s current tasks, habits, events, or projects to answer questions about their status',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['tasks', 'habits', 'events', 'projects', 'all'] }
      },
      required: ['type']
    }
  },
  {
    name: 'add_reminder',
    description: 'Add a reminder with a date and time',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Reminder text in Hebrew' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        time: { type: 'string', description: 'Time in HH:MM format' }
      },
      required: ['text']
    }
  },
  {
    name: 'add_goal',
    description: 'Add a personal goal',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Goal text in Hebrew' },
        emoji: { type: 'string', description: 'Optional emoji for the goal' }
      },
      required: ['text']
    }
  },
  {
    name: 'add_idea',
    description: 'Save an idea',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Idea text in Hebrew' },
        cat: { type: 'string', description: 'Category: upselles/jobs/general' }
      },
      required: ['text']
    }
  },
  {
    name: 'add_journal',
    description: 'Add a personal journal entry',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Journal entry text in Hebrew' }
      },
      required: ['text']
    }
  },
  {
    name: 'add_job',
    description: 'Add a job listing to the job-search tracker',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Job title' },
        company: { type: 'string', description: 'Company name' },
        status: { type: 'string', enum: ['waiting', 'interview', 'offer', 'rejected'] },
        link: { type: 'string', description: 'Optional URL to the listing' }
      },
      required: ['title']
    }
  },
  {
    name: 'update_project',
    description: 'Update a project progress percentage (0-100)',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Project id or name: jobs/upselles/health/apartment/family' },
        progress: { type: 'number', description: 'Progress percentage 0-100' }
      },
      required: ['id', 'progress']
    }
  }
];

function buildSystemPrompt(agentId, userContext) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

  const ctx = userContext || {};
  const tasks = (ctx.pendingTasks || []).slice(0, 8).map(t => `  • ${t.text || t.title}${t.priority === 'high' ? ' 🔴' : ''}`).join('\n') || '  אין';
  const events = (ctx.upcomingEvents || []).slice(0, 5).map(e => `  • ${e.date} ${e.time || ''} — ${e.text || e.title}`).join('\n') || '  אין';
  const habits = (ctx.habits || []).map(h => h.name).join(', ') || 'לא מוגדרים';

  const agentPersonas = {
    'job-hunter': 'סוכן חיפוש עבודה אגרסיבי וחד. חפש משרות אמיתיות עם search_web, נתח התאמה לפרופיל של Roei באחוזים, ותמיד הוסף משרות רלוונטיות עם add_job. עזור בכתיבת CV ומכתבי מוטיבציה ספציפיים לכל משרה. אל תיתן עצות גנריות — תן צעד הבא קונקרטי.',
    'career-coach': 'Career Coach אישי שמשלב חום של מנטור עם ישירות של שותף עסקי. הכן לראיונות עם שאלות אמיתיות, תן פידבק ישיר וכן, עזור בתכנון קריירה. הפוך כל שיחה לתוצרים — משימות (add_task) ומטרות (add_goal). שאל שאלה אחת ממוקדת בכל פעם.',
    'upselles': 'שותף עסקי ו-Product Advisor ל-Upselles — marketplace + CRM לעסקים וסלזמנים פרילנס, MVP ~80%, שלב פיילוט. חשוב כ-Co-founder: עדיפויות, GTM, צעדים הבאים. תרגם החלטות למשימות (add_task) ורעיונות (add_idea).',
    'health': 'מאמן כושר ותזונה ישיר ותומך. עקוב אחר הרגלים עם log_habit, בנה תוכניות אימון ותפריטים, חשב קלוריות וחלבון. כשמדווחים על אוכל — תעד. תן מוטיבציה אמיתית, לא קלישאות.',
    'apt': 'סוכן חיפוש דירה לתל אביב (דיזינגוף—כרם התימנים, קרוב לים). חפש דירות עם search_web, נתח מחירים והשווה. נסח הודעות לבעלי דירות. שמור דירות רלוונטיות וצור משימות מעקב (add_task).',
    'family': 'עוזר לתכנון זמן משפחתי ואיזון. הוסף אירועים (add_event) ומשימות ישירות. הזכר ל-Roei מה חשוב מעבר לעבודה.',
    'ideas': 'שותף לחשיבה יצירתית. הרחב רעיונות, זהה הזדמנויות, וחשוב על מימוש. שמור רעיונות טובים עם add_idea וצעדים ראשונים כמשימות.',
    'news': 'סוכן חדשות. חפש חדשות עדכניות עם search_web וסכם בנקודות ברורות וקצרות, ממוקד בתחומים של Roei: AI, הייטק, קריירה.',
    'main': 'עוזר אישי ראשי בהשראת JARVIS. נהל משימות, לוז, פרויקטים ומטרות. בצע, אל תסביר יותר מדי.',
  };

  return `אתה סוכן AI אישי של רואי קליין — חלק מ-Personal OS שלו, בהשראת JARVIS של איירון מן.
היום: ${dateStr} | שעה: ${timeStr}

**תפקידך:** ${agentPersonas[agentId] || agentPersonas['main']}

**פרופיל Roei:**
- M.Sc Data Science & AI (בר-אילן) | B.A. כלכלה ועסקים (88)
- מייסד Upselles | מחפש עבודה: AI Analyst / Growth / PM / Data
- גר בהוד השרון | עברית בעיקר | ADHD — מעדיף הוראות שלב-שלב, ברורות וקצרות

**הנתונים הנוכחיים:**
משימות פתוחות:
${tasks}

אירועים קרובים:
${events}

הרגלים: ${habits}

**הכלים שלך:** add_task, complete_task, add_event, add_reminder, add_habit, log_habit,
add_note, add_goal, add_idea, add_journal, add_job, update_project, search_web, get_context.

**כללים:**
1. בצע פעולות ישירות — לעולם אל תשאל "האם תרצה שאוסיף?". תוסיף ותדווח.
2. כשמבקשים "תוסיף / תזמן / תסמן / תעדכן" — עשה זאת מיד עם הכלי המתאים.
3. תרגם כל שיחה לתוצרים — אם עלתה משימה, מטרה, רעיון או דדליין — שמור אותם בכלי.
4. search_web למידע עדכני (משרות, מחירים, חדשות). אל תמציא נתונים.
5. היה ספציפי וקונקרטי — לא עצות גנריות. תמיד תן צעד הבא ברור.
6. ענה בעברית תמיד — **קצר מאוד ומהיר** (1-3 משפטים, בלי הקדמות). כשמבצע כלי — ציין בדיוק מה עשית.

**יכולות חדשות במערכת (הפנה את רואי אליהן כשרלוונטי):**
- 🛰️ סוכן משרות אוטומטי ("מרכז הפיקוד") — סורק LinkedIn/AllJobs/חברות, מנקד מול הקו״ח, מסביר "למה המשרה הזאת", ומאפשר קו״ח מותאם + ניתוח פערים פר משרה.
- 🗓️ תזמון ראיונות פר משרה — מופיע בלוז השבועי (רק לשבוע הרלוונטי) וביומן Google.
- 📣 פרויקט LinkedIn — תוכנית פוסטים ומיתוג אישי (Clarity Mode + Voice Hotspot).
אם רואי מבקש "תמצא משרות / תריץ את הסוכן / תזמן ראיון" — הנח אותו לדף המתאים; אל תמציא שמצאת משרות בעצמך.`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body || {};

  // Voice modes — STT / TTS via OpenAI. Folded into this function to stay
  // under the Vercel Hobby 12-serverless-function limit.
  if (body.mode === 'transcribe') return handleTranscribe(res, body);
  if (body.mode === 'speak')      return handleSpeak(res, body);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No API key' });

  // Agent mode: real tool_use loop
  if (body.agentMode) {
    return handleAgentMode(req, res, apiKey, body);
  }

  // Simple mode: existing SSE streaming (backward compat)
  return handleSimpleMode(req, res, apiKey, body);
}

async function handleAgentMode(req, res, apiKey, body) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const ping = setInterval(() => res.write(':ping\n\n'), 8000);

  try {
    const systemPrompt = buildSystemPrompt(body.agentId || 'main', body.userContext || {});
    let messages = Array.isArray(body.messages) ? [...body.messages] : [];

    // Sanitize: ensure messages are valid Anthropic format
    messages = messages.filter(m => m.role && m.content).map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content
    }));

    let loopCount = 0;
    const MAX_LOOPS = 5;

    while (loopCount < MAX_LOOPS) {
      loopCount++;

      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: systemPrompt,
          tools: AGENT_TOOLS,
          messages
        })
      });

      if (!apiRes.ok) {
        const err = await apiRes.json().catch(() => ({}));
        send('error', { message: err.error?.message || `API error ${apiRes.status}` });
        break;
      }

      const data = await apiRes.json();
      const toolBlocks = (data.content || []).filter(b => b.type === 'tool_use');
      const textBlocks = (data.content || []).filter(b => b.type === 'text');

      // Send any text before tool calls
      const preText = textBlocks.map(b => b.text).join('');
      if (preText.trim()) {
        // Stream word-by-word for natural feel
        const words = preText.split(' ');
        for (let i = 0; i < words.length; i++) {
          send('text', { delta: words[i] + (i < words.length - 1 ? ' ' : '') });
          await new Promise(r => setTimeout(r, 12));
        }
      }

      if (toolBlocks.length === 0 || data.stop_reason === 'end_turn') {
        send('done', { stop_reason: data.stop_reason });
        break;
      }

      // Execute tools
      const toolResults = [];
      for (const tool of toolBlocks) {
        send('tool_call', { id: tool.id, name: tool.name, input: tool.input });

        if (tool.name === 'search_web') {
          // Execute server-side
          const result = await executeSearch(tool.input.query, process.env.TAVILY_API_KEY);
          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: result });
          send('tool_result', { id: tool.id, name: tool.name, result: result.slice(0, 300) + '…' });
        } else if (tool.name === 'get_context') {
          // Server returns placeholder; client fills real data
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: JSON.stringify(body.userContext || {})
          });
        } else {
          // Client-side tools: optimistic result — client will execute locally
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: `done`
          });
        }
      }

      messages = [
        ...messages,
        { role: 'assistant', content: data.content },
        { role: 'user', content: toolResults }
      ];
    }
  } catch (e) {
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('error', { message: e.message });
  } finally {
    clearInterval(ping);
    res.end();
  }
}

async function handleSimpleMode(req, res, apiKey, body) {
  const { stream, ...rest } = body;

  if (!stream) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(rest)
      });
      const d = await r.json();
      return res.status(r.ok ? 200 : r.status).json(d);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const ping = setInterval(() => res.write(':ping\n\n'), 8000);

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ ...rest, stream: true })
    });

    if (!upstream.ok) {
      send('error', await upstream.json().catch(() => ({ error: 'upstream error' })));
      res.end(); clearInterval(ping); return;
    }

    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const ev = JSON.parse(raw);
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') send('text', { text: ev.delta.text });
          else if (ev.type === 'message_stop') send('done', {});
        } catch {}
      }
    }
  } catch (e) {
    send('error', { error: e.message });
  } finally {
    clearInterval(ping); res.end();
  }
}

async function executeSearch(query, tavilyKey) {
  if (tavilyKey) {
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavilyKey, query, max_results: 5, search_depth: 'basic' })
      });
      if (r.ok) {
        const d = await r.json();
        return (d.results || []).map(x => `**${x.title}**\n${(x.content || '').slice(0, 250)}\n${x.url}`).join('\n\n') || 'No results';
      }
    } catch {}
  }
  return 'Search unavailable — no TAVILY_API_KEY configured';
}

// ─── VOICE: speech-to-text (OpenAI Whisper) ──────────────────────────────────
async function handleTranscribe(res, body) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return res.status(200).json({ error: 'no_key', text: '',
      message: 'חסר OPENAI_API_KEY ב-Vercel — קול לא יעבוד עד שיוגדר.' });
  }
  try {
    const b64 = (body.audio || '').replace(/^data:[^,]*,/, '');
    if (!b64) return res.status(400).json({ error: 'no_audio', text: '' });
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 800) return res.status(200).json({ text: '' });

    const mime = body.mime || 'audio/webm';
    const ext  = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([buf], { type: mime }), 'audio.' + ext);
    form.append('model', 'whisper-1');
    form.append('language', body.language || 'he');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form
    });
    if (!r.ok) {
      const err = await r.text().catch(() => '');
      return res.status(200).json({ error: 'stt_failed', text: '',
        message: 'שגיאת תמלול (' + r.status + ')', detail: err.slice(0, 200) });
    }
    const data = await r.json();
    return res.status(200).json({ text: (data.text || '').trim() });
  } catch (e) {
    return res.status(200).json({ error: 'exception', text: '', message: e.message });
  }
}

// ─── VOICE: text-to-speech (OpenAI TTS) ──────────────────────────────────────
async function handleSpeak(res, body) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(503).json({ error: 'no_key' });
  try {
    let text = (body.text || '').toString().trim();
    if (!text) return res.status(400).json({ error: 'no_text' });
    if (text.length > 1200) text = text.slice(0, 1200);

    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        input: text,
        voice: body.voice || 'onyx',  // deep, authoritative male voice — JARVIS-leaning
        instructions: body.instructions ||
          'Speak as JARVIS from Iron Man — deep, low, composed, and unmistakably intelligent. Subtly British in cadence, never rushed. Add a light dry wit: a faint raised-eyebrow sarcasm that earns the line, never overplayed. Expressive but understated — the calm of someone who has already solved the problem. Crisp diction, warm undertone, confident pacing.',
        response_format: 'mp3'
      })
    });
    if (!r.ok) {
      const err = await r.text().catch(() => '');
      return res.status(502).json({ error: 'tts_failed', detail: err.slice(0, 200) });
    }
    const audio = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(audio);
  } catch (e) {
    return res.status(500).json({ error: 'exception', message: e.message });
  }
}
