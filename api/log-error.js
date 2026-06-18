// api/log-error.js — client + server error ingestion, persisted in Vercel KV (P3)
async function kv(cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_KV_REST_API_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;
  if (!url || !tok) return { _noenv: true };
  try {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
    return await r.json();
  } catch (e) { return { error: e.message }; }
}
const mem = [];
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const user = req.query && req.query.user;
    if (user !== 'tklroei1@gmail.com') return res.status(403).json({ error: 'Forbidden' });
    const out = await kv(['LRANGE', 'pos_errors', 0, 49]);
    if (out._noenv) return res.status(200).json({ errors: mem.slice(-50).reverse() });
    const list = (out && out.result) || [];
    return res.status(200).json({ errors: list.map(function (s) { try { return JSON.parse(s); } catch (e) { return { raw: s }; } }) });
  }

  if (req.method === 'POST') {
    const entry = Object.assign({}, req.body, { receivedAt: new Date().toISOString() });
    const out = await kv(['LPUSH', 'pos_errors', JSON.stringify(entry).slice(0, 2000)]);
    if (out._noenv) { mem.push(entry); if (mem.length > 200) mem.shift(); }
    else { await kv(['LTRIM', 'pos_errors', 0, 199]); }
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
