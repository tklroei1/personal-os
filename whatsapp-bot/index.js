// מערכת רואי — Zoro WhatsApp bot, WhatsApp Cloud API edition.
// Runs as an isolated webhook server: it ONLY ever sees messages sent to its
// own business number — zero access to Roei's personal WhatsApp chats.
import { createServer } from 'http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { setJobHuntSend, startJobHuntScheduler, runJobHunt } from './job-hunt-agent.js';

// ── Config ────────────────────────────────────────────────────────────────────
const PORT             = process.env.PORT || 3000;
const GRAPH_VERSION    = process.env.GRAPH_VERSION || 'v21.0';
const WHATSAPP_TOKEN   = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID  = process.env.PHONE_NUMBER_ID || '';
const VERIFY_TOKEN     = process.env.VERIFY_TOKEN || 'zoro-verify';
const OWNER_WAID       = (process.env.OWNER_WAID || process.env.PHONE_NUMBER || '972543329092').replace(/\D/g, '');
const REMINDER_TEMPLATE= process.env.REMINDER_TEMPLATE || '';   // optional approved template for >24h sends
const TEMPLATE_LANG    = process.env.TEMPLATE_LANG || 'he';
const API_URL          = process.env.PERSONAL_OS_URL || 'https://personal-os-coral-tau.vercel.app';
const DATA_DIR         = process.env.DATA_DIR || '/data';
const REMINDERS_FILE   = `${DATA_DIR}/reminders.json`;
const STATE_FILE       = `${DATA_DIR}/bot-state.json`;
const POS_STATE_FILE   = `${DATA_DIR}/pos-state.json`;   // mirror of the browser's S object — cross-device sync
const SIG              = ' — מערכת רואי 🤖';
const TZ               = 'Asia/Jerusalem';
const MCP_TOKEN        = process.env.MCP_TOKEN || '';   // bearer token for Claude MCP connector — leave empty to disable auth

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}

// ── Persistence helpers ───────────────────────────────────────────────────────
function readJson(file, fallback) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback; }
  catch { return fallback; }
}
function writeJson(file, data) {
  try { writeFileSync(file, JSON.stringify(data)); }
  catch (e) { console.error('write', file, e.message); }
}

let botState = readJson(STATE_FILE, { lastInboundAt: 0 });
function saveState() { writeJson(STATE_FILE, botState); }

const dmHistory       = [];   // conversation memory for the chat
const processedMsgIds = [];   // de-dupe Meta webhook retries
function seen(id) {
  if (!id) return false;
  if (processedMsgIds.includes(id)) return true;
  processedMsgIds.push(id);
  if (processedMsgIds.length > 400) processedMsgIds.splice(0, processedMsgIds.length - 400);
  return false;
}

// ── Reminders — persisted on the Railway /data volume ─────────────────────────
function loadReminders() { return readJson(REMINDERS_FILE, []); }
function saveReminders(list) { writeJson(REMINDERS_FILE, list); }
function addReminderRecord(text, datetime) {
  const list = loadReminders();
  const rec = {
    id: Date.now().toString(36),
    text, datetime, done: false,
    created: new Date().toISOString(),
  };
  list.push(rec);
  saveReminders(list);
  return rec;
}
function fmtWhen(iso) {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}
function nowInTz() {
  return new Date().toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T');
}

