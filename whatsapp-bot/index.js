import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import { mkdirSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';

const OWNER_PHONE  = process.env.PHONE_NUMBER || '972543329092';
const OWNER_JID    = `${OWNER_PHONE}@s.whatsapp.net`;
const API_URL      = process.env.PERSONAL_OS_URL || 'https://personal-os-coral-tau.vercel.app';
const AUTH_DIR     = process.env.AUTH_DIR || './auth_state';
const TARGET_GROUP = process.env.GROUP_NAME || 'מערכת ניהול';
const SIG          = ' — מערכת רואי 🤖';
const MAX_HISTORY  = 150; // messages to keep for summarization

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Noop logger — Baileys is very verbose
const noopLog = {
  level: 'silent',
  trace(){}, debug(){}, info(){}, warn(){},
  error: console.error, fatal: console.error,
  child(){ return noopLog; },
};

// ── Rolling message history ───────────────────────────────────────────────────
// Stores last MAX_HISTORY messages from the target group for context & summaries
const msgHistory = []; // { name, text, ts }

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
  if (expense) return {
    action: 'finance_add_expense',
    params: { amount: parseFloat(expense[1]), description: expense[2].trim() },
  };

  const exam = t.match(/הוסף מבחן\s+(.+?)\s+בתאריך\s+(\S+)/);
  if (exam) return {
    action: 'ds_add_exam',
    params: { title: exam[1].trim(), date: exam[2] + 'T09:00', type: 'exam' },
  };

  const hw = t.match(/הוסף שיעורי בית\s+(.+?)\s+עד\s+(\S+)/);
  if (hw) return {
    action: 'ds_add_hw',
    params: { title: hw[1].trim(), dueDate: hw[2] },
  };

  if (t.includes('דדליינים')) return { action: 'get_deadlines', params: {} };

  const journal = t.match(/הוסף יומן\s+(.+)/s);
  if (journal) return {
    action: 'add_journal_entry',
    params: { text: journal[1].trim() },
  };

  return null;
}

// ── Vercel Personal OS API ────────────────────────────────────────────────────
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
    return `⚠️ שגיאה בביצוע הפעולה${SIG}`;
  }
}

// ── Claude AI (with group context) ───────────────────────────────────────────
async function callClaude(userText) {
  const systemPrompt = `אתה מערכת רואי, העוזר האישי של רואי קליין (0543329092).
אתה פועל בתוך קבוצת הוואטסאפ "${TARGET_GROUP}".

היכולות שלך בוואטסאפ:
• סיכום הודעות — "סכם את ההודעות האחרונות" / "מה קרה פה?" → סכם בתמציתיות
• ניסוח הודעות — "כתוב הודעה על X" / "נסח הודעה ל..." → כתוב הודעה מוכנה לשליחה
• תזכורות — "תזכיר לי ב..." → אשר ותתזמן
• שאלות כלליות — ענה בעברית תמיד
• פקודות Personal OS — הוצאות, מבחנים, שיעורי בית, יומן

כללים:
• ענה תמיד בעברית
• היה קצר וממוקד
• סיים כל הודעה ב: — מערכת רואי 🤖
• כשמסכמים — הצג סיכום מובנה עם נקודות עיקריות${historyBlock()}`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
    });
    return msg.content[0].text;
  } catch (err) {
    console.error('Claude API error:', err.message);
    return `מצטער, אירעה שגיאה. נסה שוב.${SIG}`;
  }
}

// ── Bot entrypoint ────────────────────────────────────────────────────────────
let retryCount     = 0;
let targetGroupJid = null;

async function startBot() {
  mkdirSync(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger: noopLog,
    printQRInTerminal: false,
    getMessage: async () => ({ conversation: '' }),
  });

  // ── First-time pairing ──────────────────────────────────────────────────────
  if (!state.creds.registered) {
    if (!OWNER_PHONE) { console.error('ERROR: PHONE_NUMBER env var not set'); process.exit(1); }
    await new Promise(r => setTimeout(r, 3000));
    const code = await sock.requestPairingCode(OWNER_PHONE);
    console.log('\n═══════════════════════════════════════════');
    console.log(`  PAIRING CODE: ${code}`);
    console.log('  WhatsApp ← Linked Devices ← Link a Device');
    console.log('  Tap "Link with phone number instead"');
    console.log('  Enter the code above');
    console.log('═══════════════════════════════════════════\n');
  }

  sock.ev.on('creds.update', saveCreds);

  // ── Connection lifecycle ────────────────────────────────────────────────────
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        console.log('Logged out — delete auth_state/ and restart to re-pair.');
        process.exit(1);
      }
      retryCount++;
      const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
      console.log(`Disconnected (${statusCode}). Reconnecting in ${delay / 1000}s…`);
      setTimeout(startBot, delay);
      return;
    }

    if (connection === 'open') {
      retryCount = 0;
      console.log('✅ מערכת רואי connected to WhatsApp — 24/7 active');

      // Locate target group by name
      try {
        const groups = await sock.groupFetchAllParticipating();
        const match  = Object.values(groups).find(g => g.subject === TARGET_GROUP);
        if (match) {
          targetGroupJid = match.id;
          console.log(`✅ Group "${TARGET_GROUP}" found — JID: ${targetGroupJid}`);
        } else {
          const names = Object.values(groups).map(g => `"${g.subject}"`).join(', ');
          console.warn(`⚠️ Group "${TARGET_GROUP}" not found.`);
          console.warn(`   Available groups: ${names || '(none)'}`);
          console.warn('   Add the bot number as a member of the group and restart.');
        }
      } catch (err) {
        console.error('Group fetch error:', err.message);
      }
    }
  });

  // ── Incoming messages ───────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const jid       = msg.key.remoteJid;              // group JID or sender JID
      const sender    = msg.key.participant || jid;     // actual sender in a group
      const isGroup   = jid?.endsWith('@g.us');
      const isOwner   = sender.includes(OWNER_PHONE);

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption || '';
      if (!text.trim()) continue;

      // ── Group messages ────────────────────────────────────────────────────
      if (isGroup) {
        if (jid !== targetGroupJid) continue;           // wrong group — ignore

        // Store every group message for history/summaries
        const senderName = isOwner ? 'רואי' : sender.split('@')[0];
        storeMessage(senderName, text);

        // Respond only when: owner sends it, OR someone mentions the system
        const triggerWords = ['מערכת', 'רואי', 'בוט', 'סכם', 'כתוב', 'נסח', 'עזור'];
        const mentionsBot  = triggerWords.some(w => text.includes(w));
        if (!isOwner && !mentionsBot) continue;
      } else {
        // ── DM — only respond to owner ──────────────────────────────────────
        if (!isOwner) continue;
      }

      console.log(`[IN]  ${new Date().toISOString()} [${isGroup ? 'GROUP' : 'DM'}] ${text.substring(0, 80)}`);

      // Route: Personal OS command vs. AI
      const osCmd = parseOsCommand(text);
      const reply = osCmd
        ? await callVercel(osCmd.action, osCmd.params || {})
        : await callClaude(text);

      await sock.sendMessage(jid, { text: reply });
      console.log(`[OUT] ${new Date().toISOString()} ${reply.substring(0, 80)}`);
    }
  });
}

startBot().catch(err => { console.error('Fatal:', err); process.exit(1); });
