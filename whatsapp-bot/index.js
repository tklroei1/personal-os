import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import { mkdirSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';

// ── Config ────────────────────────────────────────────────────────────────────
const OWNER_PHONE       = process.env.PHONE_NUMBER || '972543329092';
const OWNER_JID         = `${OWNER_PHONE}@s.whatsapp.net`;
const API_URL           = process.env.PERSONAL_OS_URL || 'https://personal-os-coral-tau.vercel.app';
const AUTH_DIR          = process.env.AUTH_DIR || './auth_state';
const GROUP_NAME        = process.env.GROUP_NAME || 'מערכת ניהול';
const GROUP_INVITE_CODE = process.env.GROUP_INVITE_CODE || 'DbDFlS8P6SBLRUeuv4W9ap';
const GROUP_JID_OVERRIDE= process.env.GROUP_JID || '';
const SIG               = ' — מערכת רואי 🤖';
const MAX_HISTORY       = 150;

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
const msgHistory    = [];

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

// ── Personal OS command parser ────────────────────────────────────────────────
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

// ── Claude AI ─────────────────────────────────────────────────────────────────
async function callClaude(userText) {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `אתה מערכת רואי, העוזר האישי של רואי קליין.
אתה פועל בקבוצת הוואטסאפ "${GROUP_NAME}".
יכולות: סיכום הודעות, ניסוח הודעות, מענה על שאלות, פקודות Personal OS.
ענה תמיד בעברית, בצורה קצרה וידידותית.
סיים כל הודעה ב: — מערכת רואי 🤖${historyBlock()}`,
      messages: [{ role: 'user', content: userText }],
    });
    return msg.content[0].text;
  } catch (err) {
    console.error('Claude error:', err.message);
    return `מצטער, שגיאה. נסה שוב.${SIG}`;
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

  const interval = setInterval(() => {
    console.log('\n\n=============================');
    console.log('PAIRING CODE: ' + code);
    console.log('=============================\n\n');
  }, 10000);

  // Stop reminding once connected (cleared in connection.update open)
  return interval;
}

// ── Bot ───────────────────────────────────────────────────────────────────────
let retryCount     = 0;
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
        // 428 = Precondition Required — socket not ready yet, retry after 30s
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

      // 428 = pairing expired — restart cleanly after 30s
      if (code === 428) {
        console.log('Connection closed (428 Precondition Required) — pairing code expired.');
        console.log('Restarting in 30s…');
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
      // Stop pairing reminders
      if (pairingInterval) { clearInterval(pairingInterval); pairingInterval = null; }

      retryCount = 0;
      console.log('✅ מערכת רואי connected — stealth mode active');

      try { await sock.sendPresenceUpdate('unavailable'); } catch {}

      await resolveGroupJid(sock);

      if (allowedGroupJid) {
        console.log(`✅ Listening only to group: ${allowedGroupJid}`);
      } else {
        console.warn('⚠️  No group JID resolved — set GROUP_JID env var manually.');
      }
    }
  });

  // ── Incoming messages ───────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const jid      = msg.key.remoteJid;
      const sender   = msg.key.participant || jid;
      const isGroup  = jid?.endsWith('@g.us');
      const isOwner  = sender.includes(OWNER_PHONE);

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption || '';

      const allowedDM    = !isGroup && isOwner;
      const allowedGroup = isGroup && jid === allowedGroupJid;

      if (!allowedDM && !allowedGroup) {
        console.log(`[ignored] ${isGroup ? 'group' : 'dm'} from ${sender.split('@')[0]}`);
        continue;
      }

      if (!text.trim()) continue;

      if (allowedGroup) {
        storeMessage(isOwner ? 'רואי' : sender.split('@')[0], text);
        const hasTrigger = TRIGGER_WORDS.some(w => text.includes(w));
        if (!isOwner && !hasTrigger) continue;
      }

      console.log(`[IN]  [${isGroup ? 'GROUP' : 'DM'}] ${text.substring(0, 80)}`);

      const osCmd = parseOsCommand(text);
      const reply = osCmd
        ? await callVercel(osCmd.action, osCmd.params || {})
        : await callClaude(text);

      await sock.sendMessage(jid, { text: reply });
      console.log(`[OUT] ${reply.substring(0, 80)}`);
    }
  });
}

startBot().catch(err => { console.error('Fatal:', err); process.exit(1); });
