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

// ═══════════════════════════════════════════════════════════════════════════
//  COMEET COMPANY-BOARD SCANNER  (migrated from the Railway bot — 07/2026)
//  Free public API, zero keys. The token is NOT stored anywhere: it is a public,
//  rotating token that Comeet embeds in the careers page, resolved at scan time:
//    1) GET https://www.comeet.com/jobs/{slug}/{uid}   → "token":"…" in the HTML
//    2) GET https://www.comeet.com/careers-api/2.0/company/{uid}/positions
//          ?token=<resolved>&details=true              → JSON array of positions
//  Purely ADDITIVE: every failure path returns an empty list, so if Comeet is
//  down / blocks us / changes shape, this endpoint behaves exactly as before.
// ═══════════════════════════════════════════════════════════════════════════

// The board list + filters live in whatsapp-bot/job-hunt-config.js (single source
// of truth, shared with the bot). It is imported dynamically so that a bundling /
// resolution failure on Vercel can never break this endpoint — we just fall back
// to the inline list below.
const FALLBACK_COMEET_BOARDS = [
  { name: 'Port', slug: 'port', uid: '59.004', interest: 3, domain: 'product' },
  { name: 'Dream (AI security)', slug: 'dreamgroup', uid: '99.002', interest: 3, domain: 'ai' },
  { name: 'Arpeely', slug: 'arpeely', uid: '57.001', interest: 3, domain: 'data' },
  { name: 'Team8 (portfolio)', slug: 'team8', uid: '61.003', interest: 3, domain: 'vc' },
  { name: 'DealHub', slug: 'dealhub', uid: '86.005', interest: 2, domain: 'product' },
  { name: 'Bounce AI', slug: 'bounce', uid: 'E9.00C', interest: 2, domain: 'fintech' },
  { name: 'CommIT', slug: 'comm-it', uid: '76.008', interest: 2, domain: 'data' },
  { name: 'Guideline Group', slug: 'guideline', uid: '89.009', interest: 2, domain: 'fintech' },
  { name: 'Cust2Mate', slug: 'cust2mate', uid: '6A.00D', interest: 2, domain: 'data' },
];
const FALLBACK_BLOCKLIST = /\b(senior|sr\.?|staff|principal|lead|head|director|vp|chief|architect|expert|manager(?!.*(junior|associate|intern))|frontend|backend|fullstack|full-stack|devops|qa|embedded|hardware|mechanical|electrical|attorney|lawyer|nurse|physician)\b/i;
const FALLBACK_LOCATION_ALLOW = /(tel.?aviv|ramat.?gan|givatayim|herzliya|petah|petach|ra'?anana|raanana|bnei.?brak|holon|rosh.?ha'?ayin|or.?yehuda|kfar.?saba|netanya|israel|tlv|תל אביב|רמת גן|הרצליה|פתח|רעננה|ישראל)/i;
const FALLBACK_TITLE_MATCH = /(analyst|analytics|data|business intelligence|\bbi\b|\bai\b|genai|generative|\bllm\b|prompt|machine learning|\bml\b|product manager|product owner|product analyst|product operations|product ops|product associate|product specialist|\bapm\b|growth|marketing|monetization|user acquisition|business development|bizdev|bizops|revops|revenue operations|operations|strategy|investment|venture|\bvc\b|private equity|equity research|financial analyst|fp&a|m&a|corporate development|economist|credit|portfolio|fintech|research|chief of staff|partnerships|intern|internship|student|junior|associate)/i;

let _jhCfg = null;
async function comeetConfig() {
  if (_jhCfg) return _jhCfg;
  try {
    const m = await import('../whatsapp-bot/job-hunt-config.js');
    const boards = (m.COMPANIES || [])
      .filter(function (c) { return c && c.comeet && c.comeet.slug && c.comeet.uid; })
      .map(function (c) { return { name: c.name, slug: c.comeet.slug, uid: c.comeet.uid, interest: c.interest || 2, domain: c.domain || '' }; });
    if (boards.length) {
      _jhCfg = {
        boards: boards,
        block: m.TITLE_BLOCKLIST || FALLBACK_BLOCKLIST,
        loc: m.LOCATION_ALLOW || FALLBACK_LOCATION_ALLOW,
        match: typeof m.buildTitleRegex === 'function' ? m.buildTitleRegex() : FALLBACK_TITLE_MATCH,
        cfgSource: 'shared-config',
      };
      return _jhCfg;
    }
  } catch (e) {}
  _jhCfg = { boards: FALLBACK_COMEET_BOARDS, block: FALLBACK_BLOCKLIST, loc: FALLBACK_LOCATION_ALLOW, match: FALLBACK_TITLE_MATCH, cfgSource: 'fallback' };
  return _jhCfg;
}

