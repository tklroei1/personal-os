#!/usr/bin/env node
// CI safety net for Personal OS — catches the failures we hit in production:
//   • truncated / unparseable JS  • invalid vercel.json  • >12 serverless functions
//   • NUL-byte corruption  • broken main client files
// Exits non-zero on any problem so the GitHub Action fails BEFORE a bad deploy.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const MAX_FUNCS = 12;            // Vercel Hobby limit
let errors = [], checked = 0;
const fail = m => errors.push(m);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) { if (e !== 'node_modules' && e !== '.git') walk(p, out); }
    else out.push(p);
  }
  return out;
}

// 1) every API function file must parse as JS, no NULs, balanced braces
const apiDir = path.join(ROOT, 'api');
const apiFiles = walk(apiDir).filter(f => f.endsWith('.js'));
if (apiFiles.length > MAX_FUNCS)
  fail(`Too many serverless functions: ${apiFiles.length} > ${MAX_FUNCS} (Vercel Hobby cap). Merge some into api/ai.js or upgrade the plan.`);
else console.log(`✓ serverless functions: ${apiFiles.length}/${MAX_FUNCS}`);

function checkJs(f) {
  const buf = readFileSync(f);
  if (buf.includes(0)) fail(`NUL byte (corruption) in ${path.relative(ROOT, f)}`);
  const txt = buf.toString('utf8');
  const o = (txt.match(/{/g) || []).length, c = (txt.match(/}/g) || []).length;
  if (o !== c) fail(`Unbalanced braces in ${path.relative(ROOT, f)} ({=${o} }=${c}) — likely truncated`);
  try { execSync(`node --check "${f}"`, { stdio: 'pipe' }); checked++; }
  catch (e) { fail(`Syntax error in ${path.relative(ROOT, f)}:\n${(e.stderr || e.stdout || e).toString().split('\n').slice(0,4).join('\n')}`); }
}
apiFiles.forEach(checkJs);

// 2) vercel.json must be valid JSON and reference only existing functions
const vjPath = path.join(ROOT, 'vercel.json');
try {
  const vj = JSON.parse(readFileSync(vjPath, 'utf8'));
  console.log('✓ vercel.json is valid JSON');
  const dests = (vj.routes || []).map(r => (r.dest || '')).filter(d => d.startsWith('/api/'));
  for (const d of dests) {
    const file = d.split('?')[0].replace(/^\//, '');
    if (!apiFiles.some(f => path.relative(ROOT, f).replace(/\\/g,'/') === file))
      fail(`vercel.json routes to missing function: ${file}`);
  }
} catch (e) { fail(`vercel.json invalid: ${e.message}`); }

// 3) main client files must parse / not be truncated
for (const cf of ['voice.js', 'jarvis.js', 'agent.js', 'assistant.js', 'sw.js']) {
  const p = path.join(ROOT, cf);
  try { statSync(p); checkJs(p); } catch {}
}
// index.html: no NULs + ends with </html>
try {
  const html = readFileSync(path.join(ROOT, 'index.html'));
  if (html.includes(0)) fail('NUL byte in index.html');
  if (!html.toString('utf8').trimEnd().endsWith('</html>')) fail('index.html does not end with </html> — likely truncated');
  else console.log('✓ index.html intact');
} catch (e) { fail('cannot read index.html: ' + e.message); }

console.log(`\nChecked ${checked} JS files.`);
if (errors.length) { console.error('\n✗ CI VALIDATION FAILED:\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('\n✅ All deploy-safety checks passed.');
