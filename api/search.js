export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { q, count = '8' } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query parameter q' });

  // --- PRIMARY: Brave Search API (richer results, real snippets + URLs) ---
  const braveKey = process.env.BRAVE_API_KEY;
  if (braveKey) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${count}&search_lang=en&country=IL&safesearch=off&text_decorations=false`;
      const r = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': braveKey
        }
      });
      if (r.ok) {
        const data = await r.json();
        const raw = data.web?.results || [];
        // Normalize to a shape that works with both the legacy autoSearch() consumer
        // (which reads .Text and .FirstURL) and the new rich job-search consumer
        const Results = raw.map(item => ({
          title: item.title || '',
          url: item.url || '',
          description: item.description || '',
          age: item.age || '',
          // DDG-compatible aliases for backward compatibility
          Text: `${item.title}: ${item.description || ''}`,
          FirstURL: item.url
        }));
        return res.status(200).json({ source: 'brave', Results, RelatedTopics: [], query: q });
      }
    } catch (_) {
      // fall through to DDG
    }
  }

  // --- FALLBACK: DuckDuckGo Instant Answers ---
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const r = await fetch(ddgUrl, { headers: { 'User-Agent': 'PersonalOS/1.0' } });
    const data = await r.json();
    return res.status(200).json({ ...data, source: 'duckduckgo' });
  } catch (e) {
    return res.status(500).json({ error: e.message, source: 'none' });
  }
}
