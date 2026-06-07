// job-hunt-agent.js — Autonomous job-hunt agent running inside the Railway WhatsApp bot.
// Runs 2x/day (09:00 + 17:00 Asia/Jerusalem): Apify LinkedIn scrape → Claude scoring →
// upload matches to Personal OS via /api/webhook → WhatsApp report to Roei.
//
// ENV (Railway): APIFY_TOKEN (required), ANTHROPIC_API_KEY (exists), WEBHOOK_SECRET (if set on Vercel)
// State persisted in /data (Railway volume) for budget tracking + dedupe.

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

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

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Search keyword pools (rotated daily for coverage) ────────────────────────
const POOL_AI_GROWTH = ['AI Analyst', 'Growth Analyst', 'GenAI Specialist', 'AI Operations', 'Prompt Engineer', 'Marketing Analyst', 'Junior Data Analyst', 'Revenue Operations Analyst'];
const POOL_PRODUCT   = ['Junior Product Manager', 'Product Analyst', 'Associate Product Manager', 'Product Operations', 'Business Analyst'];
const POOL_FINANCE   = ['Investment Analyst', 'VC Analyst', 'Private Equity Analyst', 'Economist Junior', 'Strategy Analyst', 'M&A Analyst', 'Financial Analyst Student'];

const SENIOR_RE = /\b(senior|sr\.?|staff|principal|lead|head|director|vp|chief|architect|expert)\b/i;
const MANAGER_OK_RE = /\b(junior|associate|jr\.?|student|intern)\b/i;
const ABROAD_RE = /\b(bangkok|relocation|remote.{0,15}(us|usa|europe)|based in (?!israel))\b/i;

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
      return fetch(`https://api.apify.com/v2/datasets/${dsId}/items?token=${APIFY_TOKEN}&limit=${PER_SEARCH}&fields=id,title,companyName,location,link,seniorityLevel,descriptionText,postedAt`).then(r => r.json());
    }
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) throw new Error('Apify run ' + status);
  }
  throw new Error('Apify run timeout');
}

// ── Claude scoring ───────────────────────────────────────────────────────────
async function scoreJobs(jobs, runType) {
  const compact = jobs.map((j, i) => ({
    i, title: j.title, company: j.companyName, location: j.location,
    seniority: j.seniorityLevel, desc: (j.descriptionText || '').slice(0, 500),
  }));
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Score each job 0-100 for this candidate. Return ONLY a JSON array: [{"i":0,"score":NN,"cat":"AI/Growth|Product|Finance","reason":"one short Hebrew line: why it fits + how it serves his startup goal"}].

CANDIDATE: Roei Klein, Tel Aviv. M.Sc Information Science & Applied AI (active student, Bar-Ilan). B.A. Economics & Management (88). Founder of Upselles startup (product, GTM, growth analytics). Skills: Python, SQL, data analysis, KPI dashboards, prompt engineering/LLMs, product thinking, growth, business strategy. Hebrew+English.
LONG-TERM GOAL: founding a startup — value roles that teach new domains, build network, give exposure to interesting industries, or lead to Product/business leadership.
RULES: student/junior/entry ONLY — if a job requires 3+ years experience, cap score at 50. Part-time 80-90% is GOOD. Location: Tel Aviv best, then Petah Tikva/Herzliya/Ra'anana/center, rest of Israel lower; outside Israel = 0. Be honest, do not inflate.
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
async function uploadJob(job, score, reason) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.WEBHOOK_SECRET) headers['X-Webhook-Secret'] = process.env.WEBHOOK_SECRET;
  const r = await fetch(`${API_URL}/api/webhook`, {
    method: 'POST', headers,
    body: JSON.stringify({
      action: 'add_job',
      data: {
        title: job.title, company: job.companyName, status: 'saved',
        link: (job.link || '').split('?')[0], match: score, source: 'linkedin',
        description: reason, location: job.location || '',
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

  // 1. Scrape
  let jobs = [];
  for (const [kw, loc] of searches) {
    try { jobs.push(...(await apifySearch(kw, loc))); }
    catch (e) { console.error('[jobhunt] search error:', e.message); }
  }
  state.results += jobs.length;
  state.lastRun = new Date().toISOString();
  saveState(state);
  if (!jobs.length) { await sendMessage(`🎯 ציד משרות — לא התקבלו תוצאות מהסריקה (ייתכן שגיאת Apify).${SIG}`); return; }

  // 2. Hard filters (free — before spending Claude tokens)
  const seen = new Set(state.uploaded || []);
  const seenIds = new Set(state.seenIds || []);
  const newJobs = jobs.filter(j => !seenIds.has(j.id)); // never re-process a job seen in any past run
  jobs.forEach(j => j.id && seenIds.add(j.id));
  state.seenIds = [...seenIds].slice(-1500);
  const filtered = newJobs.filter(j => {
    const t = j.title || '';
    if (SENIOR_RE.test(t) && !MANAGER_OK_RE.test(t)) return false;
    if (/manager/i.test(t) && !MANAGER_OK_RE.test(t)) return false;
    if (ABROAD_RE.test(t + ' ' + (j.descriptionText || '').slice(0, 300))) return false;
    if (!/israel/i.test(j.location || '')) return false;
    if (seen.has(`${t}|${j.companyName}`)) return false; // already uploaded before
    return true;
  });

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

  // 4. Upload matches to Personal OS
  const lines = [];
  for (const m of matches) {
    const j = filtered[m.i];
    let ok = false;
    try { ok = await uploadJob(j, m.score, m.reason); } catch {}
    if (ok) { seen.add(`${j.title}|${j.companyName}`); }
    lines.push(`• [${m.score}%] ${j.title} — ${j.companyName} | ${j.location}\n  ${m.cat} | ${m.reason}\n  ${(j.link || '').split('?')[0]}\n  ${ok ? '✅ הועלה ל-Personal OS' : '⚠️ העלאה נכשלה'}`);
  }
  state.uploaded = [...seen].slice(-300);
  saveState(state);

  // 5. WhatsApp report
  const cost = (state.results * 0.001).toFixed(2);
  let report = `🎯 *ציד משרות ${morning ? 'בוקר' : 'ערב'}* — ${matches.length} התאמות ≥70%\n`;
  report += `🔎 ${searches.map(s => s[0]).join(' + ')}\n\n`;
  report += matches.length ? lines.join('\n\n') : 'לא נמצאו התאמות חזקות בריצה זו.';
  if (borderline.length) report += `\n\n*גבוליות (60-69%):*\n` + borderline.map(b => `• [${b.score}%] ${filtered[b.i].title} — ${filtered[b.i].companyName}`).join('\n');
  report += `\n\n_נסרקו ${jobs.length} (${newJobs.length} חדשות) | החודש: ${state.results} (~$${cost} מתוך $5)_`;
  if (matches.length) report += `\n📲 פתח את Personal OS כדי שהמשרות ייקלטו`;
  report += SIG;
  await sendMessage(report);
  console.log(`[jobhunt] done: ${matches.length} matches, ${jobs.length} scraped`);
}

// ── Scheduler: fires at 09:00 and 17:00 Asia/Jerusalem ───────────────────────
let _send = null, _timer = null;

export function setJobHuntSend(fn) { _send = fn; }

export function startJobHuntScheduler() {
  if (_timer) return; // idempotent
  console.log('[jobhunt] scheduler armed (09:00 + 17:00 Asia/Jerusalem)');
  _timer = setInterval(async () => {
    const now = new Date();
    const [h, m] = now.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).split(':').map(Number);
    if (m !== 0 || (h !== 9 && h !== 17)) return;
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