// ── WhatsApp Cloud API senders ────────────────────────────────────────────────
async function graphSend(payload) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.warn('[wa] missing WHATSAPP_TOKEN / PHONE_NUMBER_ID — cannot send');
    return false;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('[wa] send failed', res.status, (await res.text()).slice(0, 220));
      return false;
    }
    return true;
  } catch (e) { console.error('[wa] send error', e.message); return false; }
}
function sendText(toWaid, text) {
  return graphSend({
    messaging_product: 'whatsapp', to: toWaid, type: 'text',
    text: { body: text, preview_url: false },
  });
}
function sendTemplate(toWaid, name, params) {
  return graphSend({
    messaging_product: 'whatsapp', to: toWaid, type: 'template',
    template: {
      name, language: { code: TEMPLATE_LANG },
      components: params && params.length
        ? [{ type: 'body', parameters: params.map(t => ({ type: 'text', text: String(t) })) }]
        : [],
    },
  });
}
// A reminder may fire outside the 24h customer-service window — fall back to a
// pre-approved template when free-form text is not allowed.
async function deliverReminder(text) {
  const within24h = Date.now() - (botState.lastInboundAt || 0) < 24 * 3600 * 1000;
  const body = `⏰ *תזכורת*\n\n${text}${SIG}`;
  if (within24h && await sendText(OWNER_WAID, body)) return true;
  if (REMINDER_TEMPLATE && await sendTemplate(OWNER_WAID, REMINDER_TEMPLATE, [text])) return true;
  if (!within24h && await sendText(OWNER_WAID, body)) return true;   // last resort
  return false;
}

// ── Reminder scheduler — checks every 30s, the always-on bot is the cron ──────
setInterval(async () => {
  const list = loadReminders();
  const now = Date.now();
  let changed = false;
  for (const r of list) {
    if (r.done) continue;
    const t = new Date(r.datetime).getTime();
    if (!isNaN(t) && t <= now) {
      const ok = await deliverReminder(r.text);
      if (ok) { console.log('[reminder] fired:', r.text); r.done = true; changed = true; }
      else    { console.warn('[reminder] delivery failed, will retry:', r.text); }
    }
  }
  if (changed) {
    const cutoff = now - 7 * 864e5;
    saveReminders(list.filter(r => !r.done || new Date(r.created).getTime() > cutoff));
  }
}, 30000);

// ── Tools Claude can call ─────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'set_reminder',
    description: 'קובע תזכורת שתישלח לרואי בוואטסאפ בזמן הנקוב. השתמש בכל פעם שרואי מבקש שתזכיר לו משהו.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'תוכן התזכורת' },
        datetime: { type: 'string', description: 'מועד התזכורת בפורמט ISO 8601 מקומי, למשל 2026-05-23T18:00' },
      },
      required: ['text', 'datetime'],
    },
  },
  {
    name: 'list_reminders',
    description: 'מחזיר את כל התזכורות העתידיות שטרם נשלחו.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_reminder',
    description: 'מבטל תזכורת לפי המזהה שלה (id מתוך list_reminders).',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'מזהה התזכורת' } },
      required: ['id'],
    },
  },
  {
    name: 'run_job_hunt',
    description: 'מפעיל את סוכן ציד המשרות: סורק משרות טריות בלינקדאין (סטודנט/ג\'וניור, AI/Product/פיננסים בישראל), מנקד אותן מול הפרופיל של רואי, מעלה התאמות ≥70% ל-Personal OS ושולח דוח בוואטסאפ תוך כ-2 דקות. השתמש בכלי הזה בכל פעם שרואי מבקש לחפש משרות/עבודה/ג\'ובים או לבדוק אם יש משרות חדשות.',
    input_schema: { type: 'object', properties: {} },
  },
];

function runTool(name, input) {
  if (name === 'set_reminder') {
    if (!input.text || !input.datetime) return 'חסרים פרטים לתזכורת';
    const rec = addReminderRecord(input.text, input.datetime);
    return `נקבעה תזכורת (${rec.id}) ל-${fmtWhen(rec.datetime)}: ${rec.text}`;
  }
  if (name === 'list_reminders') {
    const list = loadReminders().filter(r => !r.done);
    if (!list.length) return 'אין תזכורות עתידיות.';
    return list.map(r => `• [${r.id}] ${fmtWhen(r.datetime)} — ${r.text}`).join('\n');
  }
  if (name === 'cancel_reminder') {
    const list = loadReminders();
    const r = list.find(x => x.id === input.id && !x.done);
    if (!r) return 'לא נמצאה תזכורת עם המזהה הזה.';
    r.done = true; saveReminders(list);
    return `התזכורת בוטלה: ${r.text}`;
  }
  if (name === 'run_job_hunt') {
    runJobHunt(t => sendText(OWNER_WAID, t), { force: true })
      .catch(e => sendText(OWNER_WAID, `⚠️ שגיאה בציד משרות: ${e.message}${SIG}`));
    return 'ציד המשרות הופעל ברקע — דוח מלא יישלח לרואי בוואטסאפ תוך כ-2 דקות. אמור לו שזה רץ.';
  }
  return 'כלי לא מוכר';
}

