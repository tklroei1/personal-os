// api/search.js
// Web search endpoint for Personal OS agents.
// Priority: Tavily → Brave → DuckDuckGo (fallback).
// Added: per-query caching (5 min), 8s timeout, search_depth, topic, domain filters.

const cache = new Map();

function withTimeout(promise, ms = 8000) {
  const t = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
  return Promise.race([promise, t]);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const isPost = req.method === 'POST';
    const query = (isPost ? req.body?.query : req.query?.q) || '';
    const count = Number((isPost ? req.body?.count : req.query?.count) || 10);
    const search_depth = (isPost ? req.body?.search_depth : req.query?.depth) || 'basic';
    const topic = (isPost ? req.body?.topic : req.query?.topic) || 'general';
    const include_domains = isPost ? (req.body?.include_domains || undefined) : undefined;
    const exclude_domains = isPost ? (req.body?.exclude_domains || undefined) : undefined;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Missing query parameter' });
    }

    // 5-min cache keyed by query+depth+topic
    const cacheKey = `${query}|${search_depth}|${topic}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {
      return res.status(200).json({ ...cached.data, cached: true });
    }

    // 1. Tavily
    if (process.env.TAVILY_API_KEY) {
      try {
        const r = await withTimeout(fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query,
            search_depth,
            topic,
            max_results: Math.min(count, 10),
            include_answer: true,
            ...(include_domains ? { include_domains } : {}),
            ...(exclude_domains ? { exclude_domains } : {}),
          }),
        }));
        if (r.ok) {
          const data = await r.json();
          const results = (data.results || []).map((it) => ({
            title: it.title || '',
            url: it.url || '',
            description: it.content || '',
            source: 'tavily',
          }));
          const out = { provider: 'tavily', answer: data.answer || '', results };
          cache.set(cacheKey, { ts: Date.now(), data: out });
          return res.status(200).json(out);
        }
      } catch (e) {
        console.error('Tavily failed:', e?.message);
      }
    }

    // 2. Brave
    if (process.env.BRAVE_API_KEY) {
      try {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(count, 20)}`;
        const r = await withTimeout(fetch(url, {
          headers: { Accept: 'application/json', 'X-Subscription-Token': process.env.BRAVE_API_KEY },
        }));
        if (r.ok) {
          const data = await r.json();
          const results = (data?.web?.results || []).map((it) => ({
            title: it.title || '',
            url: it.url || '',
            description: it.description || '',
            source: 'brave',
          }));
          const out = { provider: 'brave', results };
          cache.set(cacheKey, { ts: Date.now(), data: out });
          return res.status(200).json(out);
        }
      } catch (e) {
        console.error('Brave failed:', e?.message);
      }
    }

    // 3. DuckDuckGo
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const r = await withTimeout(fetch(url));
      if (r.ok) {
        const data = await r.json();
        const results = [];
        if (data.AbstractText) {
          results.push({ title: data.Heading || query, url: data.AbstractURL || '', description: data.AbstractText, source: 'duckduckgo' });
        }
        for (const t of data.RelatedTopics || []) {
          if (results.length >= count) break;
          if (t.Text && t.FirstURL) {
            results.push({ title: t.Text.split(' - ')[0] || t.Text, url: t.FirstURL, description: t.Text, source: 'duckduckgo' });
          }
        }
        const out = { provider: 'duckduckgo', results };
        cache.set(cacheKey, { ts: Date.now(), data: out });
        return res.status(200).json(out);
      }
    } catch (e) {
      console.error('DuckDuckGo failed:', e?.message);
    }

    return res.status(502).json({ error: 'All search providers failed', results: [] });
  } catch (err) {
    console.error('search.js error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
