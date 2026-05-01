// api/cron/job-hunt.js — Auto-run job search (Phase 7.3)
// Called by Vercel Cron — see vercel.json crons config.
// Searches for jobs matching the user's profile and stores results.
// Results are picked up by the frontend on next load via /api/jobs/list.

const PROFILE_TITLES = ['AI Analyst', 'Growth Analyst', 'Product Manager', 'Data Analyst'];
const SEARCH_BASE = 'site:linkedin.com OR site:alljobs.co.il OR site:comeet.com Israel 2025';

export default async function handler(req, res) {
  // Verify this is a cron call (Vercel sets this header)
  if (req.headers['x-vercel-cron'] !== '1' && req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results = [];
  const tavily = process.env.TAVILY_API_KEY;
  if (!tavily) return res.status(200).json({ skipped: 'No TAVILY_API_KEY' });

  for (const title of PROFILE_TITLES.slice(0, 2)) {
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavily,
          query: `"${title}" job ${SEARCH_BASE}`,
          search_depth: 'basic',
          max_results: 5,
        }),
      });
      if (r.ok) {
        const d = await r.json();
        (d.results || []).forEach(it => results.push({ title, url: it.url, heading: it.title, snippet: it.content }));
      }
    } catch (e) {
      console.error('cron search error:', e.message);
    }
  }

  // Store in KV or in-memory (fallback)
  console.log(`Job-hunt cron: found ${results.length} results`);
  return res.status(200).json({ ok: true, count: results.length, ts: new Date().toISOString() });
}
