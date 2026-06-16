// api/job-coach.js — CV tailoring + honest gap analysis for a specific job (v1)
// POST { mode:'tailor'|'gap', cv, jobTitle, jobCompany, jobDesc }
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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
