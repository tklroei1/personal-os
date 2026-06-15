// api/get-agent-results.js — Autonomous job+apartment agent (v4.0)
// Live web search every run (not a static list). Personalised to Roei's profile:
// student/junior/intern hi-tech + VC roles, entrepreneurship / AI / longevity / startups.
// Config can be overridden per request via GET query (roles, companies, seniority, startup),
// so the in-app settings panel controls it; the cron uses these defaults.
const CACHE_TTL = 6 * 60 * 60 * 1000;
const cacheMap = new Map(); // signature -> { data, ts }

// ── WHO IS ROEI (fit basis) ────────────────────────────────────────────────
const ROEI_PROFILE =
  "רואי קליין — סטודנט/ג'וניור עם אוריינטציית יזמות. מתעניין ב-AI, לונגיביטי, סטארטאפים והון סיכון (VC). " +
  'מחפש תפקידים עם סיכויי קבלה גבוהים לרמת סטודנט/ג\'וניור/התמחות. מעדיף תל אביב והמרכז.';

// Roles where a student/junior with entrepreneurial drive has good odds + interest.
const DEFAULT_ROLES = [
  'AI Analyst', 'Data Analyst', 'Business Analyst', 'Product Analyst', 'Growth Analyst',
  'Associate Product Manager', 'Product Manager', 'Operations Analyst', 'Strategy Analyst',
  "Founder's Associate", 'Chief of Staff', 'Business Development Representative',
  'Venture Capital Analyst', 'Investment Analyst', 'VC Associate',
  'Data Scientist', 'BI Analyst', 'Growth Marketing', 'Program Manager', 'Research Analyst',
];

// Interesting companies (AI / longevity / startups / VC) to scan careers pages of.
const DEFAULT_COMPANIES = [
  // AI
  'AI21 Labs', 'Lightricks', 'Gong', 'Run:ai', 'Deci', 'Tabnine', 'D-ID', 'Pinecone', 'OpenAI', 'Anthropic', 'Hugging Face',
  // Health / Longevity
  'Aidoc', 'Immunai', 'Pheno.AI', 'Insilico Medicine',
  // Startups / scaleups
  'Wiz', 'Fireblocks', 'Melio', 'Verbit', 'Lemonade', 'monday.com',
  // VC funds
  'Aleph', 'Pitango', 'OurCrowd', 'Team8', 'Viola', 'TLV Partners', 'Glilot Capital', 'Vintage Investment Partners',
];

const DEFAULT_SENIORITY = ['student', 'junior', 'intern', 'entry'];

