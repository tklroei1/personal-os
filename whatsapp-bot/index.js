import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';

// ── Config ────────────────────────────────────────────────────────────────────
const OWNER_PHONE       = process.env.PHONE_NUMBER || '972543329092';
const OWNER_JID         = `${OWNER_PHONE}@s.whatsapp.net`;
const API_URL           = process.env.PERSONAL_OS_URL || 'https://personal-os-coral-tau.vercel.app';
const AUTH_DIR          = process.env.AUTH_DIR || './auth_state';
const GROUP_NAME        = process.env.GROUP_NAME || 'מערכת ניהול';
const GROUP_INVITE_CODE = process.env.GROUP_INVITE_CODE || 'DbDFlS8P6SBLRUeuv4W9ap';
const GROUP_JID_OVERRIDE= process.env.GROUP_JID || '';
const REMINDERS_FILE    = process.env.REMINDERS_FILE || '/data/reminders.json';
const SIG               = ' — מערכת רואי 🤖';
const MAX_HISTORY       = 150;
const TZ                = 'Asia/Jerusalem';

const TRIGGER_WORDS = ['מערכת', 'רואי', 'סכם', 'בוט', 'עזור', 'כתוב', 'נסח', 'סיכום'];

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const noopLog = {
  level: 'silent',
  trace(){}, debug(){}, info(){}, warn(){},
  error: console.error, fatal: console.error,
  child(){ return noopLog; },
};

// ── State ─────────────────────────────────────────────────────────────────────
let allowedGroupJid = GROUP_JID_OVERRIDE || null;
let currentSock     = null;
const msgHistory    = [];        // recent group messages (for summaries)
const dmHistory     = [];        // conversation memory for the private Zoro chat
const sentIds       = [];        // ids of messages WE sent — breaks the self-chat echo loop

function rememberSent(id) {
  if (!id) return;
  sentIds.push(id);
  if (sentIds.length > 300) sentIds.splice(0, sentIds.length - 300);
}
function weSent(id) { return id && sentIds.includes(id); }

async function sendText(sock, jid, text) {
  const r = await sock.sendMessage(jid, { text });
  rememberSent(r?.key?.id);
  return r;
}

function storeMessage(name, text) {
  msgHistory.push({ name, text, ts: new Date().toISOString() });
  if (msgHistory.length > MAX_HISTORY) msgHistory.shift();
}
function historyBlock(n = 40) {
  if (!msgHistory.length) return '';
  return (
    '\n\n--- היסטוריית קבוצה (אחרונות) ---\n' +
    msgHistory.slice(-n).map(m => `[${m.name}] ${m.text}`).join('\n') +
    '\n---'
  );
}

// ── Reminders — persisted on the Railway /data volume ─────────────────────────
function loadReminders() {
  try { return existsSync(REMINDERS_FILE) ? JSON.parse(readFileSync(REMINDERS_FILE, 'utf8')) : []; }
  catch { return []; }
}
function saveReminders(list) {
  try { writeFileSync(REMINDERS_FILE, JSON.stringify(list)); }
  catch (e) { console.error('saveReminders:', e.message); }
}
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

