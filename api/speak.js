// api/speak.js — Text-to-speech for the Personal OS assistant.
// Turns the assistant's reply into a natural neural voice (OpenAI TTS),
// far better than the browser's robotic Web Speech voice. Returns MP3 audio.
// Requires the OPENAI_API_KEY environment variable on Vercel.
// If the key is missing, the client falls back to the browser voice.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'no_key' });

  try {
    const body = req.body || {};
    let text = (body.text || '').toString().trim();
    if (!text) return res.status(400).json({ error: 'no_text' });
    if (text.length > 1200) text = text.slice(0, 1200); // keep latency + cost sane

    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: body.voice || 'nova',
        response_format: 'mp3',
        speed: body.speed || 1.0
      })
    });

    if (!r.ok) {
      const err = await r.text().catch(() => '');
      return res.status(502).json({ error: 'tts_failed', detail: err.slice(0, 200) });
    }

    const audio = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(audio);
  } catch (e) {
    return res.status(500).json({ error: 'exception', message: e.message });
  }
}
