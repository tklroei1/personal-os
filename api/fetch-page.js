export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  // Validate URL
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

    // Strip noise: scripts, styles, nav, footers, hidden elements
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
      .slice(0, 7000); // ~1750 tokens — enough for a full job description

    return res.status(200).json({ url, text, ok: true, chars: text.length });
  } catch (e) {
    clearTimeout(timeout);
    const timedOut = e.name === 'AbortError';
    return res.status(200).json({ url, text: '', ok: false, error: timedOut ? 'Timeout' : e.message });
  }
}
