// api/search.js
// Web search endpoint for Personal OS agents.
// Priority: Tavily (best for AI) → Brave → DuckDuckGo (always free fallback).

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const query =
      (req.method === 'POST' ? req.body?.query : req.query?.q) || '';
    const count = Number(
      (req.method === 'POST' ? req.body?.count : req.query?.count) || 10
    );

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Missing query parameter' });
    }

    // 1. Tavily (preferred for AI agents)
    if (process.env.TAVILY_API_KEY) {
      try {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query,
            search_depth: 'advanced',
            max_results: Math.min(count, 10),
            include_answer: true,
          }),
        });
        if (r.ok) {
          const data = await r.json();
          const results = (data.results || []).map((it) => ({
            title: it.title || '',
            url: it.url || '',
            description: it.content || '',
            source: 'tavily',
          }));
          return res
            .status(200)
            .json({ provider: 'tavily', answer: data.answer || '', results });
        }
      } catch (e) {
        console.error('Tavily failed:', e?.message);
      }
    }

    // 2. Brave (optional)
    if (process.env.BRAVE_API_KEY) {
      try {
        const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
          query
        )}&count=${Math.min(count, 20)}`;
        const r = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'X-Subscription-Token': process.env.BRAVE_API_KEY,
          },
        });
        if (r.ok) {
          const data = await r.json();
          const results = (data?.web?.results || []).map((it) => ({
            title: it.title || '',
            url: it.url || '',
            description: it.description || '',
            source: 'brave',
          }));
          return res.status(200).json({ provider: 'brave', results });
        }
      } catch (e) {
        console.error('Brave failed:', e?.message);
      }
    }

    // 3. DuckDuckGo Instant Answer API (no key, always available)
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(
        query
      )}&format=json&no_html=1&skip_disambig=1`;
      const r = await fetch(url);
      if (r.ok) {
        const data = await r.json();
        const results = [];
        if (data.AbstractText) {
          results.push({
            title: data.Heading || query,
            url: data.AbstractURL || '',
            description: data.AbstractText,
            source: 'duckduckgo',
          });
        }
        for (const t of data.RelatedTopics || []) {
          if (results.length >= count) break;
          if (t.Text && t.FirstURL) {
            results.push({
              title: t.Text.split(' - ')[0] || t.Text,
              url: t.FirstURL,
              description: t.Text,
              source: 'duckduckgo',
            });
          }
        }
        return res.status(200).json({ provider: 'duckduckgo', results });
      }
    } catch (e) {
      console.error('DuckDuckGo failed:', e?.message);
    }

    return res
      .status(502)
      .json({ error: 'All search providers failed', results: [] });
  } catch (err) {
    console.error('search.js error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
