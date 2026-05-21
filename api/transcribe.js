// api/transcribe.js — Speech-to-text for the Personal OS assistant.
// Receives base64 audio from the browser (MediaRecorder), transcribes it
// via OpenAI Whisper, returns plain text. Works on iOS (MediaRecorder is
// supported there, unlike the Web Speech API).
// Requires the OPENAI_API_KEY environment variable on Vercel.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ error: 'no_key', text: '',
      message: 'חסר OPENAI_API_KEY ב-Vercel — קול לא יעבוד עד שיוגדר.' });
  }

  try {
    const body = req.body || {};
    const b64 = (body.audio || '').replace(/^data:[^,]*,/, '');
    if (!b64) return res.status(400).json({ error: 'no_audio' });

    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 800) return res.status(200).json({ text: '' }); // too short / silence

    const mime = body.mime || 'audio/webm';
    const ext  = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm';

    const form = new FormData();
    form.append('file', new Blob([buf], { type: mime }), 'audio.' + ext);
    form.append('model', 'whisper-1');
    form.append('language', body.language || 'he'); // Hebrew hint for accuracy

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: form
    });

    if (!r.ok) {
      const err = await r.text().catch(() => '');
      return res.status(200).json({ error: 'stt_failed', text: '',
        message: 'שגיאת תמלול (' + r.status + ')', detail: err.slice(0, 200) });
    }

    const data = await r.json();
    return res.status(200).json({ text: (data.text || '').trim() });
  } catch (e) {
    return res.status(200).json({ error: 'exception', text: '', message: e.message });
  }
}
