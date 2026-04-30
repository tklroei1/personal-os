// api/jobs/delete.js — Soft-delete by moving to archive, or hard delete

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const { id, soft = true, reason = '' } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing job id' });

  if (soft) {
    // Frontend should move to archive stage
    return res.status(200).json({
      id,
      action: 'archive',
      updates: {
        stage: 'archive',
        archived_reason: reason,
        updated_at: new Date().toISOString(),
      },
    });
  }

  return res.status(200).json({ id, action: 'deleted' });
}