// ── Personal OS command fast-path ─────────────────────────────────────────────
function parseOsCommand(text) {
  const t = text.trim();
  const expense = t.match(/הוסף הוצאה\s+(\d+(?:\.\d+)?)\s+(.+)/);
  if (expense) return { action: 'finance_add_expense', params: { amount: parseFloat(expense[1]), description: expense[2].trim() } };
  const exam = t.match(/הוסף מבחן\s+(.+?)\s+בתאריך\s+(\S+)/);
  if (exam) return { action: 'ds_add_exam', params: { title: exam[1].trim(), date: exam[2] + 'T09:00', type: 'exam' } };
  const hw = t.match(/הוסף שיעורי בית\s+(.+?)\s+עד\s+(\S+)/);
  if (hw) return { action: 'ds_add_hw', params: { title: hw[1].trim(), dueDate: hw[2] } };
  if (t.includes('דדליינים')) return { action: 'get_deadlines', params: {} };
  const journal = t.match(/הוסף יומן\s+(.+)/s);
  if (journal) return { action: 'add_journal_entry', params: { text: journal[1].trim() } };
  return null;
}
async function callVercel(action, params) {
  try {
    const res  = await fetch(`${API_URL}/api/whatsapp-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, params }),
    });
    const data = await res.json();
    return data.response || `✅ הפעולה בוצעה${SIG}`;
  } catch (err) {
    console.error('Vercel API error:', err.message);
    return `⚠️ שגיאה${SIG}`;
  }
}

// ── Claude — with a tool-use loop ─────────────────────────────────────────────
async function callClaude(userText) {
  const localNow = nowInTz();
  const system = `אתה מערכת רואי (זורו), העוזר האישי של רואי קליין, בצ'אט וואטסאפ פרטי.
התאריך והשעה כעת (אסיה/ירושלים): ${localNow}.

היכולות שלך (יש לך כלים אמיתיים — השתמש בהם, אל תגיד שאתה לא יכול):
1. ציד משרות 🎯 — הכלי run_job_hunt סורק לינקדאין, מנקד משרות מול הפרופיל של רואי (סטודנט M.Sc, AI/Product/פיננסים), מעלה התאמות ל-Personal OS ושולח דוח. הפעל אותו בכל בקשה לחיפוש משרות/עבודה. הסוכן גם רץ אוטומטית כל יום ב-09:00 וב-17:00.
2. תזכורות ⏰ — set_reminder / list_reminders / cancel_reminder (חשב "מחר"/"בעוד שעה"/"ביום שישי" לפי השעה הנוכחית, מועד בפורמט ISO).
3. פקודות Personal OS 📱 — אם רואי כותב בפורמט המדויק, זה נקלט אוטומטית: "הוסף הוצאה 50 קפה", "הוסף מבחן X בתאריך YYYY-MM-DD", "הוסף שיעורי בית X עד YYYY-MM-DD", "הוסף יומן טקסט", "מה הדדליינים השבוע?".
4. שיחה חופשית — תכנון יום, ניסוח, עצות, שאלות.

המערכת של רואי: https://personal-os-coral-tau.vercel.app
ענה תמיד בעברית, בקצרה ובחום. סיים כל הודעה ב: — מערכת רואי 🤖`;

  const messages = [...dmHistory, { role: 'user', content: userText }];
  try {
    let finalText = '';
    for (let i = 0; i < 5; i++) {
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system,
        tools: TOOLS,
        messages,
      });
      if (msg.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: msg.content });
        const results = [];
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            let out;
            try { out = runTool(block.name, block.input || {}); }
            catch (e) { out = 'שגיאה בכלי: ' + e.message; }
            console.log(`[tool] ${block.name} → ${String(out).slice(0, 60)}`);
            results.push({ type: 'tool_result', tool_use_id: block.id, content: String(out) });
          }
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      finalText = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      break;
    }
    finalText = finalText || `בוצע.${SIG}`;
    dmHistory.push({ role: 'user', content: userText });
    dmHistory.push({ role: 'assistant', content: finalText });
    while (dmHistory.length > 20) dmHistory.shift();
    return finalText;
  } catch (err) {
    console.error('Claude error:', err.message);
    return `מצטער, הייתה שגיאה. נסה שוב.${SIG}`;
  }
}

// ── Handle one inbound message ────────────────────────────────────────────────
async function handleInbound(from, text) {
  botState.lastInboundAt = Date.now();
  saveState();
  // Manual trigger: "חפש משרות" / "חפש עבודה" runs the job-hunt agent on demand
  if (/^חפש (משרות|עבודה)/.test((text || '').trim())) {
    await sendText(from, `🔎 מתחיל ציד משרות... זה לוקח כ-2 דקות${SIG}`);
    runJobHunt(t => sendText(OWNER_WAID, t), { force: true })
      .catch(e => sendText(OWNER_WAID, `⚠️ שגיאה בציד משרות: ${e.message}${SIG}`));
    return;
  }
  const osCmd = parseOsCommand(text);
  const reply = osCmd
    ? await callVercel(osCmd.action, osCmd.params || {})
    : await callClaude(text);
  await sendText(from, reply);
  console.log('[OUT]', reply.slice(0, 80));
}

// ── MCP server — exposes Personal OS tools to Claude.ai via Connectors ───────
// JSON-RPC 2.0 over Streamable HTTP at POST /mcp (and GET /mcp for SSE stream).
// Configure in Claude.ai → Settings → Connectors → Add custom connector:
//   URL:  https://<your-railway-domain>/mcp
//   Auth: Bearer <MCP_TOKEN>   (only if MCP_TOKEN env var is set)

const MCP_TOOLS = [
  {
    name: 'set_reminder',
    description: 'קובע תזכורת שתישלח לרואי בזמן הנקוב (וגם תופיע ביומן ובטלפון).',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'תוכן התזכורת' },
        datetime: { type: 'string', description: 'מועד בפורמט ISO 8601 מקומי, למשל 2026-05-23T18:00' },
      },
      required: ['text', 'datetime'],
    },
  },
  {
    name: 'list_reminders',
    description: 'מחזיר את כל התזכורות העתידיות שטרם נשלחו.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_reminder',
    description: 'מבטל תזכורת לפי המזהה שלה.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'מזהה התזכורת' } },
      required: ['id'],
    },
  },
  {
    name: 'add_journal_entry',
    description: 'מוסיף רשומה ליומן האישי של רואי ב-Personal OS.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'תוכן הרשומה' } },
      required: ['text'],
    },
  },
  {
    name: 'add_expense',
    description: 'רושם הוצאה ב-Personal OS.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'סכום בשקלים' },
        description: { type: 'string', description: 'תיאור ההוצאה' },
      },
      required: ['amount', 'description'],
    },
  },
  {
    name: 'add_exam',
    description: 'מוסיף מבחן ל-Personal OS עם תאריך.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'שם הקורס/המבחן' },
        date: { type: 'string', description: 'תאריך בפורמט YYYY-MM-DD' },
      },
      required: ['title', 'date'],
    },
  },
  {
    name: 'add_homework',
    description: 'מוסיף שיעורי בית עם דדליין ל-Personal OS.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'תיאור המשימה' },
        dueDate: { type: 'string', description: 'תאריך אחרון בפורמט YYYY-MM-DD' },
      },
      required: ['title', 'dueDate'],
    },
  },
  {
    name: 'get_deadlines',
    description: 'מחזיר את כל הדדליינים הקרובים מ-Personal OS (מבחנים ושיעורי בית).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_task',
    description: 'מוסיף משימה חדשה לרשימת המשימות של רואי.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'תיאור המשימה' },
        proj: { type: 'string', description: 'פרויקט (jobs/health/family/apartment/none)' },
        cat:  { type: 'string', description: 'קטגוריה (work/health/family/home/project)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'add_event',
    description: 'מוסיף אירוע ללוז השבועי של רואי.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        date:  { type: 'string', description: 'YYYY-MM-DD' },
        time:  { type: 'string', description: 'HH:MM' },
      },
      required: ['title', 'date'],
    },
  },
  {
    name: 'add_note',
    description: 'שומר פתק.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, content: { type: 'string' } },
      required: ['content'],
    },
  },
  {
    name: 'add_idea',
    description: 'שומר רעיון.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'add_goal',
    description: 'מוסיף מטרה.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'add_job',
    description: 'מוסיף משרה למעקב חיפוש העבודה.',
    inputSchema: {
      type: 'object',
      properties: {
        title:   { type: 'string' },
        company: { type: 'string' },
        status:  { type: 'string' },
        link:    { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'add_apartment',
    description: 'מוסיף דירה למעקב חיפוש הדירה.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'כתובת/תיאור' },
        price: { type: 'string' },
        area:  { type: 'string' },
        link:  { type: 'string' },
      },
      required: ['title'],
    },
  },
];

// Forward a write action to the Vercel webhook so the Personal OS PWA picks
// it up via its existing 30s polling — keeps the app's data in sync.
async function forwardToVercel(action, params) {
  try {
    const r = await fetch(`${API_URL}/api/whatsapp-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, params: params || {} }),
    });
    const d = await r.json().catch(() => ({}));
    return d.response || 'בוצע ✓';
  } catch (e) {
    return 'שגיאה: ' + e.message;
  }
}

