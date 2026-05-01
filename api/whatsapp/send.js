// api/whatsapp/send.js — Twilio WhatsApp MVP (Phase 8.2)
// Required env vars: TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM (e.g. whatsapp:+14155238886)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, body } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'Missing to or body' });

  const sid = process.env.TWILIO_SID;
  const token = process.env.TWILIO_TOKEN;
  const from = process.env.TWILIO_FROM || 'whatsapp:+14155238886';

  if (!sid || !token) {
    return res.status(200).json({
      error: 'Twilio not configured. Set TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM in Vercel env vars. See docs/whatsapp-setup.md',
    });
  }

  try {
    const toNum = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${sid}:${token}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: from, To: toNum, Body: body }).toString(),
    });
    const data = await r.json();
    if (r.ok) return res.status(200).json({ sid: data.sid });
    return res.status(r.status).json({ error: data.message || 'Twilio error' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
