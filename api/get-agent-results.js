// api/get-agent-results.js — Autonomous job+apartment agent (v5.0)
// Live web search every run. Personalised to Roei (student/junior/intern hi-tech + VC,
// entrepreneurship / AI / longevity / startups). Searches LinkedIn, AllJobs, HireMeTech,
// ATS pages (Comeet/Greenhouse/Lever) and a curated company list. Produces HONEST,
// CV-aware mutual-fit scoring (match %, why-this-job, what's missing) like a job coach.
const CACHE_TTL = 6 * 60 * 60 * 1000;
const cacheMap = new Map(); // signature -> { data, ts }

const ROEI_PROFILE =
  "רואי קליין — סטודנט/ג'וניור עם אוריינטציית יזמות. מתעניין ב-AI, לונגיביטי, סטארטאפים והון סיכון (VC). " +
  'מחפש תפקידים עם סיכויי קבלה גבוהים לרמת סטודנט/ג\'וניור/התמחות. מעדיף תל אביב והמרכז.';

const DEFAULT_ROLES = [
  'AI Growth', 'AI Product Manager', 'AI Operations', 'Generative AI', 'Machine Learning Analyst',
  'AI Analyst', 'Data Analyst', 'Junior Data Analyst', 'Business Analyst', 'Business Intelligence Analyst',
  'BI Analyst', 'Analytics Specialist', 'Insights Analyst', 'Reporting Analyst', 'Operations Analyst',
  'Revenue Operations Analyst', 'Marketing Analyst', 'Growth Analyst', 'Strategy Analyst', 'Research Analyst',
  'Product Analyst', 'Pricing Analyst', 'CRM Analyst',
  'Associate Product Manager', 'Product Manager', 'Product Operations',
  "Founder's Associate", 'Chief of Staff', 'Business Operations', 'Program Manager',
  'Business Development Representative', 'Sales Development Representative', 'Partnerships Associate',
  'Customer Success Associate', 'Solutions Analyst',
  'Growth Marketing', 'Growth Associate', 'Marketing Operations',
  'Venture Capital Analyst', 'Investment Analyst', 'VC Associate', 'Investment Associate', 'Platform Associate',
  'Private Equity Analyst', 'Private Equity Associate', 'Investment Banking Analyst',
];

const DEFAULT_COMPANIES = [
  'AI21 Labs', 'Lightricks', 'Gong', 'Run:ai', 'Deci', 'Tabnine', 'D-ID', 'Pinecone', 'OpenAI', 'Anthropic',
  'Hugging Face', 'Cresta', 'Aquant', 'Nucleai', 'Theator', 'Quris',
  'Wiz', 'Fireblocks', 'Snyk', 'Orca Security', 'Aqua Security', 'Cato Networks', 'Cyera', 'Pentera',
  'Melio', 'Lemonade', 'Next Insurance', 'Rapyd', 'Tipalti', 'Papaya Global', 'Riskified',
  'Aidoc', 'Immunai', 'Pheno.AI', 'Longevity AI', 'Rubedo Life Sciences', 'Sight Diagnostics', 'K Health',
  'monday.com', 'Wix', 'Fiverr', 'JFrog', 'Verbit',
  'Aleph', 'Pitango', 'OurCrowd', 'Team8', 'Viola Ventures', 'TLV Partners', 'Glilot Capital',
  'Vertex Ventures Israel', 'Entrée Capital', 'F2 Venture Capital', 'Vintage Investment Partners',
  'Hetz Ventures', 'Grove Ventures', 'StageOne Ventures', 'JVP', 'Qumra Capital', '83North',
  'lool Ventures', 'NFX',
];

