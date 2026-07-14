// api/ai.js — consolidated AI helpers (keeps Vercel Hobby under the 12-function limit)
// Dispatches by ?fn= :
//   fn=gemini     → Zoro conversation layer: Gemini 2.5 → Groq fallback → (client falls back to Claude)
//   fn=coach      → CV tailoring + honest gap analysis (Anthropic)
//   fn=transcribe → Speech-to-text via Groq Whisper (fast, accurate Hebrew)
// Routed in vercel.json.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const url = (() => { try { return new URL(req.url, 'http://x'); } catch { return null; } })();
  let fn = (req.query && req.query.fn) || (url && url.searchParams.get('fn')) || '';
  fn = String(fn).toLowerCase();
  if (!fn) {
    const p = (req.url || '').toLowerCase();
    if (p.includes('gemini')) fn = 'gemini';
    else if (p.includes('coach') || p.includes('job-coach')) fn = 'coach';
    else if (p.includes('transcribe')) fn = 'transcribe';
  }

  if (fn === 'gemini') return geminiHandler(req, res);
  if (fn === 'coach') return coachHandler(req, res);
  if (fn === 'transcribe') return transcribeHandler(req, res);
  if (fn === 'backup') return backupHandler(req, res);
  if (fn === 'restore') return restoreHandler(req, res);
  if (fn === 'jobs_get') return jobsGetHandler(req, res);
  if (fn === 'jobs_put') return jobsPutHandler(req, res);
  if (fn === 'vapid-public') return res.status(200).json({ publicKey: process.env.VAPID_PUBLIC || '' });
  if (fn === 'push-subscribe') return pushSubscribeHandler(req, res);
  return res.status(400).json({ error: 'unknown fn (expected gemini|coach|transcribe|backup|restore|jobs_get|jobs_put|vapid-public|push-subscribe)' });
}

// ───── Web Push subscription storage (send happens in the cron; web-push lib isolated there) ─────
async function pushSubscribeHandler(req, res) {
  const b = req.body || {};
  const sub = b.sub || b.subscription;
  if (!sub || !sub.endpoint) return res.status(200).json({ error: 'no subscription' });
  const out = await kvCmd(['SADD', 'pos_push_subs', JSON.stringify(sub)]);
  if (out._noenv) return res.status(200).json({ error: 'no KV configured', fallback: true });
  return res.status(200).json({ ok: true });
}

// ───── Cloud backup/restore via Vercel KV (Upstash REST). Inert until KV_REST_API_* are set. ─────
async function kvCmd(cmd) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_KV_REST_API_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;
  if (!url || !tok) return { _noenv: true };
  try {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
    return await r.json();
  } catch (e) { return { error: e.message }; }
}
async function backupHandler(req, res) {
  const b = req.body || {};
  const key = String(b.key || '').replace(/[^a-zA-Z0-9_.\-]/g, '').slice(0, 200);
  if (!key) return res.status(200).json({ error: 'no key' });
  if (b.data === undefined) return res.status(200).json({ error: 'no data' });
  const val = typeof b.data === 'string' ? b.data : JSON.stringify(b.data);
  if (val.length > 4500000) return res.status(200).json({ error: 'too large' });
  const out = await kvCmd(['SET', 'pos_backup:' + key, val]);
  if (out._noenv) return res.status(200).json({ error: 'no KV configured', fallback: true });
  if (out.error) return res.status(200).json({ error: out.error });
  await kvCmd(['SET', 'pos_backup_ts:' + key, String(Date.now())]);
  return res.status(200).json({ ok: true, bytes: val.length, ts: Date.now() });
}
async function restoreHandler(req, res) {
  const b = req.body || {};
  const key = String(b.key || '').replace(/[^a-zA-Z0-9_.\-]/g, '').slice(0, 200);
  if (!key) return res.status(200).json({ error: 'no key' });
  const out = await kvCmd(['GET', 'pos_backup:' + key]);
  if (out._noenv) return res.status(200).json({ error: 'no KV configured', fallback: true });
  const tsOut = await kvCmd(['GET', 'pos_backup_ts:' + key]);
  return res.status(200).json({ data: (out && out.result) || null, ts: (tsOut && tsOut.result) ? +tsOut.result : 0 });
}

