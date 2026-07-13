// job-hunt-agent.js — Autonomous job-hunt agent running inside the Railway WhatsApp bot.
// Runs 2x/day (07:30 + 13:00 Asia/Jerusalem): Apify LinkedIn scrape → Claude scoring →
// upload matches to Personal OS via /api/webhook → WhatsApp report to Roei.
//
// ENV (Railway): APIFY_TOKEN (required), ANTHROPIC_API_KEY (exists), WEBHOOK_SECRET (if set on Vercel)
// State persisted in /data (Railway volume) for budget tracking + dedupe.

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { ROLE_DOMAINS, COMPANIES, TITLE_BLOCKLIST, LOCATION_ALLOW, buildTitleRegex } from './job-hunt-config.js';

const API_URL     = process.env.PERSONAL_OS_URL || 'https://personal-os-coral-tau.vercel.app';
const APIFY_TOKEN = process.env.APIFY_TOKEN || '';
const ACTOR       = 'curious_coder~linkedin-jobs-scraper';
const STATE_FILE  = (existsSync('/data') ? '/data' : '.') + '/jobhunt-state.json';
const SIG         = ' — מערכת רואי 🤖';
const TZ          = 'Asia/Jerusalem';

// Budget: actor = $0.001/result, $5/month free credit. Hard caps:
const PER_SEARCH    = 10;   // results per search
const PER_RUN       = 20;   // results per run (2 searches)
const MONTHLY_CAP   = 4000; // results/month ≈ $4.0 — leaves margin under $5
// Applicant-crowding threshold: LinkedIn has NO public URL param for "under N
// applicants", so we parse the count from scraped data and score on our side.
// ≤ MAX_APPLICANTS = uncrowded (boost); 26–100 = neutral; >100 = skip entirely.
const MAX_APPLICANTS = 25;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Search keyword pools — derived from the full role taxonomy ───────────────
const POOL_AI_GROWTH = [...ROLE_DOMAINS.ai_data.linkedinKeywords, ...ROLE_DOMAINS.growth_marketing.linkedinKeywords];
const POOL_PRODUCT   = [...ROLE_DOMAINS.product.linkedinKeywords, ...ROLE_DOMAINS.student_intern.linkedinKeywords];
const POOL_FINANCE   = [...ROLE_DOMAINS.finance_investments.linkedinKeywords, ...ROLE_DOMAINS.business_strategy.linkedinKeywords];
const TITLE_MATCH_RE = buildTitleRegex();

const SENIOR_RE = /\b(senior|sr\.?|staff|principal|lead|head|director|vp|chief|architect|expert)\b/i;
const MANAGER_OK_RE = /\b(junior|associate|jr\.?|student|intern)\b/i;
const ABROAD_RE = /\b(bangkok|relocation|remote.{0,15}(us|usa|europe)|based in (?!israel))\b/i;

// Ghost-job warning prefix (added to the description when a LinkedIn posting is
// not found on the company's own ATS/Comeet career page).
const GHOST_PREFIX = '⚠️ ייתכן משרת רפאים — לא נמצאה בדף הקריירה. ';

