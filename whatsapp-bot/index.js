// מערכת רואי — Zoro WhatsApp bot, WhatsApp Cloud API edition.
// Runs as an isolated webhook server: it ONLY ever sees messages sent to its
// own business number — zero access to Roei's personal WhatsApp chats.
import { createServer } from 'http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';

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
const SIG              = ' — מערכת רואי 🤖';
const TZ               = 'Asia/Jerusalem';

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
אתה עוזר עם תזכורות, תכנון יום, שאלות, ניסוח ועצות — בקצרה ובחום.
התאריך והשעה כעת (אסיה/ירושלים): ${localNow}.
כשרואי מבקש שתזכיר לו משהו — השתמש בכלי set_reminder עם מועד ISO מדויק
(חשב "מחר" / "היום" / "בעוד שעה" / "ביום שישי" לפי השעה הנוכחית).
ענה תמיד בעברית. סיים כל הודעה ב: — מערכת רואי 🤖`;

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
  const osCmd = parseOsCommand(text);
  const reply = osCmd
    ? await callVercel(osCmd.action, osCmd.params || {})
    : await callClaude(text);
  await sendText(from, reply);
  console.log('[OUT]', reply.slice(0, 80));
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
  console.log(`   Owner WAID : ${OWNER_WAID}`);
  console.log(`   Webhook    : /webhook  (verify token ${VERIFY_TOKEN ? 'set' : 'MISSING'})`);
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID)
    console.warn('⚠️  Set WHATSAPP_TOKEN and PHONE_NUMBER_ID to enable sending.');
});