async function mcpRunTool(name, args) {
  args = args || {};
  let text;
  let isError = false;
  try {
    if (name === 'set_reminder') {
      if (!args.text || !args.datetime) text = 'חסרים פרטים';
      else {
        const rec = addReminderRecord(args.text, args.datetime);
        // Also push into Personal OS so the PWA shows it AND syncs to
        // Google Calendar (which gives a native iPhone notification).
        const dt = new Date(args.datetime);
        const date = isNaN(dt) ? '' : dt.toISOString().split('T')[0];
        const time = isNaN(dt) ? '' : dt.toTimeString().slice(0, 5);
        forwardToVercel('add_reminder', { text: args.text, date, time }).catch(() => {});
        text = `נקבעה תזכורת (${rec.id}) ל-${fmtWhen(rec.datetime)}: ${rec.text}`;
      }
    } else if (name === 'list_reminders') {
      const list = loadReminders().filter(r => !r.done);
      text = list.length
        ? list.map(r => `• [${r.id}] ${fmtWhen(r.datetime)} — ${r.text}`).join('\n')
        : 'אין תזכורות עתידיות.';
    } else if (name === 'cancel_reminder') {
      const list = loadReminders();
      const r = list.find(x => x.id === args.id && !x.done);
      if (!r) { text = 'תזכורת לא נמצאה'; }
      else { r.done = true; saveReminders(list); text = `בוטלה: ${r.text}`; }
    } else if (name === 'add_journal_entry') {
      text = await forwardToVercel('add_journal_entry', { text: args.text || '' });
    } else if (name === 'add_expense') {
      text = await forwardToVercel('finance_add_expense', {
        amount: args.amount, description: args.description || '',
      });
    } else if (name === 'add_exam') {
      text = await forwardToVercel('ds_add_exam', {
        title: args.title, date: (args.date || '') + 'T09:00', type: 'exam',
      });
    } else if (name === 'add_homework') {
      text = await forwardToVercel('ds_add_hw', {
        title: args.title, dueDate: args.dueDate,
      });
    } else if (name === 'get_deadlines') {
      try {
        const r = await fetch(`${API_URL}/api/whatsapp-command?action=get_deadlines`);
        const d = await r.json().catch(() => ({}));
        text = d.response || 'אין מידע על דדליינים.';
      } catch (e) { text = 'שגיאה: ' + e.message; isError = true; }
    } else if ([
      'add_task','add_event','add_note','add_idea','add_goal','add_job','add_apartment',
    ].includes(name)) {
      text = await forwardToVercel(name, args);
    } else {
      text = 'כלי לא מוכר: ' + name;
      isError = true;
    }
  } catch (e) {
    text = 'שגיאה בכלי: ' + e.message;
    isError = true;
  }
  return { content: [{ type: 'text', text: String(text) }], isError };
}