// ── Applicant-count parsing (LinkedIn has no URL filter for this) ─────────────
// Try the structured Apify fields first, then fall back to regexes on any text
// snippet. Returns an integer applicant count, or null when unknown.
function parseApplicants(j) {
  if (!j) return null;
  for (const v of [j.applicantsCount, j.applicationsCount, j.applicants]) {
    if (v === null || v === undefined || v === '') continue;
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const txt = `${j.applicantsText || ''} ${j.descriptionText || j.description || ''}`;
  let m = txt.match(/(\d+)\s*applicants/i);
  if (m) return parseInt(m[1], 10);
  m = txt.match(/Be among the first (\d+)/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

// ── Interview-chance model (mirrors the client-side interviewChance in index.html) ──
// base by score, × freshness multiplier from posted date, × ghost penalty,
// × applicant-crowding multiplier; clamp 1-40.
function computeInterviewChance(job, score, ghost) {
  const base = score >= 85 ? 12 : score >= 75 ? 8 : score >= 65 ? 5 : 3;
  const ref = new Date(job.postedAt || job.postedDate || job.posted || 0).getTime();
  const ageH = ref > 0 ? (Date.now() - ref) / 3600000 : 9999;
  let mult = ageH < 24 ? 1.5 : ageH < 72 ? 1.0 : ageH < 168 ? 0.6 : 0.25;
  if (ghost) mult *= 0.3;
  // Crowding: ≤25 applicants → boost, 26–100 → neutral, >100 → penalty. Unknown → neutral.
  const ap = job.applicants;
  if (typeof ap === 'number') mult *= ap <= MAX_APPLICANTS ? 1.3 : ap <= 100 ? 1.0 : 0.6;
  return Math.max(1, Math.min(40, Math.round(base * mult) || 1));
}

// ── Company / title normalization (ghost detection: match LinkedIn ↔ ATS results) ──
function normCompany(n) { return (n || '').toLowerCase().replace(/[^a-z0-9֐-׿]/g, ''); }
function companyMatches(a, b) {
  a = normCompany(a); b = normCompany(b);
  if (!a || !b || a.length < 3 || b.length < 3) return false;
  return a === b || a.includes(b) || b.includes(a);
}
function normTitle(t) { return (t || '').toLowerCase().replace(/[^a-z0-9֐-׿ ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function titlesSimilar(a, b) {
  a = normTitle(a); b = normTitle(b);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const wa = new Set(a.split(' ').filter(w => w.length > 2));
  const wb = new Set(b.split(' ').filter(w => w.length > 2));
  let inter = 0; for (const w of wa) if (wb.has(w)) inter++;
  return inter / (Math.min(wa.size, wb.size) || 1) >= 0.5;
}

// ── State (budget + dedupe) ──────────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  try { writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { console.error('[jobhunt] state save:', e.message); }
}
function monthKey() { return new Date().toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7); }

// ── Apify ────────────────────────────────────────────────────────────────────
// Smart freshness: daily runs only look at the last 24h (cheap, no repeats);
// Sunday morning does one broad weekly sweep to catch anything missed.
function timeFilter() {
  const dow = new Date().toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
  const hour = parseInt(new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit' }), 10);
  return (dow === 'Sun' && hour < 13) ? 'r604800' : 'r86400';
}

function linkedinUrl(keywords, location) {
  return `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}&f_E=1%2C2&f_TPR=${timeFilter()}`;
}

async function apifySearch(keywords, location) {
  const input = { urls: [linkedinUrl(keywords, location)], count: PER_SEARCH, scrapeCompany: false };
  const start = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?token=${APIFY_TOKEN}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }).then(r => r.json());
  const runId = start?.data?.id;
  if (!runId) throw new Error('Apify run failed to start: ' + JSON.stringify(start).slice(0, 200));

  // Poll up to 4 minutes
  for (let i = 0; i < 48; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const run = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`).then(r => r.json());
    const status = run?.data?.status;
    if (status === 'SUCCEEDED') {
      const dsId = run.data.defaultDatasetId;
      return fetch(`https://api.apify.com/v2/datasets/${dsId}/items?token=${APIFY_TOKEN}&limit=${PER_SEARCH}&fields=id,title,companyName,location,link,seniorityLevel,descriptionText,postedAt,applicantsCount,applicationsCount,applicants,applicantsText`).then(r => r.json());
    }
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) throw new Error('Apify run ' + status);
  }
  throw new Error('Apify run timeout');
}

// ── Company career pages — FREE scanning via public ATS APIs ─────────────────
// Greenhouse and Lever expose public job-board JSON; no scraping cost at all.
// Each run scans a rotating slice of the curated company list.
const COMPANIES_PER_RUN = 10;

async function scanCompanies(day, runIdx) {
  const scannable = COMPANIES.filter(c => c.ats);
  const picked = [];
  for (let i = 0; i < COMPANIES_PER_RUN && i < scannable.length; i++) {
    picked.push(scannable[(day * COMPANIES_PER_RUN * 2 + runIdx * COMPANIES_PER_RUN + i) % scannable.length]);
  }
  const jobs = [];
  const scannedNames = [];
  let okCount = 0;
  for (const c of picked) {
    try {
      let list = [];
      if (c.ats.type === 'greenhouse') {
        const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${c.ats.slug}/jobs`);
        if (!r.ok) continue;
        const d = await r.json();
        list = (d.jobs || []).map(j => ({ title: j.title || '', loc: (j.location && j.location.name) || '', link: j.absolute_url || '' }));
      } else if (c.ats.type === 'lever') {
        const r = await fetch(`https://api.lever.co/v0/postings/${c.ats.slug}?mode=json`);
        if (!r.ok) continue;
        const d = await r.json();
        list = (Array.isArray(d) ? d : []).map(j => ({ title: j.text || '', loc: (j.categories && j.categories.location) || '', link: j.hostedUrl || '' }));
      }
      okCount++;
      scannedNames.push(c.name);
      for (const j of list) {
        if (!LOCATION_ALLOW.test(j.loc)) continue;
        if (TITLE_BLOCKLIST.test(j.title)) continue;
        if (!TITLE_MATCH_RE.test(j.title)) continue;
        jobs.push({
          id: j.link, title: j.title, companyName: c.name, location: j.loc, link: j.link,
          seniorityLevel: '', descriptionText: `source:company-careers interest:${c.interest} domain:${c.domain}`,
        });
      }
    } catch (e) { console.error('[jobhunt] company scan', c.name, e.message); }
  }
  console.log(`[jobhunt] company scan: ${okCount}/${picked.length} boards ok → ${jobs.length} candidate roles`);
  return { jobs: jobs.slice(0, 25), scanned: okCount, scannedNames };
}

// ── Comeet career pages — FREE scanning via public Comeet API ─────────────────
// Companies with a `comeet:{uid,token}` config expose their live positions at
// https://www.comeet.co/careers-api/2.0/company/{uid}/positions?token=...&details=true
// (uid + token are embedded in the public careers page source). Same job shape +
// filters as scanCompanies. Errors are skipped silently (non-200 → skip).
async function scanComeet() {
  const withComeet = COMPANIES.filter(c => c.comeet && c.comeet.uid && c.comeet.token);
  const jobs = [];
  const scannedNames = [];
  let okCount = 0;
  for (const c of withComeet) {
    try {
      const r = await fetch(`https://www.comeet.co/careers-api/2.0/company/${c.comeet.uid}/positions?token=${c.comeet.token}&details=true`);
      if (!r.ok) continue;
      const d = await r.json();
      const list = Array.isArray(d) ? d : (Array.isArray(d && d.positions) ? d.positions : []);
      okCount++;
      scannedNames.push(c.name);
      for (const p of list) {
        const title = p.name || p.position_name || '';
        const loc = p.location
          ? (p.location.name || [p.location.city, p.location.country].filter(Boolean).join(', '))
          : '';
        const link = p.url_comeet_hosted_page || p.url_active_page || p.url || '';
        if (!LOCATION_ALLOW.test(loc)) continue;
        if (TITLE_BLOCKLIST.test(title)) continue;
        if (!TITLE_MATCH_RE.test(title)) continue;
        jobs.push({
          id: link || `${c.name}|${title}`, title, companyName: c.name, location: loc, link,
          seniorityLevel: '', descriptionText: `source:company-careers interest:${c.interest} domain:${c.domain}`,
        });
      }
    } catch (e) { console.error('[jobhunt] comeet scan', c.name, e.message); }
  }
  console.log(`[jobhunt] comeet scan: ${okCount}/${withComeet.length} boards ok → ${jobs.length} candidate roles`);
  return { jobs: jobs.slice(0, 25), scanned: okCount, scannedNames };
}

// ── Candidate profile — defaults to Roei, overridden by synced CV/profile ────
const DEFAULT_PROFILE = {
  name: 'Roei Klein', location: 'Tel Aviv',
  summary: 'M.Sc Information Science & Applied AI (active student, Bar-Ilan). B.A. Economics & Management (GPA 88). Founder of Upselles startup (product, GTM, growth analytics).',
  skills: ['Python', 'SQL', 'data analysis', 'KPI dashboards', 'prompt engineering', 'LLMs', 'product thinking', 'growth', 'business strategy'],
  bigPicture: 'founding a startup — value roles that teach new domains, build network, give exposure to interesting industries, or lead to Product/business leadership',
  seniority: 'student / junior / entry only (≤2 years experience)',
  locations: "Tel Aviv best, then Petah Tikva / Herzliya / Ra'anana / center; rest of Israel lower; outside Israel = 0",
  cv: '',
};

// Read the user's synced profile + CV from the browser state mirror written by
// the Personal OS /sync endpoint (pos-state.json on the Railway volume). This
// is how a CV pasted in the app's job-hunt panel reaches the scoring engine —
// and how multi-user works: each user's own jobHuntConfig drives their scoring.
function loadProfile() {
  try {
    const synced = JSON.parse(readFileSync((existsSync('/data') ? '/data' : '.') + '/pos-state.json', 'utf8'));
    const S = synced && synced.state;
    const cfg = S && (S.jobHuntConfig || (S.jobHunt && S.jobHunt.config));
    if (!cfg) return DEFAULT_PROFILE;
    return {
      name: cfg.name || DEFAULT_PROFILE.name,
      location: cfg.homeArea || DEFAULT_PROFILE.location,
      summary: cfg.summary || DEFAULT_PROFILE.summary,
      skills: Array.isArray(cfg.skills) && cfg.skills.length ? cfg.skills : DEFAULT_PROFILE.skills,
      bigPicture: cfg.bigPicture || DEFAULT_PROFILE.bigPicture,
      seniority: cfg.seniority || DEFAULT_PROFILE.seniority,
      locations: cfg.locations || DEFAULT_PROFILE.locations,
      cv: (cfg.cv || '').slice(0, 4000),
    };
  } catch { return DEFAULT_PROFILE; }
}

// ── Claude scoring ───────────────────────────────────────────────────────────
async function scoreJobs(jobs, runType) {
  const p = loadProfile();
  const compact = jobs.map((j, i) => ({
    i, title: j.title, company: j.companyName, location: j.location,
    seniority: j.seniorityLevel, desc: (j.descriptionText || '').slice(0, 500),
  }));
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `You are a precise job-matching engine. Score each job 0-100 for THIS candidate and return ONLY a JSON array, one object per job:
[{"i":0,"score":NN,"cat":"AI/Data|Product|Growth|Business|Finance","level":"student|junior|entry|mid|senior","reason":"one short Hebrew sentence: why it fits + how it serves the big picture","fit":"2 short Hebrew sentences explaining the match in depth","matched":["skill1","skill2"],"gaps":["missing1"],"knockouts":[{"req":"short Hebrew label of the hard requirement","pass":true}],"breakdown":{"skills":NN,"seniority":NN,"domain":NN,"location":NN,"bigpicture":NN},"cv":{"summary":"2-line professional summary tailored to THIS job","bullets":["XYZ bullet 1","XYZ bullet 2","XYZ bullet 3"],"missing":["keyword1","keyword2"]}}]

KNOCKOUTS (hard requirements — check each job's text and return a "knockouts" array):
- Evaluate ONLY these hard, disqualifying requirements when the posting explicitly states them: (1) minimum years of experience the candidate cannot meet (candidate has ≤2 years), (2) a required spoken/written language the candidate lacks (candidate: Hebrew + English only), (3) a mandatory on-site location that conflicts with the candidate's allowed areas, (4) a required academic degree or professional certification the candidate does not hold.
- For each hard requirement the posting states, add {"req":"<short Hebrew label, e.g. '5+ שנות ניסיון' / 'שפה: רוסית' / 'משרה במשרד בחיפה' / 'תואר בהנדסה'>","pass":<true if the candidate meets it, false if it disqualifies him>}.
- If the posting states NO hard requirements, return "knockouts":[] (empty array). Do NOT invent requirements — only ones explicitly present in the text.

TAILORED CV (only for jobs you score >=70 — for jobs <70 OMIT the "cv" field entirely to save tokens):
- Add a "cv" object that reframes the candidate's REAL CV toward this specific job, embedding the job's top missing keywords.
- Each bullet uses the Google XYZ formula: "Accomplished X as measured by Y by doing Z".
- STAY STRICTLY TRUTHFUL — reframe, reorder and emphasize EXISTING facts only. NEVER invent experience, titles, tools, employers, or metrics. For any unknown number use the literal placeholder "[add %]" — never a made-up figure.
- Base the bullets only on the candidate's real background (Upselles founder — data architecture/KPIs/product analytics; independent market analyst & trader; ex real-estate agent; M.Sc Data Science & AI; B.A. Economics).

SCORING METHOD (compute, don't guess):
- skills (0-100): overlap between the job's required skills and the candidate's skills.
- seniority (0-100): 100 if explicitly student/junior/entry/intern; 60 if unspecified-but-plausible; if it needs 3+ years → max 40 and CAP the total score at 50.
- domain (0-100): how interesting/relevant the field is to the candidate's goals.
- location (0-100): per the location rule below. Outside Israel → 0 and total score 0.
- bigpicture (0-100): how much the role teaches new domains / builds network / leads toward Product or business leadership.
- total "score" = round( skills*0.30 + seniority*0.25 + domain*0.20 + location*0.10 + bigpicture*0.15 ), then apply caps.
- "level": classify the seniority of the posting itself (student/junior/entry/mid/senior).
- Jobs whose desc contains "source:company-careers" are from companies the candidate hand-picked — add +5 to total, +5 more if "interest:3".
Be honest and consistent. Do not inflate.

CANDIDATE: ${p.name}, ${p.location}. ${p.summary}
Skills: ${p.skills.join(', ')}.
LONG-TERM GOAL: ${p.bigPicture}.
SENIORITY FILTER: ${p.seniority}.
LOCATION RULE: ${p.locations}.${p.cv ? '\nCV (use it to judge skills overlap precisely):\n' + p.cv : ''}
RUN TYPE: ${runType}

JOBS:
${JSON.stringify(compact)}`,
    }],
  });
  const text = msg.content[0].text;
  const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  return JSON.parse(json);
}

