// api/ai.js — consolidated AI helpers (keeps Vercel Hobby under the 12-function limit)
// Dispatches by ?fn= :
//   fn=gemini → Gemini conversation layer for Zoro (natural Hebrew chat + intent read)
//   fn=coach  → CV tailoring + honest gap analysis for a specific job
// Routed in vercel.json:  /api/gemini → /api/ai.js?fn=gemini ,  /api/job-coach → /api/ai.js?fn=coach
// Replaces the former standalone api/gemini.js and api/job-coach.js (logic unchanged).

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Resolve which helper to run: prefer ?fn=, fall back to the path (so a direct
  // hit on /api/job-coach or /api/gemini still works even without the rewrite).
  const url = (() => { try { return new URL(req.url, 'http://x'); } catch { return null; } })();
  let fn = (req.query && req.query.fn) || (url && url.searchParams.get('fn')) || '';
  fn = String(fn).toLowerCase();
  if (!fn) {
    const p = (req.url || '').toLowerCase();
    if (p.includes('gemini')) fn = 'gemini';
    else if (p.includes('coach') || p.includes('job-coach')) fn = 'coach';
  }

  if (fn === 'gemini') return geminiHandler(req, res);
  if (fn === 'coach') return coachHandler(req, res);
  return res.status(400).json({ error: 'unknown fn (expected gemini|coach)' });
}

// ───── Gemini conversation layer ─────
// POST { messages:[{role,content}], system, model? } -> { text }
// On error -> { error, fallback:true } so the client can fall back to Claude.
async function geminiHandler(req, res) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(200).json({ error: 'no GEMINI_API_KEY', fallback: true });

  const b = req.body || {};
  const model = String(b.model || process.env.GEMINI_MODEL || 'gemini-2.0-flash').replace(/[^a-zA-Z0-9.\-]/g, '');
  const system = String(b.system || '');
  const msgs = Array.isArray(b.messages) ? b.messages : [];

  const contents = msgs
    .filter(function (m) { return m && (m.content || '').toString().trim(); })
    .map(function (m) {
      const role = (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user';
      return { role: role, parts: [{ text: String(m.content) }] };
    });

  const payload = {
    contents: contents.length ? contents : [{ role: 'user', parts: [{ text: 'שלום' }] }],
    generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
  };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };

  try {
    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key);
    const r = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) return res.status(200).json({ error: (d.error && d.error.message) || 'gemini error', fallback: true });
    const text = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts || [])
      .map(function (p) { return p.text || ''; }).join('').trim();
    return res.status(200).json({ text: text || '', model: model });
  } catch (e) {
    return res.status(200).json({ error: e.message, fallback: true });
  }
}

// ───── CV tailoring + honest gap analysis ─────
// POST { mode:'tailor'|'gap', cv, jobTitle, jobCompany, jobDesc }
async function coachHandler(req, res) {
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (!anthropic) return res.status(200).json({ error: 'אין ANTHROPIC_API_KEY' });

  const b = req.body || {};
  const mode = b.mode === 'tailor' ? 'tailor' : 'gap';
  const cv = String(b.cv || '').slice(0, 8000);
  const jobTitle = String(b.jobTitle || '').slice(0, 200);
  const jobCompany = String(b.jobCompany || '').slice(0, 120);
  const jobDesc = String(b.jobDesc || '').slice(0, 4000);
  if (!cv) return res.status(200).json({ error: 'חסר קורות חיים — העלה קו״ח בכוונון הסוכן' });

  const jobLine = '=== משרה: ' + jobTitle + (jobCompany ? ' @' + jobCompany : '') + ' ===\n' + (jobDesc || '(אין תיאור מלא — התבסס על שם התפקיד והנורמות בתחום)');

  let prompt, maxTokens;
  if (mode === 'tailor') {
    maxTokens = 2200;
    prompt =
      'אתה כותב קורות חיים מקצועי. להלן הקו״ח של המועמד ותיאור משרה.\n' +
      'כתוב גרסת קו״ח מותאמת למשרה — באותה שפה של הקו״ח המקורי.\n' +
      'חוקים קשיחים: אסור להמציא ניסיון/תפקיד/הישג/כישור/תאריך שלא מופיע בקו״ח המקורי. ' +
      'מותר רק: לסדר מחדש לפי רלוונטיות, להדגיש, לנסח מחדש, ולשלב מילות מפתח מתיאור המשרה שבאמת תואמות למה שכבר יש למועמד (להעברת מסנני ATS).\n' +
      'החזר אך ורק JSON תקין: {"cv":"<קו״ח מותאם כטקסט/markdown>","keywords":["מילות מפתח שהודגשו/שולבו"],"note":"<משפט קצר מה שונה>"}\n\n' +
      '=== קורות חיים ===\n' + cv + '\n\n' + jobLine;
  } else {
    maxTokens = 1300;
    prompt =
      'אתה מאמן השמה כן וישיר (חצי אופטימי חצי ריאלי). נתח את ההתאמה בין המועמד למשרה.\n' +
      'החזר אך ורק JSON תקין: {"fitPercent":<0-100 התאמה כנה>,"have":["יתרונות רלוונטיים שיש למועמד"],' +
      '"missing":[{"item":"<דרישה שחסרה>","impact":<כמה אחוזים זה מוריד מהסיכוי, 0-40>,"fix":"<איך להשלים/לעקוף>"}],' +
      '"recommendations":["המלצות קצרות ופרקטיות"],"summary":"<2 משפטים כנים>"}\n' +
      'היה כן — אל תנפח אחוזים. בסס את ה-impact על מרכזיות הדרישה.\n\n' +
      '=== קורות חיים ===\n' + cv + '\n\n' + jobLine;
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropic, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await r.json();
    const txt = (d.content && d.content[0] && d.content[0].text) || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return res.status(200).json({ error: 'לא הצלחתי לנתח את המשרה', raw: txt.slice(0, 200) });
    const parsed = JSON.parse(m[0]);
    return res.status(200).json(Object.assign({ mode: mode }, parsed));
  } catch (e) {
    return res.status(200).json({ error: e.message });
  }
}
