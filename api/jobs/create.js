// api/jobs/create.js — Validate and score a new job before frontend stores it
import { createRequire } from 'module';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { job } = req.body || {};
    if (!job || !job.title) return res.status(400).json({ error: 'Missing job.title' });

    // Generate id if not present
    if (!job.id) job.id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    job.created_at = job.created_at || new Date().toISOString();
    job.updated_at = new Date().toISOString();
    job.stage = job.stage || 'discovered';
    if (!job.stage_history) job.stage_history = [{ stage: job.stage, at: job.created_at }];

    // Call match-score internally
    try {
      const scoreResp = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}/api/match-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job }),
      });
      if (scoreResp.ok) {
        const scoreData = await scoreResp.json();
        job.match_score = scoreData.score;
        job.match_breakdown = scoreData.breakdown;
        job.match_explanation = scoreData.match_explanation;
        job.matched_keywords = scoreData.matched_keywords;
        job.missing_keywords = scoreData.missing_keywords;
      }
    } catch (e) {
      console.error('match-score call failed:', e.message);
    }

    return res.status(200).json({ job });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
