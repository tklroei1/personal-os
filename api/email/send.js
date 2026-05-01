// api/email/send.js — Gmail API send (Phase 8.1)
// Frontend handles OAuth token; this endpoint is a passthrough to Gmail REST API
// The actual send is done client-side with the user's access token for simplicity.
// This file is kept as a server-side option if a service account is needed.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing access token. Connect Google Calendar first.' });
  }

  const { to, subject, body } = req.body || {};
  if (!to || !subject || !body) return res.status(400).json({ error: 'Missing to, subject, or body' });

  const accessToken = authHeader.slice(7);
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${body}`
  ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  try {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    const data = await r.json();
    if (r.ok) return res.status(200).json({ id: data.id });
    return res.status(r.status).json({ error: data.error?.message || 'Gmail error' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
