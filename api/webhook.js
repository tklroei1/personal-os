import { readFileSync, writeFileSync, existsSync } from 'fs';

const QUEUE = '/tmp/pos_webhook_queue.json';

function readQueue() {
  try { return existsSync(QUEUE) ? JSON.parse(readFileSync(QUEUE, 'utf8')) : []; }
  catch { return []; }
}
function writeQueue(q) {
  try { writeFileSync(QUEUE, JSON.stringify(q)); } catch {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Webhook-Secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — frontend polls for pending commands (no auth: commands are non-sensitive app updates)
  if (req.method === 'GET') {
    const q = readQueue();
    writeQueue([]); // clear queue after delivery
    return res.status(200).json({ commands: q, ts: Date.now() });
  }

  // POST — external source (Claude.ai conversation, script, etc.) pushes a command
  if (req.method === 'POST') {
    const secret = process.env.WEBHOOK_SECRET;
    if (secret) {
      const authHeader = (req.headers['authorization'] || '').replace('Bearer ', '');
      const secretHeader = req.headers['x-webhook-secret'] || '';
      if (authHeader !== secret && secretHeader !== secret) {
        return res.status(401).json({ error: 'Unauthorized — provide Authorization: Bearer <WEBHOOK_SECRET>' });
      }
    }

    const body = req.body || {};
    const { project, action, data } = body;
    if (!action) return res.status(400).json({ error: 'Missing required field: action' });

    const cmd = { action, ...(data || {}), _project: project || null, _ts: Date.now() };
    const q = readQueue();
    q.push(cmd);
    writeQueue(q);

    return res.status(200).json({ ok: true, queued: cmd, queueLength: q.length });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
