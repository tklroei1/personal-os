// api/cron/job-hunt.js — Auto-run job/apartment agent (daily at 08:00 Israel) + daily push briefing.
import webpush from 'web-push';

const BASE_URL =
  process.env.CRON_TARGET_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://personal-os-coral-tau.vercel.app');

async function sendDailyPush(d) {
  const VP = process.env.VAPID_PUBLIC, VK = process.env.VAPID_PRIVATE;
  const VS = process.env.VAPID_SUBJECT || 'mailto:tklroei1@gmail.com';
  const KU = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_KV_REST_API_URL;
  const KT = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN;
  if (!VP || !VK || !KU || !KT) return; // push not configured — skip silently
  try {
    webpush.setVapidDetails(VS, VP, VK);
    const r = await fetch(KU, { method: 'POST', headers: { Authorization: 'Bearer ' + KT, 'Content-Type': 'application/json' }, body: JSON.stringify(['SMEMBERS', 'pos_push_subs']) });
    const sd = await r.json();
    const subs = (sd && sd.result) || [];
    if (!subs.length) return;
    const jobCount = (d.jobs || []).length;
    const strong = (d.jobs || []).filter(function (j) { return (j.match || 0) >= 75; }).length;
    const body = jobCount ? (jobCount + ' משרות מחכות להגשה, ' + strong + ' עם התאמה ≥75%') : 'בוקר טוב! אין משרות חדשות היום — שיהיה יום מעולה.';
    const payload = JSON.stringify({ title: '🎯 התור היומי שלך מוכן', body: body, url: '/?page=agent' });
    await Promise.all(subs.map(function (s) { try { return webpush.sendNotification(JSON.parse(s), payload).catch(function () {}); } catch (e) { return null; } }));
  } catch (e) { console.error('push error:', e.message); }
}

export default async function handler(req, res) {
  if (req.headers['x-vercel-cron'] !== '1' && req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const tavily = process.env.TAVILY_API_KEY;
  if (!tavily) return res.status(200).json({ skipped: 'No TAVILY_API_KEY' });

  const israelNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const israelHour = israelNow.getHours();
  const israelDay = israelNow.getDay();
  const isCron = req.headers['x-vercel-cron'] === '1';
  if (isCron && israelHour !== 8) {
    return res.status(200).json({ skipped: `Israel hour is ${israelHour}, not 8`, ts: new Date().toISOString() });
  }
  const broad = israelDay === 2 || israelDay === 3;
  try {
    const r = await fetch(`${BASE_URL}/api/get-agent-results${broad ? '?broad=1' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const d = await r.json().catch(() => ({}));
    const jobCount = (d.jobs || []).length;
    const aptCount = (d.apartments || []).length;
    await sendDailyPush(d);
    console.log(`Job-hunt cron: broad=${broad} jobs=${jobCount} apartments=${aptCount} ok=${r.ok}`);
    return res.status(200).json({ ok: r.ok, broad, jobs: jobCount, apartments: aptCount, summary: d.summary || '', ts: new Date().toISOString() });
  } catch (e) {
    console.error('cron job-hunt error:', e.message);
    return res.status(200).json({ ok: false, error: e.message, ts: new Date().toISOString() });
  }
}