const _comeetTokenCache = new Map(); // `${slug}/${uid}` → token (warm per lambda instance)

function fetchT(url, ms) {
  const ac = new AbortController();
  const t = setTimeout(function () { ac.abort(); }, ms);
  if (t && typeof t.unref === 'function') t.unref();
  return fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PersonalOS-JobHunt/1.0)' } })
    .then(function (r) { clearTimeout(t); return r; })
    .catch(function (e) { clearTimeout(t); throw e; });
}

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise(function (resolve) { const t = setTimeout(function () { resolve(null); }, ms); if (t && typeof t.unref === 'function') t.unref(); }),
  ]);
}

function comeetLoc(p) {
  const l = p && p.location;
  if (!l) return '';
  if (typeof l === 'string') return l;
  return String(l.displayName || l.name || [l.city, l.country].filter(Boolean).join(', ') || '');
}

function comeetDesc(p) {
  let txt = '';
  const det = Array.isArray(p && p.details) ? p.details : [];
  det.forEach(function (d) {
    if (!d) return;
    if (typeof d === 'string') { txt += ' ' + d; return; }
    const v = d.value != null ? d.value : (d.text != null ? d.text : (d.content != null ? d.content : ''));
    if (v) txt += ' ' + String(v);
  });
  if (!txt.trim()) txt = [p && p.description, p && p.summary, p && p.department, p && p.experienceLevel, p && p.employmentType].filter(Boolean).join(' · ');
  return String(txt)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function comeetDate(p) {
  const raw = (p && (p.time_updated || p.date_published || p.updated_at || p.time_created)) || null;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return isNaN(t) ? null : new Date(t).toISOString();
}

// Scan ONE board. Returns an array of jobs on success, or null when the board
// failed (so we can report an honest "N of M boards scanned" counter).
async function scanComeetBoard(b, cfg) {
  const ck = b.slug + '/' + b.uid;
  let token = _comeetTokenCache.get(ck) || null;
  if (!token) {
    const hr = await fetchT('https://www.comeet.com/jobs/' + encodeURIComponent(b.slug) + '/' + encodeURIComponent(b.uid), 6000);
    if (!hr.ok) return null;
    const html = await hr.text();
    const m = html.match(/"token"\s*:\s*"([A-Za-z0-9_-]{16,64})"/);
    token = m ? m[1] : null;
    if (!token) return null;
    _comeetTokenCache.set(ck, token);
  }
  const pr = await fetchT('https://www.comeet.com/careers-api/2.0/company/' + encodeURIComponent(b.uid) + '/positions?token=' + encodeURIComponent(token) + '&details=true', 8000);
  if (!pr.ok) { _comeetTokenCache.delete(ck); return null; } // token probably rotated → re-resolve next run
  const d = await pr.json();
  const list = Array.isArray(d) ? d : (d && Array.isArray(d.positions) ? d.positions : []);
  const out = [];
  list.forEach(function (p) {
    if (!p) return;
    const title = String(p.name || p.position_name || '').trim();
    const url = String(p.url_comeet_hosted_page || p.url_active_page || p.url || '').trim();
    const loc = comeetLoc(p);
    if (!title || !/^https?:\/\//i.test(url)) return;
    if (!cfg.loc.test(loc)) return;          // Israel / center only
    if (cfg.block.test(title)) return;       // senior / irrelevant roles out
    if (!cfg.match.test(title)) return;      // must match Roei's role taxonomy
    const desc = comeetDesc(p);
    const hay = title + ' ' + (p.experienceLevel || '') + ' ' + desc;
    out.push({
      title: title,
      company: b.name,
      url: url,
      heading: title,
      snippet: (desc || [p.department, p.experienceLevel, loc].filter(Boolean).join(' · ')).slice(0, 220),
      type: TYPE_HE[guessType(hay)] || '',
      baseFit: 2, // real board listing with a direct apply link — outranks web-search hits
      source: 'comeet',
      published_date: comeetDate(p),
      location: loc,
    });
  });
  return out;
}

// Scan all configured Comeet boards in parallel. Never throws.
async function scanComeetBoards(limit) {
  const empty = { jobs: [], scanned: 0, total: 0, cfgSource: 'none' };
  try {
    const cfg = await comeetConfig();
    const boards = cfg.boards || [];
    if (!boards.length) return empty;
    const settled = await Promise.allSettled(
      boards.map(function (b) { return withTimeout(scanComeetBoard(b, cfg), 14000); })
    );
    const jobs = [];
    let scanned = 0;
    settled.forEach(function (s) {
      if (s.status !== 'fulfilled' || !Array.isArray(s.value)) return; // null = timeout/non-200/throw → skip silently
      scanned++;
      s.value.forEach(function (j) { jobs.push(j); });
    });
    return { jobs: jobs.slice(0, limit || 12), scanned: scanned, total: boards.length, cfgSource: cfg.cfgSource };
  } catch (e) {
    return empty;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  const body = req.body || {};

  // ═══════════════════════════════════════════════════════════════════════════
  //  REFERRER ENGINE (Phase 3) — POST {mode:'referrers', company, title}
  //  2 Tavily LinkedIn searches → Claude Haiku classifies + drafts ready Hebrew
  //  outreach messages (≤300 chars, tailored per connection type). Silent
  //  empty-array fallback whenever keys/network/parse fail.
  // ═══════════════════════════════════════════════════════════════════════════
  if (req.method === 'POST' && String(body.mode || '') === 'referrers') {
    const rkey = process.env.TAVILY_API_KEY;
    const ranthropic = process.env.ANTHROPIC_API_KEY;
    const rcompany = String(body.company || '').slice(0, 120).trim();
    const rtitle = String(body.title || '').slice(0, 160).trim();
    if (!rkey || !rcompany) return res.status(200).json({ referrers: [] });
    try {
      const rq1 = 'site:linkedin.com/in "' + rcompany + '" (analyst OR data OR "talent acquisition" OR recruiter OR "team lead")';
      const rq2 = 'site:linkedin.com/in "' + rcompany + '" "Bar-Ilan"';
      const rr = await Promise.all([tavily(rkey, rq1, 6), tavily(rkey, rq2, 4)]);
      const seenU = new Set();
      const cand = [];
      [].concat(rr[0].results || [], rr[1].results || []).forEach(function (it) {
        if (!/linkedin\.com\/in\//i.test(it.url || '')) return;
        if (seenU.has(it.url)) return;
        seenU.add(it.url);
        cand.push({ url: it.url, heading: it.title || '', snippet: (it.content || '').slice(0, 180) });
      });
      const top = cand.slice(0, 8);
      if (!top.length || !ranthropic) return res.status(200).json({ referrers: [] });
      const list = top.map(function (c, i) { return i + '|' + c.heading + ' :: ' + c.snippet + ' :: ' + c.url; }).join('\n');
      const rprompt =
        'אתה עוזר גיוס שמסייע למועמד ישראלי בשם רואי קליין למצוא ממליצים (referrals) בחברה "' + rcompany + '" עבור משרת "' + rtitle + '".\n' +
        'לפניך תוצאות חיפוש של פרופילי לינקדאין. לכל פרופיל שנראה עובד/ת בחברה, סווג את סוג הקשר והכן הודעת פנייה קצרה בעברית מוכנה לשליחה.\n' +
        'סוגי קשר (connection_type): "מגייסת" (recruiter / talent acquisition / HR), "עמית מקצועי" (אנליסט / דאטה / תפקיד דומה בצוות), "בוגר בר-אילן" (למד/ה בבר-אילן), "מוביל צוות" (team lead / manager).\n' +
        'החזר אך ורק JSON תקין במבנה: [{"name":"<שם מלא>","role":"<תפקיד בחברה>","linkedin_url":"<url>","connection_type":"<אחד מהסוגים>","message":"<הודעת פנייה בעברית עד 300 תווים>"}].\n' +
        'כללי ניסוח ההודעה לפי סוג: מגייסת → פנייה ישירה ומנומסת המזכירה את המשרה "' + rtitle + '" ומבקשת להעביר קורות חיים (בסגנון תבנית Ospovat למגייסים). עמית מקצועי → בקשת הפניה (referral) המזכירה בעדינות "חבר מביא חבר" ואת המשרה "' + rtitle + '". מוביל צוות → פיץ׳ קצר וממוקד על ההתאמה למשרה "' + rtitle + '". בוגר בר-אילן → פנייה חמה על בסיס הרקע האקדמי המשותף בבר-אילן ובקשת עצה/הפניה למשרה "' + rtitle + '".\n' +
        'כל הודעה חייבת: להזכיר את שם המשרה המדויק "' + rtitle + '", להיות עד 300 תווים, כתובה בעברית, חתומה בשם רואי. אם פרופיל לא נראה רלוונטי לחברה — דלג עליו לגמרי.\n' +
        'פרופילים:\n' + list;
      const ar = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ranthropic, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1800, messages: [{ role: 'user', content: rprompt }] }),
      });
      const ad = await ar.json();
      const atxt = (ad.content && ad.content[0] && ad.content[0].text) || '';
      const am = atxt.match(/\[[\s\S]*\]/);
      let referrers = [];
      if (am) { try { referrers = JSON.parse(am[0]); } catch (e) { referrers = []; } }
      if (!Array.isArray(referrers)) referrers = [];
      referrers = referrers
        .filter(function (x) { return x && (x.name || x.linkedin_url); })
        .map(function (x) {
          return {
            name: String(x.name || '').slice(0, 120),
            role: String(x.role || '').slice(0, 160),
            linkedin_url: String(x.linkedin_url || '').slice(0, 400),
            connection_type: String(x.connection_type || '').slice(0, 40),
            message: String(x.message || '').slice(0, 320),
          };
        })
        .slice(0, 6);
      return res.status(200).json({ referrers: referrers });
    } catch (e) {
      return res.status(200).json({ referrers: [] });
    }
  }

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
  // Company-board scan is expensive (≈18 extra fetches) → only on a FULL hunt:
  // the 08:00 cron (authed) or "הפעל ציד עכשיו" (fresh=1). A plain app load reads
  // the cached result instead. Opt out explicitly with boards=0.
  const doBoards = force && String(body.boards != null ? body.boards : (q.boards != null ? q.boards : '1')) !== '0';

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

  // Tavily searches + Comeet company boards run in PARALLEL — the board scan is
  // capped at ~14s per board and adds ~0 wall time on top of the web searches.
  const settledAll = await Promise.all([
    Promise.all(queries.map(function (qq) { return tavily(key, qq.q, broad ? 5 : 4).then(function (d) { return { qq: qq, d: d }; }); })),
    doBoards ? scanComeetBoards(12) : Promise.resolve({ jobs: [], scanned: 0, total: 0, cfgSource: 'skipped' }),
  ]);
  const responses = settledAll[0];
  const comeet = settledAll[1];
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

  // Merge Comeet board jobs BEFORE dedup + Haiku scoring, so they get real match
  // scores exactly like the Tavily jobs. Board jobs come first → on a URL clash the
  // direct apply link wins over the web-search hit. Their slots are added on top of
  // the normal cap so they never displace search results.
  const comeetJobs = (comeet && Array.isArray(comeet.jobs)) ? comeet.jobs : [];
  const seen = new Set();
  let jobs = comeetJobs.concat(rawJobs)
    .filter(function (j) { return seen.has(j.url) ? false : (seen.add(j.url), true); })
    .sort(function (a, b) { return b.baseFit - a.baseFit; })
    .slice(0, (broad ? 28 : 16) + comeetJobs.length);

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
        // scale the budget with the list size (board jobs can push it past 28 items) —
        // a truncated JSON array would silently lose ALL the scores.
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: Math.min(4000, 800 + jobs.length * 90), messages: [{ role: 'user', content: prompt }] }),
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
            // pass through interview_chance if the scorer/upstream provided one (no-op otherwise)
            if (s.interview_chance != null) jobs[s.i].interview_chance = s.interview_chance;
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
    if (comeet.scanned) summary += ' · ' + comeet.scanned + ' לוחות חברה נסרקו (' + comeetJobs.length + ' משרות ישירות)';
  }

  // queriesCount feeds the client's "סרקתי N חיפושים/אתרים" line → include the boards.
  const result = {
    jobs: jobs, apartments: apartments, summary: summary, strongCount: strong.length,
    queriesCount: queries.length + (comeet.scanned || 0),
    searchesCount: queries.length,
    boardsScanned: comeet.scanned || 0,
    boardsTotal: comeet.total || 0,
    boardJobs: comeetJobs.length,
    boardsConfig: comeet.cfgSource || 'skipped',
    broad: broad, startupFocus: startupFocus, usedCV: !!cv, profile: userProfile, ts: new Date().toISOString(),
  };
  cacheMap.set(sig, { data: result, ts: Date.now() });
  return res.status(200).json(result);
}