// ───── Job-list cloud sync (Phase 4) — key pos_jobs_{userId} on the same KV as backup/restore.
// Inert without KV env vars: replies {ok:false,reason:'no_kv'} and never throws / never 500s.
// The stored blob is {jobs:[...],updatedAt:<ms>}; a legacy bare array is still readable.
function jobsKey(b) {
  const uid = String((b && b.userId) || 'default').replace(/[^a-zA-Z0-9_.\-]/g, '').slice(0, 120) || 'default';
  return 'pos_jobs_' + uid;
}
async function jobsGetHandler(req, res) {
  const out = await kvCmd(['GET', jobsKey(req.body || {})]);
  if (out._noenv) return res.status(200).json({ ok: false, reason: 'no_kv', jobs: null, fallback: true });
  if (out.error) return res.status(200).json({ ok: false, reason: 'kv_error', jobs: null });
  let jobs = null, updatedAt = 0;
  try {
    const raw = (out && out.result) || null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) { jobs = parsed; }                                   // legacy shape
      else if (parsed && Array.isArray(parsed.jobs)) { jobs = parsed.jobs; updatedAt = +parsed.updatedAt || 0; }
    }
  } catch (e) { jobs = null; updatedAt = 0; }
  if (!Array.isArray(jobs)) return res.status(200).json({ ok: true, jobs: null });     // nothing stored yet
  return res.status(200).json({ ok: true, jobs: jobs, updatedAt: updatedAt });
}
async function jobsPutHandler(req, res) {
  const b = req.body || {};
  let jobs = Array.isArray(b.jobs) ? b.jobs : null;
  if (!jobs) return res.status(200).json({ ok: false, reason: 'no_jobs' });
  const updatedAt = +b.updatedAt || Date.now();
  // trim oversized description_full (>2000 chars) per job before storing
  jobs = jobs.map(function (j) {
    if (j && typeof j.description_full === 'string' && j.description_full.length > 2000) {
      const c = Object.assign({}, j); c.description_full = j.description_full.slice(0, 2000); return c;
    }
    return j;
  });
  let val = JSON.stringify({ jobs: jobs, updatedAt: updatedAt });
  // hard cap ~900KB — if still over, drop description_full entirely
  if (val.length > 900000) {
    jobs = jobs.map(function (j) { if (j && j.description_full) { const c = Object.assign({}, j); delete c.description_full; return c; } return j; });
    val = JSON.stringify({ jobs: jobs, updatedAt: updatedAt });
  }
  if (val.length > 900000) return res.status(200).json({ ok: false, reason: 'too_large', bytes: val.length });
  const out = await kvCmd(['SET', jobsKey(b), val]);
  if (out._noenv) return res.status(200).json({ ok: false, reason: 'no_kv', fallback: true });
  if (out.error) return res.status(200).json({ ok: false, reason: 'kv_error' });
  return res.status(200).json({ ok: true, updatedAt: updatedAt, bytes: val.length, count: jobs.length });
}

// ───── Zoro conversation layer: Gemini 2.5 → Groq → (client falls back to Claude) ─────
async function geminiHandler(req, res) {
  const b = req.body || {};
  const system = String(b.system || '');
  const msgs = Array.isArray(b.messages) ? b.messages : [];
  const gem = await tryGemini(msgs, system, b.model);
  if (gem && gem.text) return res.status(200).json({ text: gem.text, model: gem.model, provider: 'gemini' });
  const groq = await tryGroq(msgs, system);
  if (groq && groq.text) return res.status(200).json({ text: groq.text, model: groq.model, provider: 'groq' });
  return res.status(200).json({ error: (gem && gem.error) || (groq && groq.error) || 'no provider', fallback: true });
}

async function tryGemini(msgs, system, modelOverride) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: 'no GEMINI_API_KEY' };
  const model = String(modelOverride || process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/[^a-zA-Z0-9.\-]/g, '');
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
    const r = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const d = await r.json();
    if (!r.ok) return { error: (d.error && d.error.message) || 'gemini error' };
    const text = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts || [])
      .map(function (p) { return p.text || ''; }).join('').trim();
    return { text: text || '', model: model };
  } catch (e) { return { error: e.message }; }
}

async function tryGroq(msgs, system) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { error: 'no GROQ_API_KEY' };
  const model = String(process.env.GROQ_MODEL || 'llama-3.3-70b-versatile').replace(/[^a-zA-Z0-9.\-]/g, '');
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  msgs.filter(function (m) { return m && (m.content || '').toString().trim(); })
      .forEach(function (m) {
        const role = (m.role === 'assistant' || m.role === 'model') ? 'assistant' : 'user';
        out.push({ role: role, content: String(m.content) });
      });
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: model, messages: out.length ? out : [{ role: 'user', content: 'שלום' }], temperature: 0.6, max_tokens: 1024 }),
    });
    const d = await r.json();
    if (!r.ok) return { error: (d.error && d.error.message) || 'groq error' };
    const text = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '').trim();
    return { text: text || '', model: model };
  } catch (e) { return { error: e.message }; }
}

