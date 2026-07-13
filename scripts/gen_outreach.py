#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_outreach.py — Backdoor-outreach pack generator for Roei Klein's job-hunt pipeline.

Playbook basis (Part 4 - Backdoor Outreach):
- Only ~2-5% of "Apply button" submissions get an interview; a direct, targeted
  LinkedIn message to a relevant employee dramatically raises the odds.
- Rule of 300: LinkedIn DMs longer than ~300 characters read like spam. Keep it short.
- Value First: don't say "please look at my CV". Offer something useful (an insight).

Produces an OUTREACH_<Company>_<Role>.txt pack containing:
  1) A ready-to-send LinkedIn DM (hard-guarded to <= 300 chars).
  2) A short "3 quick insights" value-first scaffold (placeholders to fill).
  3) A double-sided-referral note (Part 5) for the informational-interview ask.

Usage:
  python3 gen_outreach.py --data spec.json --out /path/OUTREACH_Company_Role.txt
  echo '<json>' | python3 gen_outreach.py --out /path/out.txt

JSON spec:
{
  "company": "Moon Active",
  "role": "Business Data Analyst",
  "contact_name": "[First name]",         # optional; placeholder if unknown
  "team": "Data / Analytics",             # optional
  "hook": "AI-driven analytics workflows",# a specific feature/market trend they work on
  "message": "full custom DM text"        # optional; if given it is validated, not rebuilt
}
NEVER invents metrics: insight lines are placeholders Roei fills before sending.
"""
import sys, os, json, argparse

MAXLEN = 300  # LinkedIn "Rule of 300"

def build_dm(spec, short=False):
    name = spec.get("contact_name") or "[First name]"
    company = spec.get("company","[Company]")
    role = spec.get("role","[Role]")
    hook = spec.get("hook") or "your data/product roadmap"
    if short:
        # Fallback: drop the hook clause to guarantee <=300 chars.
        return (f"Hi {name}, saw {company} is scaling and I just applied for the {role} role. "
                f"I spent the past year building performance-driven data pipelines at upselles.app "
                f"and put together 3 quick data ideas for the team. Open to a 10-min look? Best, Roei")
    # Compact, value-first, <=300 chars when the hook is short.
    return (f"Hi {name}, saw {company} is scaling here and I just applied for the {role} role. "
            f"I spent the past year building performance-driven data pipelines at upselles.app "
            f"and have 3 quick data ideas for {hook}. Open to a 10-min look? Best, Roei")

def trim_to_limit(dm, spec=None):
    if len(dm) <= MAXLEN:
        return dm, len(dm), True
    # Auto-fallback to the shorter template (drops the hook clause).
    if spec is not None:
        short = build_dm(spec, short=True)
        if len(short) <= MAXLEN:
            return short, len(short), True
        return short, len(short), False
    return dm, len(dm), False

def render_pack(spec):
    company = spec.get("company","[Company]")
    role = spec.get("role","[Role]")
    dm = spec.get("message") or build_dm(spec)
    dm_final, n, ok = trim_to_limit(dm, spec if not spec.get("message") else None)
    warn = "" if ok else f"\n[!] DM is {n} chars (> {MAXLEN}). Shorten before sending.\n"
    lines = []
    lines.append(f"OUTREACH PACK  —  {company}  |  {role}")
    lines.append("="*60)
    lines.append("")
    lines.append(f"1) LINKEDIN DM  (chars: {n}/{MAXLEN})")
    lines.append("-"*40)
    lines.append(dm_final)
    if warn: lines.append(warn)
    lines.append("")
    lines.append("2) VALUE-FIRST — 3 quick data-driven insights (fill before sending)")
    lines.append("-"*40)
    lines.append("   • Insight 1: [observation about their funnel/metric] -> [suggested lever]")
    lines.append("   • Insight 2: [add data point] -> [expected impact]")
    lines.append("   • Insight 3: [add data point] -> [expected impact]")
    lines.append("")
    lines.append("3) DOUBLE-SIDED REFERRAL (Part 5) — informational-interview ask")
    lines.append("-"*40)
    lines.append(f"   Target: a {role} (or one level up) on the relevant team at {company}.")
    lines.append("   First message asks for a 10-min chat to learn about the team — NOT a referral.")
    lines.append("   On the call, show how you led product+data+architecture at upselles.app and")
    lines.append("   solved a challenge similar to theirs; let them offer to pass your CV forward.")
    lines.append("")
    lines.append("RULES: never auto-send. Roei reviews, personalizes placeholders, and sends himself.")
    return "\n".join(lines), n, ok

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--data", help="path to JSON spec (or use stdin)")
    ap.add_argument("--out", required=True)
    a=ap.parse_args()
    raw=open(a.data,encoding="utf-8").read() if a.data else sys.stdin.read()
    spec=json.loads(raw)
    text,n,ok = render_pack(spec)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    open(a.out,"w",encoding="utf-8").write(text)
    print(f"saved: {a.out}  (DM {n} chars, {'OK' if ok else 'OVER LIMIT'})")

if __name__=="__main__":
    main()
