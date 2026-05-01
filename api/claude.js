export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No API key' });

  const { stream, ...body } = req.body || {};

  if (!stream) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return res.status(response.ok ? 200 : response.status).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // SSE streaming mode
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const ping = setInterval(() => { res.write('event: ping\ndata: {}\n\n'); }, 8000);

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ ...body, stream: true }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({ error: 'upstream error' }));
      send('error', err);
      res.end();
      clearInterval(ping);
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const ev = JSON.parse(raw);
          if (ev.type === 'content_block_delta') {
            if (ev.delta?.type === 'text_delta') send('text', { text: ev.delta.text });
            else if (ev.delta?.type === 'input_json_delta') send('tool_delta', { index: ev.index, delta: ev.delta.partial_json });
          } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
            send('tool_start', { id: ev.content_block.id, name: ev.content_block.name, index: ev.index });
          } else if (ev.type === 'message_stop') {
            send('done', {});
          } else if (ev.type === 'message_delta' && ev.delta?.stop_reason) {
            send('stop', { reason: ev.delta.stop_reason });
          }
        } catch {}
      }
    }
  } catch (e) {
    send('error', { error: e.message });
  } finally {
    clearInterval(ping);
    res.end();
  }
}