const SOURCE_HINTS = [
  'site:linkedin.com/jobs',
  'site:alljobs.co.il',
  'site:hiremetech.com',
  '(site:comeet.com OR site:boards.greenhouse.io OR site:jobs.lever.co)',
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

function tavily(key, query, max) {
  return fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query: query, search_depth: 'basic', max_results: max || 4 }),
  })
    .then(function (r) { return r.ok ? r.json() : { results: [] }; })
    .catch(function () { return { results: [] }; });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  const body = req.body || {};
  const broad = String(q.broad || body.broad || '') === '1';
  const startupFocus = String(q.startup != null ? q.startup : (body.startup != null ? body.startup : '1')) === '1';
  const roles = (q.roles || body.roles ? String(q.roles || body.roles).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : DEFAULT_ROLES);
  const companies = (q.companies || body.companies ? String(q.companies || body.companies).split(',').map(function (s) { return s.trim(); }).filter(Boolean) : DEFAULT_COMPANIES);
  const seniority = (q.seniority || body.seniority ? String(q.seniority || body.seniority).split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean) : DEFAULT_SENIORITY);
  const skills = (Array.isArray(body.skills) ? body.skills : String(body.skills || q.skills || '').split(',')).map(function (s) { return s.trim(); }).filter(Boolean);
  const cv = String(body.cv || '').slice(0, 6000);
  const userProfile = [String(body.summary || ''), String(body.bigPicture || ''), 'אזור: ' + String(body.homeArea || '')].filter(Boolean).join(' · ').slice(0, 600) || ROEI_PROFILE;

  const authed = req.headers['authorization'] === ('Bearer ' + process.env.CRON_SECRET);
  const force = authed || String(body.fresh || q.fresh || '') === '1';

  const cvSig = cv ? (cv.length + ':' + cv.slice(0, 40)) : '';
  const sig = JSON.stringify({ broad: broad, startupFocus: startupFocus, roles: roles, companies: companies, seniority: seniority, skills: skills, cvSig: cvSig });
  const hit = cacheMap.get(sig);
  if (!force && hit && Date.now() - hit.ts < CACHE_TTL) {
    return res.status(200).json(Object.assign({}, hit.data, { cached: true }));
  }

  const key = process.env.TAVILY_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(200).json({ jobs: [], apartments: [], summary: 'אין TAVILY_API_KEY', profile: ROEI_PROFILE, ts: new Date().toISOString() });

  const senTerms = seniority.map(function (s) { return s === 'entry' ? '"entry level"' : s; }).join(' OR ');
  const senPhrase = senTerms ? ('(' + senTerms + ')') : '';
  const startupTerm = startupFocus ? 'startup' : '';

  const roleN = broad ? 10 : 6;
  const compN = broad ? 8 : 4;
  const dayOffset = Math.floor(Date.now() / 86400000);

  const queries = [];
  for (let i = 0; i < Math.min(roleN, roles.length); i++) {
    const role = roles[(dayOffset + i) % roles.length];
    queries.push({ q: ('"' + role + '" ' + senPhrase + ' job Israel ' + startupTerm + ' 2026').replace(/\s+/g, ' ').trim(), role: role });
  }
  const sourceRole = roles[dayOffset % roles.length] || 'Analyst';
  SOURCE_HINTS.forEach(function (src) {
    queries.push({ q: (sourceRole + ' OR "Data Analyst" OR "Product" ' + senPhrase + ' Israel ' + src).replace(/\s+/g, ' ').trim(), role: '', source: src });
  });
  for (let i = 0; i < Math.min(compN, companies.length); i++) {
    const company = companies[(dayOffset + i) % companies.length];
    queries.push({ q: ('"' + company + '" careers jobs Israel ' + senPhrase).replace(/\s+/g, ' ').trim(), role: '', company: company });
  }
  if (startupFocus) {
    queries.push({ q: 'Israel startup ' + senPhrase + ' (AI OR longevity OR product OR analyst) open positions careers 2026', role: '', startup: true });
  }

  const responses = await Promise.all(queries.map(function (qq) { return tavily(key, qq.q, broad ? 5 : 4).then(function (d) { return { qq: qq, d: d }; }); }));
  const skillRx = skills.length ? new RegExp(skills.map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'i') : null;

  const rawJobs = [];
  responses.forEach(function (resp) {
    const qq = resp.qq, d = resp.d;
    (d.results || [])
      .filter(function (it) { return /^https?:\/\//i.test(it.url || ''); })
      .forEach(function (it) {
        const titleHay = (qq.role || '') + ' ' + (it.title || '');
        const wantsSenior = seniority.indexOf('senior') >= 0 || seniority.indexOf('mid') >= 0;
        if (!wantsSenior && SENIOR_RX.test(titleHay) && !JUNIOR_RX.test(titleHay)) return;
        const hay = titleHay + ' ' + (it.content || '');
        const typeKey = guessType(hay);
        rawJobs.push({
          title: qq.role || qq.company || 'משרה',
          company: qq.company || '',
          url: it.url,
          heading: it.title,
          snippet: (it.content || '').slice(0, 220),
          type: TYPE_HE[typeKey] || '',
          baseFit: (INTEREST_RX.test(hay) || (skillRx && skillRx.test(hay))) ? 1 : 0,
          source: qq.company ? 'company_site' : (qq.source ? qq.source.replace(/site:|[()]/g, '').split(' ')[0] : (qq.startup ? 'startup' : 'search')),
          published_date: it.published_date || null,
        });
      });
  });

  const seen = new Set();
  let jobs = rawJobs
    .filter(function (j) { return seen.has(j.url) ? false : (seen.add(j.url), true); })
    .sort(function (a, b) { return b.baseFit - a.baseFit; })
    .slice(0, broad ? 28 : 16);

  if (anthropic && jobs.length) {
    try {
      const list = jobs.map(function (j, i) { return i + '|' + j.heading + (j.company ? ' @' + j.company : '') + ' :: ' + j.snippet.slice(0, 120); }).join('\n');
      const cvBlock = cv ? ('\nקורות החיים שלו:\n' + cv.slice(0, 2800)) : '';
      const skillsBlock = skills.length ? ('\nמיומנויות: ' + skills.join(', ')) : '';
      const prompt =
        'אתה מאמן השמה כן וישיר (חצי אופטימי חצי ריאלי) עבור המועמד.\n' +
        'פרופיל: ' + userProfile + skillsBlock + cvBlock + '\n\n' +
        'לכל משרה ברשימה, החזר אך ורק JSON תקין במבנה: ' +
        '[{"i":<מספר>,"match":<0-100 התאמה הדדית כנה>,"why":"<משפט קצר בעברית למה זה מתאים לו>","gap":"<משפט קצר וכן בעברית מה חסר לו / איך לשפר סיכויים>"}].\n' +
        'הערך גם את התאמת המועמד למשרה וגם את התאמת המשרה למועמד. היה כן — אל תנפח אחוזים. משרות:\n' + list;
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropic, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
      });
      const d = await r.json();
      const txt = (d.content && d.content[0] && d.content[0].text) || '';
      const m = txt.match(/\[[\s\S]*\]/);
      if (m) {
        const scored = JSON.parse(m[0]);
        scored.forEach(function (s) {
          if (jobs[s.i]) {
            jobs[s.i].match = Math.max(0, Math.min(100, parseInt(s.match) || 0));
            jobs[s.i].why = String(s.why || '').slice(0, 240);
            jobs[s.i].gap = String(s.gap || '').slice(0, 240);
          }
        });
        jobs.sort(function (a, b) { return (b.match || 0) - (a.match || 0); });
      }
    } catch (e) {}
  }
  jobs.forEach(function (j) { if (typeof j.match !== 'number') j.match = j.baseFit ? 55 : 40; });

  const strong = jobs.filter(function (j) { return (j.match || 0) >= 75; });

  const apartments = [];
  try {
    const d = await tavily(key, 'חדר בדירת שותפים תל אביב דיזינגוף-כרם התימנים 2026', 3);
    (d.results || []).filter(function (it) { return /^https?:\/\//i.test(it.url || ''); }).slice(0, 2)
      .forEach(function (it) { apartments.push({ url: it.url, heading: it.title, snippet: (it.content || '').slice(0, 180), published_date: it.published_date || null }); });
  } catch (e) {}

  let summary = '';
  if (jobs.length) {
    const top = jobs.slice(0, 3).map(function (j) { return j.heading + (j.company ? ' @' + j.company : '') + ' (' + (j.match || 0) + '%)'; }).join(' | ');
    summary = strong.length ? ('🔥 ' + strong.length + ' משרות עם התאמה גבוהה. מובילות: ' + top) : ('נמצאו ' + jobs.length + ' משרות. מובילות: ' + top);
  }

  const result = { jobs: jobs, apartments: apartments, summary: summary, strongCount: strong.length, queriesCount: queries.length, broad: broad, startupFocus: startupFocus, usedCV: !!cv, profile: userProfile, ts: new Date().toISOString() };
  cacheMap.set(sig, { data: result, ts: Date.now() });
  return res.status(200).json(result);
}
