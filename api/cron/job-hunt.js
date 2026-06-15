// api/cron/job-hunt.js — Auto-run job/apartment agent (daily at 11:00 Israel, year-round)
// Vercel Cron is UTC-only and unaware of DST, so vercel.json fires this at BOTH 08:00 and
// 09:00 UTC. The guard below runs the actual search only when the local Israel hour is 11
// (08:00 UTC in summer / 09:00 UTC in winter), so it always lands on 11:00 Israel time.
// On the strongest posting days (Tue/Wed) it runs a BROADER search. It forces a fresh run
// of /api/get-agent-results so the dashboard shows up-to-date jobs when Roei opens the system.

const BASE_URL =
  process.env.CRON_TARGET_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://personal-os-coral-tau.vercel.app');

export default async function handler(req, res) {
  // Verify this is a Vercel Cron call, or an authorized manual trigger
  if (req.headers['x-vercel-cron'] !== '1' && req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const tavily = process.env.TAVILY_API_KEY;
  if (!tavily) return res.status(200).json({ skipped: 'No TAVILY_API_KEY' });

  // Current time in Israel (handles DST automatically).
  const israelNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const israelHour = israelNow.getHours();
  const israelDay = israelNow.getDay();

  // Only the run that lands on 11:00 Israel does the work. Manual/admin triggers
  // (Authorization: Bearer) bypass the hour guard for testing.
  const isCron = req.headers['x-vercel-cron'] === '1';
  if (isCron && israelHour !== 11) {
    return res.status(200).json({ skipped: `Israel hour is ${israelHour}, not 11`, ts: new Date().toISOString() });
  }

  // Strong posting days in Israel: Tuesday(2) & Wednesday(3) → broader search.
  const broad = israelDay === 2 || israelDay === 3;

  // Force a fresh run of the agent and warm its cache so the dashboard
  // (which reads GET /api/get-agent-results) gets ready results.
  try {
    const r = await fetch(`${BASE_URL}/api/get-agent-results${broad ? '?broad=1' : ''}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });
    const d = await r.json().catch(() => ({}));
    const jobCount = (d.jobs || []).length;
    const aptCount = (d.apartments || []).length;
    console.log(`Job-hunt cron: broad=${broad} jobs=${jobCount} apartments=${aptCount} ok=${r.ok}`);
    return res.status(200).json({
      ok: r.ok,
      broad,
      jobs: jobCount,
      apartments: aptCount,
      summary: d.summary || '',
      ts: new Date().toISOString(),
    });
  } catch (e) {
    console.error('cron job-hunt error:', e.message);
    return res.status(200).json({ ok: false, error: e.message, ts: new Date().toISOString() });
  }
}