function mcpUnauthorized(res) {
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Bearer',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify({ error: 'unauthorized' }));
}

async function handleMcpPost(req, res, raw) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (MCP_TOKEN) {
    const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const qs = new URL(req.url, 'http://x').searchParams.get('token') || '';
    if (auth !== MCP_TOKEN && qs !== MCP_TOKEN) return mcpUnauthorized(res);
  }
  let msg;
  try { msg = JSON.parse(raw); }
  catch { res.writeHead(400); return res.end('bad json'); }

  const batch = Array.isArray(msg) ? msg : [msg];
  const responses = [];
  for (const m of batch) {
    const id = m.id;
    let result, error;
    try {
      switch (m.method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'personal-os-mcp', version: '1.0.0' },
          };
          break;
        case 'notifications/initialized':
          continue;   // no response for notifications
        case 'tools/list':
          result = { tools: MCP_TOOLS };
          break;
        case 'tools/call': {
          const { name, arguments: args } = m.params || {};
          console.log(`[mcp] tool ${name}`, JSON.stringify(args || {}).slice(0, 120));
          result = await mcpRunTool(name, args);
          break;
        }
        case 'ping':
          result = {};
          break;
        default:
          error = { code: -32601, message: 'method not found: ' + m.method };
      }
    } catch (e) {
      error = { code: -32603, message: e.message };
    }
    if (id !== undefined) {
      responses.push(error
        ? { jsonrpc: '2.0', id, error }
        : { jsonrpc: '2.0', id, result });
    }
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(responses.length ? JSON.stringify(Array.isArray(msg) ? responses : responses[0]) : '');
}

