// api/get-agent-results.js — On-demand job+apartment agent (v3.2 Phase 3)
// Results cached 6h in module scope (warm Vercel instance).
// External cron can call POST /api/get-agent-results to pre-warm cache.
const cache = { data: null, ts: 0 };
const CACHE_TTL = 6 * 60 * 60 * 1000;

const JOB_TITLES = ['AI Analyst', 'Growth Analyst', 'Product Manager'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth check for POST (cron/admin trigger)
  if (req.method === 'POST') {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });
    cache.ts = 0; // force refresh
  }

  // Return cached if fresh
  if (cache.data && Date.now() - cache.ts < CACHE_TTL) {
    return res.status(200).json({ ...cache.data, cached: true });
  }

  const tavily = process.env.TAVILY_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (!tavily) return res.status(200).json({ jobs: [], apartments: [], summary: 'אין TAVILY_API_KEY', ts: new Date().toISOString() });

  const jobs = [];
  const apartments = [];

  // Job search
  for (const title of JOB_TITLES.slice(0, 2)) {
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavily, query: `"${title}" job Israel LinkedIn 2025`, search_depth: 'basic', max_results: 3 }),
      });
      if (r.ok) {
        const d = await r.json();
        (d.results || []).slice(0, 2).forEach(it => jobs.push({ title, url: it.url, heading: it.title, snippet: (it.content || '').slice(0, 180) }));
      }
    } catch {}
  }

  // Apartment search
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: tavily, query: 'חדר בדירת שותפים תל אביב דיזינגוף-כרם התימנים 2025', search_depth: 'basic', max_results: 3 }),
    });
    if (r.ok) {
      const d = await r.json();
      (d.results || []).slice(0, 2).forEach(it => apartments.push({ url: it.url, heading: it.title, snippet: (it.content || '').slice(0, 180) }));
    }
  } catch {}

  let summary = '';
  if (anthropic && (jobs.length || apartments.length)) {
    try {
      const lines = [
        jobs.length ? `משרות: ${jobs.map(j => j.heading).slice(0, 3).join(' | ')}` : '',
        apartments.length ? `דירות: ${apartments.map(a => a.heading).slice(0, 2).join(' | ')}` : '',
      ].filter(Boolean).join('\n');
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropic, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 180,
          messages: [{ role: 'user', content: `סכם ב-2 משפטים קצרים בעברית:\n${lines}` }],
        }),
      });
      const d = await r.json();
      summary = d.content?.[0]?.text || '';
    } catch {}
  }

  const result = { jobs, apartments, summary, ts: new Date().toISOString() };
  cache.data = result;
  cache.ts = Date.now();
  return res.status(200).json(result);
}
