// api/jobs/update.js — Update a job's stage or fields, append stage history

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['POST', 'PUT'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { job, updates } = req.body || {};
    if (!job || !updates) return res.status(400).json({ error: 'Missing job or updates' });

    const updated = { ...job, ...updates, updated_at: new Date().toISOString() };

    // Append stage history if stage changed
    if (updates.stage && updates.stage !== job.stage) {
      updated.stage_history = [
        ...(job.stage_history || []),
        { stage: updates.stage, at: new Date().toISOString(), note: updates.stage_note || '' },
      ];
      // Auto-set applied_at
      if (updates.stage === 'applied' && !updated.applied_at) {
        updated.applied_at = new Date().toISOString();
      }
    }

    return res.status(200).json({ job: updated });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