// ── Personal OS state sync — cross-device storage of the browser's S object ──
function handleSync(req, res, raw) {
  // CORS headers FIRST — preflight OPTIONS arrives without the Authorization
  // header, so handling it before the auth check is essential.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // Auth — reuse MCP_TOKEN (set to enable). When unset, the endpoint is open;
  // OK for a personal use case behind a hard-to-guess Railway domain, but
  // strongly recommended to set MCP_TOKEN in Railway env vars.
  if (MCP_TOKEN) {
    const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const qs   = new URL(req.url, 'http://x').searchParams.get('token') || '';
    if (auth !== MCP_TOKEN && qs !== MCP_TOKEN) return mcpUnauthorized(res);
  }

  if (req.method === 'GET') {
    const stored = readJson(POS_STATE_FILE, null);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(stored || { state: null, ts: 0 }));
  }

  if (req.method === 'POST') {
    let body;
    try { body = JSON.parse(raw); }
    catch { res.writeHead(400); return res.end('bad json'); }
    if (!body || typeof body !== 'object' || !body.state) {
      res.writeHead(400); return res.end('missing state');
    }
    const ts = Number(body.ts) || Date.now();
    writeJson(POS_STATE_FILE, { state: body.state, ts });
    console.log(`[sync] saved (${JSON.stringify(body.state).length} bytes)`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ts }));
  }

  res.writeHead(405); res.end('method not allowed');
}