// ── Reminder scheduler — the bot is always-on, so it IS the cron ──────────────
setInterval(async () => {
  if (!currentSock) return;
  const list = loadReminders();
  const now = Date.now();
  let changed = false;
  for (const r of list) {
    if (r.done) continue;
    const t = new Date(r.datetime).getTime();
    if (!isNaN(t) && t <= now) {
      try {
        await sendText(currentSock, OWNER_JID, `⏰ *תזכורת*\n\n${r.text}${SIG}`);
        console.log('[reminder] fired:', r.text);
        r.done = true; changed = true;
      } catch (e) { console.error('[reminder] send failed:', e.message); }
    }
  }
  if (changed) {
    const cutoff = now - 7 * 864e5;   // drop reminders done & older than 7 days
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

// ── Personal OS command parser (fast-path) ────────────────────────────────────
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

// ── Vercel API ────────────────────────────────────────────────────────────────
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
async function callClaude(userText, { isGroup, history }) {
  const localNow = nowInTz();
  const system = isGroup
    ? `אתה מערכת רואי, העוזר האישי של רואי קליין, פועל בקבוצת הוואטסאפ "${GROUP_NAME}".
יכולות: סיכום הודעות, ניסוח, מענה על שאלות, וקביעת תזכורות לרואי.
התאריך והשעה כעת (אסיה/ירושלים): ${localNow}.
ענה תמיד בעברית, קצר וידידותי. סיים כל הודעה ב: — מערכת רואי 🤖${historyBlock()}`
    : `אתה מערכת רואי (זורו), העוזר האישי של רואי קליין, בצ'אט אישי בוואטסאפ.
אתה עוזר עם תזכורות, תכנון יום, שאלות, ניסוח ועצות — בקצרה ובחום.
התאריך והשעה כעת (אסיה/ירושלים): ${localNow}.
כשרואי מבקש שתזכיר לו משהו — השתמש בכלי set_reminder עם מועד ISO מדויק
(חשב "מחר" / "היום" / "בעוד שעה" / "ביום שישי" לפי השעה הנוכחית).
ענה תמיד בעברית. סיים כל הודעה ב: — מערכת רואי 🤖`;

  const messages = [...(history || []), { role: 'user', content: userText }];
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
    // keep lightweight conversation memory for the private chat
    if (history) {
      history.push({ role: 'user', content: userText });
      history.push({ role: 'assistant', content: finalText });
      while (history.length > 20) history.shift();
    }
    return finalText;
  } catch (err) {
    console.error('Claude error:', err.message);
    return `מצטער, הייתה שגיאה. נסה שוב.${SIG}`;
  }
}

// ── Resolve allowed group JID ─────────────────────────────────────────────────
async function resolveGroupJid(sock) {
  if (allowedGroupJid) {
    console.log(`[group] Using configured JID: ${allowedGroupJid}`);
    return;
  }
  try {
    const groups = await sock.groupFetchAllParticipating();
    const byName = Object.values(groups).find(g => g.subject === GROUP_NAME);
    if (byName) {
      allowedGroupJid = byName.id;
      console.log(`[group] Found "${GROUP_NAME}" by name: ${allowedGroupJid}`);
      return;
    }
  } catch (e) { console.error('[group] groupFetchAllParticipating error:', e.message); }

  if (GROUP_INVITE_CODE) {
    try {
      const info = await sock.groupGetInviteInfo(GROUP_INVITE_CODE);
      allowedGroupJid = info.id;
      console.log(`[group] Resolved from invite code: ${allowedGroupJid} ("${info.subject}")`);
      return;
    } catch (e) { console.error('[group] groupGetInviteInfo error:', e.message); }

    try {
      const joined = await sock.groupAcceptInvite(GROUP_INVITE_CODE);
      allowedGroupJid = joined;
      console.log(`[group] Joined group via invite: ${allowedGroupJid}`);
    } catch (e) {
      console.error('[group] groupAcceptInvite error:', e.message);
      console.error('[group] ⚠️  Set GROUP_JID env var manually.');
    }
  }
}

// ── Pairing code — prints repeatedly until paired ─────────────────────────────
function startPairingReminder(code) {
  console.log('\n\n=============================');
  console.log('PAIRING CODE: ' + code);
  console.log('=============================');
  console.log('WhatsApp → Linked Devices → Link a Device');
  console.log('Tap "Link with phone number instead"\n\n');

  return setInterval(() => {
    console.log('\n\n=============================');
    console.log('PAIRING CODE: ' + code);
    console.log('=============================\n\n');
  }, 10000);
}

// ── Bot ───────────────────────────────────────────────────────────────────────
let retryCount      = 0;
let pairingInterval = null;

async function startBot() {
  mkdirSync(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger: noopLog,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    connectTimeoutMs: 60000,
    retryRequestDelayMs: 5000,
    maxRetries: 5,
    getMessage: async () => ({ conversation: '' }),
  });

  // ── First-time pairing ──────────────────────────────────────────────────────
  if (!state.creds.registered) {
    if (!OWNER_PHONE) { console.error('ERROR: PHONE_NUMBER not set'); process.exit(1); }
    console.log('Waiting 5s before requesting pairing code…');
    await new Promise(r => setTimeout(r, 5000));

    let pairingAttempt = 0;
    const tryPairing = async () => {
      pairingAttempt++;
      console.log(`Requesting pairing code (attempt ${pairingAttempt})…`);
      try {
        const code = await sock.requestPairingCode(OWNER_PHONE);
        if (pairingInterval) clearInterval(pairingInterval);
        pairingInterval = startPairingReminder(code);
      } catch (err) {
        const status = err?.output?.statusCode || err?.status || 0;
        console.error(`Pairing request failed (${status}): ${err.message}`);
        console.log('Retrying pairing in 30s…');
        setTimeout(tryPairing, 30000);
      }
    };
    await tryPairing();
  }

  sock.ev.on('creds.update', saveCreds);

  // ── Connection lifecycle ────────────────────────────────────────────────────
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;

      if (code === DisconnectReason.loggedOut) {
        console.log('Logged out — delete auth_state/ and restart to re-pair.');
        process.exit(1);
      }
      if (code === 428) {
        console.log('Connection closed (428) — pairing code expired. Restarting in 30s…');
        setTimeout(startBot, 30000);
        return;
      }
      retryCount++;
      const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
      console.log(`Disconnected (${code}). Reconnecting in ${delay / 1000}s…`);
      setTimeout(startBot, delay);
      return;
    }

    if (connection === 'open') {
      if (pairingInterval) { clearInterval(pairingInterval); pairingInterval = null; }
      retryCount  = 0;
      currentSock = sock;     // scheduler can now deliver reminders
      console.log('✅ מערכת רואי connected — stealth mode active');

      try { await sock.sendPresenceUpdate('unavailable'); } catch {}

      await resolveGroupJid(sock);
      if (allowedGroupJid) console.log(`✅ Listening to group: ${allowedGroupJid}`);
      else console.warn('⚠️  No group JID resolved — set GROUP_JID env var manually.');
      console.log(`✅ Private Zoro chat active on self-chat: ${OWNER_JID}`);
    }
  });

  // ── Incoming messages ───────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      const jid = msg.key.remoteJid;
      if (!jid) continue;

      const isGroup    = jid.endsWith('@g.us');
      const isSelfChat = !isGroup && jid === OWNER_JID;   // WhatsApp "Message Yourself"

      // skip our own echoed sends — breaks the self-chat reply loop
      if (weSent(msg.key.id)) continue;
      // skip own messages everywhere EXCEPT the self-chat (that one is the Zoro DM)
      if (msg.key.fromMe && !isSelfChat) continue;

      const sender  = msg.key.participant || jid;
      const isOwner = sender.includes(OWNER_PHONE);

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption || '';
      if (!text.trim()) continue;

      // belt-and-suspenders: never react to a message that is itself a bot reply
      if (text.includes('— מערכת רואי')) continue;

      const allowedGroup = isGroup && jid === allowedGroupJid;
      const allowedDM    = isSelfChat;

      if (!allowedGroup && !allowedDM) {
        console.log(`[ignored] ${isGroup ? 'group' : 'dm'} from ${sender.split('@')[0]}`);
        continue;
      }

      if (allowedGroup) {
        storeMessage(isOwner ? 'רואי' : sender.split('@')[0], text);
        const hasTrigger = TRIGGER_WORDS.some(w => text.includes(w));
        if (!isOwner && !hasTrigger) continue;
      }

      console.log(`[IN] [${isGroup ? 'GROUP' : 'SELF'}] ${text.slice(0, 80)}`);

      const osCmd = parseOsCommand(text);
      let reply;
      if (osCmd) {
        reply = await callVercel(osCmd.action, osCmd.params || {});
      } else {
        reply = await callClaude(text, { isGroup, history: isSelfChat ? dmHistory : null });
      }

      await sendText(sock, jid, reply);
      console.log(`[OUT] ${reply.slice(0, 80)}`);
    }
  });
}

startBot().catch(err => { console.error('Fatal:', err); process.exit(1); });