// ── Personal OS upload (webhook queue → frontend POS.addJob) ────────────────
async function uploadJob(job, m) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.WEBHOOK_SECRET) headers['X-Webhook-Secret'] = process.env.WEBHOOK_SECRET;
  const r = await fetch(`${API_URL}/api/webhook`, {
    method: 'POST', headers,
    body: JSON.stringify({
      action: 'add_job',
      data: {
        title: job.title, company: job.companyName, status: 'ready_to_apply',
        link: (job.link || '').split('?')[0], match: m.score,
        source: (job.descriptionText || '').includes('company-careers') ? 'company' : 'linkedin',
        description: (job.ghost ? GHOST_PREFIX : '') + (m.reason || ''), location: job.location || '',
        posted_at: job.postedAt || job.postedDate || job.posted || null,
        // parsed applicant count (null when unknown) — drives crowding logic
        applicants: (typeof job.applicants === 'number') ? job.applicants : null,
        // interview-probability estimate (server mirror of client interviewChance)
        interview_chance: computeInterviewChance(job, m.score, job.ghost),
        // rich match data → rendered in the job drawer
        job_type: m.level || '', match_explanation: m.fit || m.reason || '',
        match_breakdown: m.breakdown || null,
        matched_keywords: m.matched || [], missing_keywords: (m.cv && m.cv.missing) || m.gaps || [],
        category: m.cat || '',
        // tailored CV content (truthful reframe only) — fed into the system + dashboards
        cv_summary: (m.cv && m.cv.summary) || '',
        cv_bullets: (m.cv && Array.isArray(m.cv.bullets)) ? m.cv.bullets : [],
      },
    }),
  });
  return r.ok;
}