function guessType(text) {
  const t = (text || '').toLowerCase();
  if (/\b(intern|internship|התמחות|מתמחה)\b/.test(t)) return 'intern';
  if (/\b(student|סטודנט)\b/.test(t)) return 'student';
  if (/\b(senior|sr\.?|lead|principal|staff|director|vp|בכיר|סיניור)\b/.test(t)) return 'senior';
  if (/\b(junior|jr\.?|entry|graduate|ג'וניור|זוטר)\b/.test(t)) return 'junior';
  if (/\b(manager|head|מנהל)\b/.test(t)) return 'mid';
  return '';
}
const TYPE_HE = { student: 'סטודנט', junior: "ג'וניור", entry: 'אנטרי', intern: 'התמחות', mid: 'מיד-לבל', senior: 'סיניור' };

const SENIOR_RX = /(senior|sr\.?|lead|principal|staff|director|head of|vp\b|vice president|בכיר)/i;
const JUNIOR_RX = /(junior|jr\.?|entry|graduate|intern|student|ג'וניור|סטודנט|התמחות|זוטר)/i;
const INTEREST_RX = /(ai|a\.i|genai|llm|machine learning|data|analyst|product|growth|startup|venture|vc|invest|longevity|biotech|health)/i;

function tavily(key, query, max = 4) {
  return fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, search_depth: 'basic', max_results: max }),
  })
    .then(r => (r.ok ? r.json() : { results: [] }))
    .catch(() => ({ results: [] }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  const body = req.body || {};
  const broad = String(q.broad || body.broad || '') === '1';
  const startupFocus = String(q.startup ?? body.startup ?? '1') === '1'; // default ON
  const roles = (q.roles || body.roles ? String(q.roles || body.roles).split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_ROLES);
  const companies = (q.companies || body.companies ? String(q.companies || body.companies).split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_COMPANIES);
  const seniority = (q.seniority || body.seniority ? String(q.seniority || body.seniority).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : DEFAULT_SENIORITY);
  // CV + profile fields (used for fit scoring + the tailored summary). CV capped for request size.
  const skills = (Array.isArray(body.skills) ? body.skills : String(body.skills || q.skills || '').split(',')).map(s => s.trim()).filter(Boolean);
  const cv = String(body.cv || '').slice(0, 6000);
  const userProfile = [String(body.summary || ''), String(body.bigPicture || ''), `אזור: ${String(body.homeArea || '')}`].filter(Boolean).join(' · ').slice(0, 600) || ROEI_PROFILE;

  // POST with the cron secret = force. A normal POST carrying config/CV is allowed (no auth).
  const authed = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
  const force = authed || String(body.fresh || q.fresh || '') === '1';

  const cvSig = cv ? `${cv.length}:${cv.slice(0, 40)}` : '';
  const sig = JSON.stringify({ broad, startupFocus, roles, companies, seniority, skills, cvSig });
  const hit = cacheMap.get(sig);
  if (!force && hit && Date.now() - hit.ts < CACHE_TTL) {
    return res.status(200).json({ ...hit.data, cached: true });
  }

  const key = process.env.TAVILY_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(200).json({ jobs: [], apartments: [], summary: 'אין TAVILY_API_KEY', profile: ROEI_PROFILE, ts: new Date().toISOString() });

  // Seniority phrase injected into queries, e.g. (junior OR student OR intern OR "entry level")
  const senTerms = seniority.map(s => (s === 'entry' ? '"entry level"' : s)).join(' OR ');
  const senPhrase = senTerms ? `(${senTerms})` : '';
  const startupTerm = startupFocus ? 'startup' : '';

  // Caps to stay within time budget (parallelised).
  const roleN = broad ? 8 : 5;
  const compN = broad ? 10 : 5;
  const dayOffset = Math.floor(Date.now() / 86400000); // rotate companies daily

  const queries = [];
  roles.slice(0, roleN).forEach(role =>
    queries.push({ q: `"${role}" ${senPhrase} job Israel ${startupTerm} 2026`.replace(/\s+/g, ' ').trim(), role })
  );
  for (let i = 0; i < Math.min(compN, companies.length); i++) {
    const company = companies[(dayOffset + i) % companies.length];
    queries.push({ q: `"${company}" careers jobs Israel ${senPhrase}`.replace(/\s+/g, ' ').trim(), role: '', company });
  }
  if (startupFocus) {
    queries.push({ q: `Israel startup ${senPhrase} (AI OR longevity OR product OR analyst) open positions careers 2026`, role: '', startup: true });
    queries.push({ q: `early stage startup Israel ${senPhrase} hiring "all open roles" 2026`, role: '', startup: true });
  }

  const responses = await Promise.all(queries.map(qq => tavily(key, qq.q, broad ? 5 : 4).then(d => ({ qq, d }))));

  // Build a skills matcher from the user's CV/skills so fit reflects THIS person.
  const skillRx = skills.length ? new RegExp(skills.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i') : null;

  const rawJobs = [];
  responses.forEach(({ qq, d }) => {
    (d.results || [])
      .filter(it => /^https?:\/\//i.test(it.url || ''))
      .forEach(it => {
        const hay = `${qq.role || ''} ${it.title || ''} ${it.content || ''}`;
        // Seniority filter: drop clearly-senior roles unless they also signal junior/intern,
        // when the user excludes mid/senior.
        const wantsSenior = seniority.includes('senior') || seniority.includes('mid');
        if (!wantsSenior && SENIOR_RX.test(`${qq.role || ''} ${it.title || ''}`) && !JUNIOR_RX.test(`${qq.role || ''} ${it.title || ''}`)) return;
        const typeKey = guessType(hay);
        const fit = INTEREST_RX.test(hay) || (skillRx && skillRx.test(hay));
        rawJobs.push({
          title: qq.role || (qq.company ? `${qq.company}` : 'משרה'),
          company: qq.company || '',
          url: it.url,
          heading: it.title,
          snippet: (it.content || '').slice(0, 180),
          type: TYPE_HE[typeKey] || '',
          fit,
          source: qq.company ? 'company_site' : qq.startup ? 'startup' : 'search',
          published_date: it.published_date || null,
        });
      });
  });

  // De-dupe by url, fitting jobs first, cap total.
  const seen = new Set();
  const jobs = rawJobs
    .filter(j => (seen.has(j.url) ? false : (seen.add(j.url), true)))
    .sort((a, b) => (b.fit ? 1 : 0) - (a.fit ? 1 : 0))
    .slice(0, broad ? 30 : 18);

  // Apartments (unchanged scope)
  const apartments = [];
  try {
    const d = await tavily(key, 'חדר בדירת שותפים תל אביב דיזינגוף-כרם התימנים 2026', 3);
    (d.results || []).filter(it => /^https?:\/\//i.test(it.url || '')).slice(0, 2)
      .forEach(it => apartments.push({ url: it.url, heading: it.title, snippet: (it.content || '').slice(0, 180), published_date: it.published_date || null }));
  } catch {}

  let summary = '';
  if (anthropic && jobs.length) {
    try {
      const lines = jobs.slice(0, 8).map((j, i) => `${i + 1}. ${j.heading}${j.company ? ' @' + j.company : ''}`).join('\n');
      const cvBlock = cv ? `\nקורות החיים שלו (תקציר):\n${cv.slice(0, 2500)}` : '';
      const skillsBlock = skills.length ? `\nמיומנויות: ${skills.join(', ')}` : '';
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropic, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 260,
          messages: [{ role: 'user', content: `פרופיל המועמד: ${userProfile}${skillsBlock}${cvBlock}\n\nמשרות שנמצאו:\n${lines}\n\nבעברית, קצר: ציין את 2-3 המשרות הכי מתאימות לו לפי הרקע שלו ולמה, ומה כדאי שיבליט בהגשה.` }],
        }),
      });
      const d = await r.json();
      summary = d.content?.[0]?.text || '';
    } catch {}
  }

  const result = { jobs, apartments, summary, broad, startupFocus, usedCV: !!cv, profile: userProfile, ts: new Date().toISOString() };
  cacheMap.set(sig, { data: result, ts: Date.now() });
  return res.status(200).json(result);
}
