// api/jobs/list.js — Returns jobs filtered by userId and optional stage
// Frontend sends userId in query/body; data is stored in Vercel KV if available,
// else returns empty (frontend uses localStorage as primary store).

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // This endpoint is a pass-through for future server-side storage.
  // The primary data store is localStorage in the frontend.
  return res.status(200).json({ jobs: [], message: 'Use localStorage as primary store. This endpoint reserved for future server-side sync.' });
}
