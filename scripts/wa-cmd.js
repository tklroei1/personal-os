#!/usr/bin/env node
// WhatsApp command helper — called by Claude Code when processing Hebrew WhatsApp commands.
// Usage: node scripts/wa-cmd.js '<json_payload>'
// Example: node scripts/wa-cmd.js '{"action":"finance_add_expense","params":{"amount":50,"description":"קפה"}}'

const BASE = 'https://personal-os-coral-tau.vercel.app/api/whatsapp-command';

async function main() {
  const raw = process.argv[2];
  if (!raw) { process.stdout.write('שגיאה: חסר payload\n'); process.exit(1); }

  let payload;
  try { payload = JSON.parse(raw); }
  catch { process.stdout.write('שגיאה: JSON לא תקין\n'); process.exit(1); }

  const { action } = payload;

  try {
    let res;
    if (action === 'get_deadlines') {
      res = await fetch(`${BASE}?action=get_deadlines`);
    } else {
      res = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    const data = await res.json();
    process.stdout.write((data.response || '✅ בוצע') + '\n');
  } catch (e) {
    process.stdout.write('שגיאה: ' + e.message + '\n');
    process.exit(1);
  }
}

main();