// ───── Speech-to-text via Groq Whisper (fast + accurate Hebrew) ─────
async function transcribeHandler(req, res) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(200).json({ error: 'no GROQ_API_KEY', fallback: true });
  const b = req.body || {};
  const b64 = String(b.audio || '');
  if (!b64) return res.status(200).json({ error: 'no audio' });
  const mime = String(b.mime || 'audio/webm');
  const lang = String(b.lang || 'he');
  const ext = mime.includes('wav') ? 'wav' : (mime.includes('mp4') || mime.includes('m4a')) ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
  try {
    const bin = Buffer.from(b64, 'base64');
    const fd = new FormData();
    fd.append('file', new Blob([bin], { type: mime }), 'audio.' + ext);
    fd.append('model', process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3');
    if (lang) fd.append('language', lang);
    fd.append('response_format', 'json');
    fd.append('temperature', '0');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd,
    });
    const d = await r.json();
    if (!r.ok) return res.status(200).json({ error: (d.error && d.error.message) || 'whisper error', fallback: true });
    return res.status(200).json({ text: (d.text || '').trim() });
  } catch (e) {
    return res.status(200).json({ error: e.message, fallback: true });
  }
}

// ───── CV tailoring + honest gap analysis (Anthropic) ─────
async function coachHandler(req, res) {
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (!anthropic) return res.status(200).json({ error: 'אין ANTHROPIC_API_KEY' });
  const b = req.body || {};
  const mode = b.mode === 'tailor' ? 'tailor' : 'gap';
  const cv = String(b.cv || '').slice(0, 8000);
  const jobTitle = String(b.jobTitle || '').slice(0, 200);
  const jobCompany = String(b.jobCompany || '').slice(0, 120);
  const jobDesc = String(b.jobDesc || '').slice(0, 4000);
  // ═══ TAILORED-CV: ATS keyword hints from the caller (real mirroring) ═══
  const matchedKw = Array.isArray(b.matchedKeywords) ? b.matchedKeywords.map(String).slice(0, 40) : [];
  const missingKw = Array.isArray(b.missingKeywords) ? b.missingKeywords.map(String).slice(0, 40) : [];
  if (!cv) return res.status(200).json({ error: 'חסר קורות חיים — העלה קו״ח בכוונון הסוכן' });
  const jobLine = '=== משרה: ' + jobTitle + (jobCompany ? ' @' + jobCompany : '') + ' ===\n' + (jobDesc || '(אין תיאור מלא — התבסס על שם התפקיד והנורמות בתחום)');
  let prompt, maxTokens;
  if (mode === 'tailor') {
    // ═══ TAILORED-CV (rewritten 2026-07-13): return the COMPLETE mirrored CV ═══
    maxTokens = 3000;
    const kwLine = (matchedKw.length || missingKw.length)
      ? '\n=== JOB KEYWORDS TO MIRROR (ATS) ===\n' +
        (matchedKw.length ? 'Already-matched (emphasize / state explicitly): ' + matchedKw.join(', ') + '\n' : '') +
        (missingKw.length ? 'From the ad (embed ONLY where genuinely true for the candidate, else omit): ' + missingKw.join(', ') + '\n' : '')
      : '';
    prompt =
      'You are an expert resume writer performing ATS keyword mirroring. Below is a candidate\'s COMPLETE base CV and a job description.\n' +
      'Return the candidate\'s COMPLETE tailored CV — every section, top to bottom: the header/name line, a PROFESSIONAL SUMMARY, ALL experience entries (each with its bullet points), EDUCATION, and SKILLS. Output the WHOLE document, never a fragment or excerpt.\n' +
      'STRICT RULES:\n' +
      '1. Strictly truthful. Never invent a job, title, employer, achievement, skill, metric, or date that is not already in the base CV.\n' +
      '2. Only reorder, re-emphasize, and rephrase existing facts so the most job-relevant content comes first.\n' +
      '3. Embed the EXACT keywords and phrases from the job description wherever they truthfully apply to the candidate (ATS mirroring) — use the job\'s own wording.\n' +
      '4. Keep it to ONE page of content, concise and professional.\n' +
      '5. Write in English (same language as the base CV). Keep all dates exactly as in the base CV.\n' +
      '6. For any metric/number the candidate has not provided, write the literal placeholder "[add %]" — never fabricate a figure.\n' +
      'FORMAT of the "cv" string: plain text with \\n line breaks. Section headings in ALL CAPS on their own line (e.g. PROFESSIONAL SUMMARY, EXPERIENCE, EDUCATION, SKILLS). Bullet lines start with "• ".\n' +
      'Return ONLY valid JSON: {"cv":"<full tailored CV text with \\n line breaks>","keywords":["exact job keywords you embedded"],"note":"<one short sentence on what was reordered/emphasized>"}\n\n' +
      '=== BASE CV (complete) ===\n' + cv + '\n\n' + jobLine + kwLine;
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
