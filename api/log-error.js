// api/log-error.js — client-side error ingestion (Phase 10.3)
const errors = [];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const user = req.query?.user;
    if (user !== 'tklroei1@gmail.com') return res.status(403).json({ error: 'Forbidden' });
    return res.status(200).json({ errors: errors.slice(-50) });
  }

  if (req.method === 'POST') {
    const entry = { ...req.body, receivedAt: new Date().toISOString() };
    errors.push(entry);
    if (errors.length > 200) errors.shift();
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
