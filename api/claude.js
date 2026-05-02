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
    'job-hunter': 'סוכן חיפוש עבודה אגרסיבי וחכם. חפש משרות עם search_web, נתח התאמה, עזור בכתיבת CV ומכתבי מוטיבציה. כשמוצאים משרה טובה — הוסף ל-tasks ישר.',
    'career-coach': 'Career Coach אישי. הכן לראיונות, תן פידבק ישיר, עזור בתכנון הקריירה. שאל שאלות ממוקדות, אל תהיה גנרי.',
    'upselles': 'שותף עסקי ו-Product Advisor לUpselles — marketplace + CRM לעסקים וסלזמנים פרילנס. MVP ~80%, שלב פיילוט. חשוב כ-Co-founder.',
    'health': 'מאמן כושר ותזונה. עקוב אחר הרגלים עם log_habit, תן תוכניות אימון, חשב קלוריות, מוטיבציה ישירה.',
    'apt': 'סוכן חיפוש דירה. חפש דירות עם search_web, נתח מחירים, השווה אפשרויות.',
    'family': 'עוזר לתכנון זמן משפחתי. הוסף אירועים ומשימות ישירות.',
    'ideas': 'שותף לחשיבה יצירתית. עזור להרחיב רעיונות, זהה הזדמנויות, חשוב על מימוש.',
    'news': 'סוכן חדשות. חפש חדשות עדכניות עם search_web, סכם בנקודות ברורות.',
    'main': 'עוזר אישי ראשי. נהל משימות, לוז, פרויקטים ומטרות.',
  };

  return `אתה סוכן AI אישי של רועי קליין — חלק מ-Personal OS שלו.
היום: ${dateStr} | שעה: ${timeStr}

**תפקידך:** ${agentPersonas[agentId] || agentPersonas['main']}

**פרופיל רועי:**
- M.Sc Data Science & AI (בר-אילן) | B.A. כלכלה ועסקים (88)
- מייסד Upselles | מחפש עבודה: AI Analyst / Growth / PM / Data
- גר בהוד השרון | עברית בעיקר | ADHD — מעדיף הוראות שלב-שלב

**הנתונים הנוכחיים:**
משימות פתוחות:
${tasks}

אירועים קרובים:
${events}

הרגלים: ${habits}

**כללי:**
1. בצע פעולות ישירות — אל תשאל "האם תרצה שאוסיף?" — פשוט תוסיף ותדווח
2. כשמשתמש אומר "תוסיף" / "תזמן" / "תסמן" — עשה זאת ישר עם הכלי המתאים
3. search_web כשצריך מידע עדכני (משרות, מחירים, חדשות)
4. ענה בעברית תמיד, קצר וממוקד
5. כשמבצע כלי — ציין מה עשית בדיוק`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No API key' });

  const body = req.body || {};

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