function handleMcpStream(req, res) {
  if (MCP_TOKEN) {
    const qs = new URL(req.url, 'http://x').searchParams.get('token') || '';
    const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    if (qs !== MCP_TOKEN && auth !== MCP_TOKEN) return mcpUnauthorized(res);
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(': mcp-stream\n\n');
  const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch {} }, 25000);
  req.on('close', () => clearInterval(ka));
}

// ── HTTP server — Meta Cloud API webhook ──────────────────────────────────────
function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(b));
    req.on('error', () => resolve(''));
  });
}

const server = createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { res.writeHead(400); return res.end('bad request'); }

  // health check
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('Zoro WhatsApp bot — ok');
  }

  // MCP endpoint — Claude.ai consumer Connectors / desktop / MCP clients
  if (url.pathname === '/mcp' || url.pathname === '/sse') {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      return res.end();
    }
    if (req.method === 'POST') {
      const raw = await readBody(req);
      return handleMcpPost(req, res, raw);
    }
    if (req.method === 'GET') return handleMcpStream(req, res);
    res.writeHead(405); return res.end('method not allowed');
  }

  // Cross-device state sync for the Personal OS PWA
  if (url.pathname === '/sync') {
    const raw = req.method === 'POST' ? await readBody(req) : '';
    return handleSync(req, res, raw);
  }

  // On-demand job hunt — triggered by the in-app "run now" button
  if (url.pathname === '/run-jobhunt') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    runJobHunt(t => sendText(OWNER_WAID, t), { force: true })
      .catch(e => sendText(OWNER_WAID, `⚠️ שגיאה בציד משרות: ${e.message}${SIG}`));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, msg: 'ציד משרות הופעל — דוח יישלח לוואטסאפ תוך כ-2 דקות' }));
  }

  // Meta webhook verification handshake
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const mode      = url.searchParams.get('hub.mode');
    const token     = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[webhook] verified');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(challenge || '');
    }
    res.writeHead(403);
    return res.end('forbidden');
  }

  // Meta webhook — incoming messages
  if (req.method === 'POST' && url.pathname === '/webhook') {
    const raw = await readBody(req);
    res.writeHead(200);
    res.end('ok');                      // ack fast — Meta requires a quick 200
    let body;
    try { body = JSON.parse(raw); } catch { return; }
    try {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value || {};
          for (const m of value.messages || []) {
            if (seen(m.id)) continue;
            const from = (m.from || '').replace(/\D/g, '');
            if (from !== OWNER_WAID) {        // private assistant — owner only
              console.log('[ignored] message from', from);
              continue;
            }
            const text =
              m.text?.body ||
              m.button?.text ||
              m.interactive?.list_reply?.title ||
              m.interactive?.button_reply?.title || '';
            if (!text.trim()) continue;
            console.log('[IN]', text.slice(0, 80));
            await handleInbound(from, text.trim());
          }
        }
      }
    } catch (e) { console.error('[webhook] process error', e.message); }
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`✅ Zoro WhatsApp (Cloud API) listening on :${PORT}`);
  // Job-hunt agent: 09:00 + 17:00 Asia/Jerusalem reports to Roei
  setJobHuntSend(async (t) => {
    const ok = await sendText(OWNER_WAID, t);
    if (!ok && REMINDER_TEMPLATE) await sendTemplate(OWNER_WAID, REMINDER_TEMPLATE, [t.slice(0, 500)]);
    return ok;
  });
  startJobHuntScheduler();
  console.log(`   Owner WAID : ${OWNER_WAID}`);
  console.log(`   Webhook    : /webhook  (verify token ${VERIFY_TOKEN ? 'set' : 'MISSING'})`);
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID)
    console.warn('⚠️  Set WHATSAPP_TOKEN and PHONE_NUMBER_ID to enable sending.');
});
