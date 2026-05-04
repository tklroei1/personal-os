import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import { mkdirSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';

const OWNER_JID   = `${process.env.PHONE_NUMBER}@s.whatsapp.net`;
const API_URL     = process.env.PERSONAL_OS_URL || 'https://personal-os-coral-tau.vercel.app';
const AUTH_DIR    = process.env.AUTH_DIR || './auth_state';
const SIG         = ' — מערכת רואי 🤖';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Silent logger — Baileys is very chatty by default
const noopLog = { level: 'silent', trace(){}, debug(){}, info(){}, warn(){}, error: console.error, fatal: console.error, child(){ return noopLog; } };

// ── Command parser ────────────────────────────────────────────────────────────
function parseCommand(text) {
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

// ── Vercel API call ───────────────────────────────────────────────────────────
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

// ── Claude AI fallback ────────────────────────────────────────────────────────
async function callClaude(text) {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `אתה מערכת רואי, העוזר האישי של רואי קליין. ענה תמיד בעברית, בצורה קצרה וידידותית. סיים כל הודעה ב: — מערכת רואי 🤖`,
      messages: [{ role: 'user', content: text }],
    });
    return msg.content[0].text;
  } catch (err) {
    console.error('Claude API error:', err.message);
    return `מצטער, אירעה שגיאה. נסה שוב.${SIG}`;
  }
}

// ── Bot ───────────────────────────────────────────────────────────────────────
let retryCount = 0;

async function startBot() {
  mkdirSync(AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger: noopLog,
    printQRInTerminal: false,
    getMessage: async () => ({ conversation: '' }),
  });

  // First-time pairing
  if (!state.creds.registered) {
    const phone = process.env.PHONE_NUMBER;
    if (!phone) { console.error('ERROR: PHONE_NUMBER env var not set'); process.exit(1); }
    await new Promise(r => setTimeout(r, 3000));
    const code = await sock.requestPairingCode(phone);
    console.log('\n═══════════════════════════════════════');
    console.log(`  PAIRING CODE: ${code}`);
    console.log('  WhatsApp > Linked Devices > Link a Device');
    console.log('  Tap "Link with phone number instead"');
    console.log('  Enter the code above');
    console.log('═══════════════════════════════════════\n');
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('Logged out — clear auth_state/ and restart to re-pair.');
        process.exit(1);
      }
      retryCount++;
      const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
      console.log(`Disconnected. Reconnecting in ${delay / 1000}s…`);
      setTimeout(startBot, delay);
    } else if (connection === 'open') {
      retryCount = 0;
      console.log('✅ מערכת רואי connected to WhatsApp — ready 24/7');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const jid = msg.key.remoteJid;
      if (jid !== OWNER_JID) continue; // only respond to owner

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption || '';
      if (!text) continue;

      console.log(`[IN]  ${new Date().toISOString()} ${text.substring(0, 80)}`);

      const cmd   = parseCommand(text);
      const reply = cmd ? await callVercel(cmd.action, cmd.params || {}) : await callClaude(text);

      await sock.sendMessage(jid, { text: reply });
      console.log(`[OUT] ${new Date().toISOString()} ${reply.substring(0, 80)}`);
    }
  });
}

startBot().catch(err => { console.error('Fatal:', err); process.exit(1); });
