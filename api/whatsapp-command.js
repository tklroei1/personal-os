// api/whatsapp-command.js — WhatsApp command bridge for Personal OS
// Called by Claude Code (via whatsapp-claude-plugin) to execute Personal OS actions.
// Write actions queue to /api/webhook; read actions use a local deadline snapshot.
import { readFileSync, writeFileSync, existsSync } from 'fs';

const DEADLINE_CACHE = '/tmp/pos_deadlines.json';

function readDeadlines() {
  try {
    if (!existsSync(DEADLINE_CACHE)) return null;
    const { data, ts } = JSON.parse(readFileSync(DEADLINE_CACHE, 'utf8'));
    if (Date.now() - ts > 3600000) return null; // 1h TTL
    return data;
  } catch { return null; }
}

function writeDeadlines(data) {
  try { writeFileSync(DEADLINE_CACHE, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

function formatDeadlines(dl) {
  const now = new Date();
  const week = new Date(); week.setDate(week.getDate() + 7);
  const hw = (dl.homework || []).filter(h =>
    h.status !== 'done' && new Date(h.dueDate) >= now && new Date(h.dueDate) <= week
  );
  const exams = (dl.exams || []).filter(e =>
    new Date(e.date) >= now && new Date(e.date) <= week
  );
  if (!hw.length && !exams.length) return '✅ אין דדליינים השבוע!';
  let msg = '📅 *דדליינים השבוע:*\n\n';
  if (exams.length) {
    msg += '*מבחנים:*\n';
    exams.forEach(e => { msg += `• ${e.title} — ${(e.date || '').split('T')[0]}\n`; });
    msg += '\n';
  }
  if (hw.length) {
    msg += '*שיעורי בית:*\n';
    hw.forEach(h => { msg += `• ${h.title} — ${h.dueDate}\n`; });
  }
  return msg.trim();
}

const SIG = ' — מערכת רואי 🤖';

const RESPONSES = {
  ds_add_exam: p => `✅ מבחן "${p.title}" נוסף ל-${(p.date || '').split('T')[0]}${SIG}`,
  ds_add_hw: p => `✅ שיעורי בית "${p.title}" נוספו עד ${p.dueDate}${SIG}`,
  finance_add_expense: p => `✅ הוצאה של ₪${p.amount} — ${p.description || p.merchant || ''} נרשמה${SIG}`,
  add_journal_entry: () => `✅ ערך יומן נוסף${SIG}`,
};
const WRITE_ACTIONS = new Set(['ds_add_exam', 'ds_add_hw', 'finance_add_expense', 'add_journal_entry']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET ?action=get_deadlines — Claude Code polls this to answer deadline queries
  if (req.method === 'GET') {
    if (req.query?.action === 'get_deadlines') {
      const dl = readDeadlines();
      if (dl) return res.status(200).json({ ok: true, response: formatDeadlines(dl) });
      return res.status(200).json({
        ok: true,
        response: 'פתח את האפליקציה פעם אחת (https://personal-os-coral-tau.vercel.app) כדי לסנכרן דדליינים, ואז שאל שוב. — מערכת רואי 🤖'
      });
    }
    return res.status(400).json({ error: 'Missing ?action=get_deadlines' });
  }

  if (req.method !== 'POST') return res.status(405).end();
  const { action, params = {} } = req.body || {};

  // Frontend pushes deadline snapshot on app open
  if (action === 'push_state') {
    writeDeadlines(params);
    return res.status(200).json({ ok: true });
  }

  // Deadline query via POST (alternate form)
  if (action === 'get_deadlines') {
    const dl = readDeadlines();
    if (dl) return res.status(200).json({ ok: true, response: formatDeadlines(dl) });
    return res.status(200).json({
      ok: true,
      response: 'פתח את האפליקציה פעם אחת כדי לסנכרן דדליינים, ואז שאל שוב. — מערכת רואי 🤖'
    });
  }

  if (!WRITE_ACTIONS.has(action)) {
    return res.status(400).json({ ok: false, response: `פעולה לא מוכרת: ${action}` });
  }

  // Forward to /api/webhook so the browser frontend picks it up via polling
  const origin = 'https://personal-os-coral-tau.vercel.app';
  const whHdr = { 'Content-Type': 'application/json' };
  if (process.env.WEBHOOK_SECRET) whHdr['X-Webhook-Secret'] = process.env.WEBHOOK_SECRET;

  try {
    await fetch(`${origin}/api/webhook`, {
      method: 'POST',
      headers: whHdr,
      body: JSON.stringify({ action, data: params }),
    });
  } catch { /* non-fatal — browser will get it on next poll */ }

  return res.status(200).json({
    ok: true,
    response: RESPONSES[action]?.(params) ?? `✅ הפעולה בוצעה${SIG}`,
  });
}
