// api/news-digest.js — Haiku-powered news digest with 6h in-memory TTL (v3.2 Phase 2)
const cache = {};
const CACHE_TTL = 6 * 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { topics = [] } = req.body || {};
  if (!topics.length) return res.status(400).json({ error: 'No topics provided' });

  const key = [...topics].sort().join('|');
  const hit = cache[key];
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
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
    cache[key] = { ts: Date.now(), data: result };
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
