// api/util.js — consolidated utility endpoints (P4 router; keeps Vercel Hobby under the 12-function limit)
// Dispatches by ?fn= (set via vercel.json routes; original query params are merged through):
//   fn=fetch-page   → GET  proxy that fetches a URL and returns stripped text
//   fn=log-error    → GET/POST error ingestion + viewer, persisted in Vercel KV (P3)
//   fn=news-digest  → POST Haiku-powered news digest (Tavily + Anthropic), 6h in-memory TTL
//   fn=send         → POST Twilio WhatsApp send (Phase 8.2)
// Each handler below is the original endpoint logic, ported verbatim.

export default async function handler(req, res) {
  const url = (() => { try { return new URL(req.url, 'http://x'); } catch { return null; } })();
  let fn = (req.query && req.query.fn) || (url && url.searchParams.get('fn')) || '';
  fn = String(fn).toLowerCase();
  if (!fn) {
    const p = (req.url || '').toLowerCase();
    if (p.includes('fetch-page')) fn = 'fetch-page';
    else if (p.includes('log-error')) fn = 'log-error';
    else if (p.includes('news-digest')) fn = 'news-digest';
    else if (p.includes('/send') || p.includes('whatsapp')) fn = 'send';
  }

  if (fn === 'fetch-page') return fetchPageHandler(req, res);
  if (fn === 'log-error') return logErrorHandler(req, res);
  if (fn === 'news-digest') return newsDigestHandler(req, res);
  if (fn === 'send') return whatsappSendHandler(req, res);

  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(400).json({ error: 'unknown fn (expected fetch-page|log-error|news-digest|send)' });
}

// Read a query param from req.query, falling back to parsing req.url directly.
// (Defensive: ensures original query params survive the vercel.json ?fn= rewrite.)
function qp(req, name) {
  if (req.query && req.query[name] != null) return req.query[name];
  try { return new URL(req.url, 'http://x').searchParams.get(name); } catch { return null; }
}

// ───────────────────────── fetch-page (GET) ─────────────────────────
async function fetchPageHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const url = qp(req, 'url');
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  let parsed;
  try { parsed = new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only http/https allowed' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000); // 9s hard timeout

  try {
    const r = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5,he;q=0.3',
      }
    });
    clearTimeout(timeout);

    if (!r.ok) {
      return res.status(200).json({ url, text: '', ok: false, statusCode: r.status });
    }

    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('html') && !ct.includes('text')) {
      return res.status(200).json({ url, text: '', ok: false, reason: 'Non-HTML content type' });
    }

    const html = await r.text();

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 7000);

    return res.status(200).json({ url, text, ok: true, chars: text.length });
  } catch (e) {
    clearTimeout(timeout);
    const timedOut = e.name === 'AbortError';
    return res.status(200).json({ url, text: '', ok: false, error: timedOut ? 'Timeout' : e.message });
  }
}

// ───────────────────────── log-error (GET/POST) ─────────────────────────
async function kvLog(cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_KV_REST_API_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;
  if (!url || !tok) return { _noenv: true };
  try {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
    return await r.json();
  } catch (e) { return { error: e.message }; }
}
const memErrors = [];
async function logErrorHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const user = qp(req, 'user');
    if (user !== 'tklroei1@gmail.com') return res.status(403).json({ error: 'Forbidden' });
    const out = await kvLog(['LRANGE', 'pos_errors', 0, 49]);
    if (out._noenv) return res.status(200).json({ errors: memErrors.slice(-50).reverse() });
    const list = (out && out.result) || [];
    return res.status(200).json({ errors: list.map(function (s) { try { return JSON.parse(s); } catch (e) { return { raw: s }; } }) });
  }

  if (req.method === 'POST') {
    const entry = Object.assign({}, req.body, { receivedAt: new Date().toISOString() });
    const out = await kvLog(['LPUSH', 'pos_errors', JSON.stringify(entry).slice(0, 2000)]);
    if (out._noenv) { memErrors.push(entry); if (memErrors.length > 200) memErrors.shift(); }
    else { await kvLog(['LTRIM', 'pos_errors', 0, 199]); }
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ───────────────────────── news-digest (POST) ─────────────────────────
const newsCache = {};
const NEWS_TTL = 6 * 60 * 60 * 1000;
async function newsDigestHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { topics = [] } = req.body || {};
  if (!topics.length) return res.status(400).json({ error: 'No topics provided' });

  const key = [...topics].sort().join('|');
  const hit = newsCache[key];
  if (hit && Date.now() - hit.ts < NEWS_TTL) {
    return res.status(200).json({ ...hit.data, cached: true });
  }

  const tavily = process.env.TAVILY_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (!anthropic) return res.status(500).json({ error: 'No ANTHROPIC_API_KEY' });

  const snippets = [];
  for (const topic of topics.slice(0, 5)) {
    if (!tavily) break;
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavily, query: topic + ' חדשות עדכניות היום', search_depth: 'basic', max_results: 4 }),
      });
      if (r.ok) {
        const d = await r.json();
        const hits = (d.results || []).slice(0, 3).map(x => `• ${x.title}: ${(x.content || '').slice(0, 180)}`).join('\n');
        if (hits) snippets.push(`=== ${topic} ===\n${hits}`);
      }
    } catch {}
  }

  if (!snippets.length) {
    return res.status(200).json({ summary: 'לא נמצאו תוצאות — בדוק שה-TAVILY_API_KEY מוגדר', topics, ts: new Date().toISOString() });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropic, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        system: 'אתה עורך חדשות בעברית. סכם את החדשות בנקודות קצרות וברורות. כל נקודה = שורה אחת. אל תכלול URLs.',
        messages: [{ role: 'user', content: `סכם את החדשות הבאות:\n\n${snippets.join('\n\n')}` }],
      }),
    });
    const d = await r.json();
    const summary = d.content?.[0]?.text || 'שגיאה בסיכום';
    const result = { summary, topics, ts: new Date().toISOString() };
    newsCache[key] = { ts: Date.now(), data: result };
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ───────────────────────── whatsapp send via Twilio (POST) ─────────────────────────
async function whatsappSendHandler(req, res) {
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