// ── Main run ─────────────────────────────────────────────────────────────────
export async function runJobHunt(sendMessage, { force = false } = {}) {
  if (!APIFY_TOKEN) { await sendMessage(`⚠️ ציד משרות: חסר APIFY_TOKEN ב-Railway${SIG}`); return; }

  const state = loadState();
  const mk = monthKey();
  if (state.month !== mk) { state.month = mk; state.results = 0; }
  if (state.results + PER_RUN > MONTHLY_CAP) {
    await sendMessage(`⚠️ ציד משרות הושהה — תקרת התקציב החודשית של Apify הושגה (${state.results} תוצאות).${SIG}`);
    return;
  }

  const hour = parseInt(new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit' }), 10);
  const morning = hour < 13;
  const runType = morning ? 'MORNING (AI/Growth + Product)' : 'EVENING (Finance + AI/Product)';
  const day = Math.floor(Date.now() / 86400000);
  const searches = morning
    ? [[POOL_AI_GROWTH[day % POOL_AI_GROWTH.length], 'Tel Aviv-Yafo, Israel'],
       [POOL_PRODUCT[day % POOL_PRODUCT.length], 'Tel Aviv-Yafo, Israel']]
    : [[POOL_FINANCE[day % POOL_FINANCE.length], 'Israel'],
       [POOL_AI_GROWTH[(day + 3) % POOL_AI_GROWTH.length], 'Tel Aviv-Yafo, Israel']];

  console.log(`[jobhunt] run start: ${runType}, searches:`, searches.map(s => s[0]).join(' | '));

  // 1. Scrape LinkedIn (Apify — paid, capped)
  let jobs = [];
  for (const [kw, loc] of searches) {
    try { jobs.push(...(await apifySearch(kw, loc))); }
    catch (e) { console.error('[jobhunt] search error:', e.message); }
  }
  const apifyCount = jobs.length;
  state.results += apifyCount;
  state.lastRun = new Date().toISOString();
  saveState(state);

  // 1b. Scan company career pages (free public ATS APIs, rotating slice)
  const comp = await scanCompanies(day, morning ? 0 : 1);
  jobs.push(...comp.jobs);

  // 1c. Scan Comeet career pages (free public Comeet API)
  const comeet = await scanComeet();
  jobs.push(...comeet.jobs);

  // 1d. Ghost detection — flag LinkedIn postings that are NOT on the company's own
  // ATS/Comeet career page (scanned this run) as possible ghost jobs.
  const careerByCompany = new Map(); // normCompany -> [titles found on career pages]
  for (const cj of [...comp.jobs, ...comeet.jobs]) {
    const k = normCompany(cj.companyName);
    if (!careerByCompany.has(k)) careerByCompany.set(k, []);
    careerByCompany.get(k).push(cj.title);
  }
  const scannedCompanies = new Set([...comp.scannedNames, ...comeet.scannedNames].map(normCompany));
  for (const j of jobs) {
    if ((j.descriptionText || '').includes('company-careers')) continue; // only LinkedIn-sourced
    const cfg = COMPANIES.find(c => (c.ats || c.comeet) && companyMatches(c.name, j.companyName));
    if (!cfg || !scannedCompanies.has(normCompany(cfg.name))) continue; // only judge companies scanned this run
    const titles = careerByCompany.get(normCompany(cfg.name)) || [];
    if (!titles.some(t => titlesSimilar(t, j.title))) {
      j.ghost = true;
      j.descriptionText = GHOST_PREFIX + (j.descriptionText || '');
    }
  }

  if (!jobs.length) { await sendMessage(`🎯 ציד משרות — לא התקבלו תוצאות מהסריקה (ייתכן שגיאת Apify).${SIG}`); return; }

  // 2. Hard filters (free — before spending Claude tokens)
  // Attach a parsed applicant count to every job so the crowding rules below and
  // the interview-chance model can use it.
  jobs.forEach(j => { j.applicants = parseApplicants(j); });
  const seen = new Set(state.uploaded || []);
  const seenIds = new Set(state.seenIds || []);
  const newJobs = jobs.filter(j => !seenIds.has(j.id)); // never re-process a job seen in any past run
  jobs.forEach(j => j.id && seenIds.add(j.id));
  state.seenIds = [...seenIds].slice(-1500);
  let crowdedSkip = 0; // known applicant count > 100 → too crowded, skip entirely
  const filtered = newJobs.filter(j => {
    const t = j.title || '';
    if (SENIOR_RE.test(t) && !MANAGER_OK_RE.test(t)) return false;
    if (/manager/i.test(t) && !MANAGER_OK_RE.test(t)) return false;
    if (ABROAD_RE.test(t + ' ' + (j.descriptionText || '').slice(0, 300))) return false;
    if (!LOCATION_ALLOW.test(j.location || '')) return false;
    if (seen.has(`${t}|${j.companyName}`)) return false; // already uploaded before
    // Applicant crowding: KNOWN count >100 → skip; 26–100 kept (penalized later);
    // ≤25 kept (boosted later); unknown (null) → neutral, kept.
    if (typeof j.applicants === 'number' && j.applicants > 100) { crowdedSkip++; return false; }
    return true;
  });
  if (crowdedSkip) console.log(`[jobhunt] skipped ${crowdedSkip} over-crowded roles (>100 applicants)`);

  // 3. Score with Claude
  let scored = [];
  try { scored = filtered.length ? await scoreJobs(filtered, runType) : []; }
  catch (e) {
    console.error('[jobhunt] scoring error:', e.message);
    await sendMessage(`⚠️ ציד משרות: שגיאה בניקוד (${e.message}). נסרקו ${jobs.length} תוצאות.${SIG}`);
    return;
  }

  const matches = scored.filter(s => s.score >= 70).sort((a, b) => b.score - a.score);
  const borderline = scored.filter(s => s.score >= 60 && s.score < 70);

  // 4. Upload matches to Personal OS (skip any that fail a hard knockout)
  const lines = [];
  const rejected = [];
  for (const m of matches) {
    const j = filtered[m.i];
    const ko = Array.isArray(m.knockouts) ? m.knockouts.find(k => k && k.pass === false) : null;
    if (ko) { rejected.push(`${j.title} — ${ko.req || 'דרישת חובה לא מתקיימת'}`); continue; }
    let ok = false;
    try { ok = await uploadJob(j, m); } catch {}
    if (ok) { seen.add(`${j.title}|${j.companyName}`); }
    const lvl = m.level ? ` (${m.level})` : '';
    // Applicant window: known count ≤25 → advertise the open window.
    const appTag = (typeof j.applicants === 'number' && j.applicants <= MAX_APPLICANTS) ? ` 👥${j.applicants} — חלון פתוח!` : '';
    lines.push(`• [${m.score}%] ${j.title} — ${j.companyName} | ${j.location}${appTag}\n  ${m.cat}${lvl} | ${m.reason}\n  ${(j.link || '').split('?')[0]}\n  ${ok ? '✅ הועלה ל-Personal OS' : '⚠️ העלאה נכשלה'}`);
  }
  state.uploaded = [...seen].slice(-300);
  saveState(state);

  // 5. WhatsApp report
  const cost = (state.results * 0.001).toFixed(2);
  let report = `🎯 *ציד משרות ${morning ? 'בוקר' : 'ערב'}* — ${lines.length} התאמות ≥70%\n`;
  report += `🔎 ${searches.map(s => s[0]).join(' + ')}\n\n`;
  report += lines.length ? lines.join('\n\n') : 'לא נמצאו התאמות חזקות בריצה זו.';
  if (borderline.length) report += `\n\n*גבוליות (60-69%):*\n` + borderline.map(b => `• [${b.score}%] ${filtered[b.i].title} — ${filtered[b.i].companyName}`).join('\n');
  if (rejected.length) report += `\n\n*נפסלו (דרישות חובה):*\n` + rejected.slice(0, 5).map(r => `• ${r}`).join('\n');
  report += `\n\n_לינקדאין: ${apifyCount} | אתרי חברות: ${comp.jobs.length} מ-${comp.scanned} חברות | Comeet: ${comeet.jobs.length} מ-${comeet.scanned} | חדשות: ${newJobs.length} | החודש: ${state.results} (~$${cost} מתוך $5)_`;
  if (lines.length) report += `\n📲 פתח את Personal OS כדי שהמשרות ייקלטו`;
  report += SIG;
  await sendMessage(report);
  console.log(`[jobhunt] done: ${matches.length} matches, ${jobs.length} scraped`);
}

// ── Scheduler: fires at 07:30 and 13:00 Asia/Jerusalem ───────────────────────
let _send = null, _timer = null;

export function setJobHuntSend(fn) { _send = fn; }

export function startJobHuntScheduler() {
  if (_timer) return; // idempotent
  console.log('[jobhunt] scheduler armed (07:30 + 13:00 Asia/Jerusalem)');
  _timer = setInterval(async () => {
    const now = new Date();
    const [h, m] = now.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).split(':').map(Number);
    if (!((h === 7 && m === 30) || (h === 13 && m === 0))) return;
    const state = loadState();
    const slotKey = now.toLocaleDateString('en-CA', { timeZone: TZ }) + '-' + h;
    if (state.lastSlot === slotKey) return; // already ran this slot
    state.lastSlot = slotKey; saveState(state);
    if (!_send) { console.error('[jobhunt] no send fn — skipping run'); return; }
    try {
      await runJobHunt(_send);
    } catch (e) { console.error('[jobhunt] run error:', e.message); }
  }, 30000);
}
