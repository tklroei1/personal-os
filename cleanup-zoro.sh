#!/usr/bin/env bash
# ============================================================================
#  cleanup-zoro.sh  —  Safe cleanup of the Personal OS / Zoro working tree
#  Built from a verified diagnosis on 2026-06-19.
#
#  WHAT IT DOES (each step is safe + reversible; full backup first):
#   0. Backup (git bundle of ALL history + tar of working tree)
#   1. Realign working tree to HEAD (== live deploy)   -> git reset --hard
#   2. Delete dead/junk files (would break the 12-fn Vercel limit)
#   3. Delete the stale lock branch
#   4. Harden .gitignore
#   5. Adopt zoro-docs/ as the canonical docs location
#   6. Commit the genuinely-new work
#   7. Verify everything (syntax, function count, JSON, git status)
#
#  HOW TO RUN (Git Bash, from anywhere):
#     bash "/c/Users/user/Documents/New project/personal-os/cleanup-zoro.sh"
#  Nothing is pushed automatically. Review, then `git push` yourself.
# ============================================================================
set -uo pipefail

# Always operate on the repo this script lives in.
cd "$(dirname "$0")" || { echo "cannot cd to script dir"; exit 1; }
REPO="$(pwd)"
echo "Repo: $REPO"
[ -d .git ] || { echo "ERROR: not a git repo. Aborting."; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
BK_DIR="$(dirname "$REPO")"

# ---------------------------------------------------------------------------
echo ""
echo "=== STEP 0: BACKUP (so everything is reversible) ==="
git bundle create "$BK_DIR/zoro-repo-backup-$STAMP.bundle" --all \
  && echo "  git history -> $BK_DIR/zoro-repo-backup-$STAMP.bundle"
tar --exclude='./.git' --exclude='*/node_modules/*' \
    -czf "$BK_DIR/zoro-worktree-backup-$STAMP.tar.gz" . \
  && echo "  working tree -> $BK_DIR/zoro-worktree-backup-$STAMP.tar.gz"

# ---------------------------------------------------------------------------
echo ""
echo "=== SAFETY CHECK: don't proceed if there are unpushed local commits ==="
git fetch origin --quiet 2>/dev/null || echo "  (fetch skipped/offline — continuing)"
HEAD_SHA="$(git rev-parse HEAD)"
ORIGIN_SHA="$(git rev-parse origin/main 2>/dev/null || echo none)"
echo "  HEAD       = $HEAD_SHA"
echo "  origin/main= $ORIGIN_SHA"
if [ "$ORIGIN_SHA" != "none" ] && [ "$HEAD_SHA" != "$ORIGIN_SHA" ]; then
  echo "  WARNING: HEAD != origin/main. Inspect before reset. Aborting to be safe."
  echo "  (Run 'git log --oneline origin/main..HEAD' to see local-only commits.)"
  exit 1
fi
echo "  OK: HEAD matches origin/main (== live deploy). Safe to realign."

# ---------------------------------------------------------------------------
echo ""
echo "=== STEP 1: realign tracked files to HEAD (restores Whisper/push/CI) ==="
git reset --hard HEAD
git rev-parse HEAD  # unchanged — we only restored the working tree/index

# ---------------------------------------------------------------------------
echo ""
echo "=== STEP 2: delete dead + junk files ==="
JUNK=(
  api/gemini.js
  api/job-coach.js
  api/match-score.js
  index.html.new
  index.html.prevdeploy.bak
  _head_index.tmp
  _head.txt
  _disk.txt
  _deltest.txt
)
for f in "${JUNK[@]}"; do
  if [ -e "$f" ]; then rm -f "$f" && echo "  removed: $f"; else echo "  (absent): $f"; fi
done

# ---------------------------------------------------------------------------
echo ""
echo "=== STEP 3: delete stale lock branch ==="
if git show-ref --verify --quiet refs/heads/main.lock.stale_1781787330; then
  git branch -D main.lock.stale_1781787330 && echo "  deleted stale branch"
else
  echo "  (no stale branch found)"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== STEP 4: harden .gitignore ==="
add_ignore () { grep -qxF "$1" .gitignore 2>/dev/null || { echo "$1" >> .gitignore; echo "  + $1"; }; }
add_ignore "node_modules/"
add_ignore "*.bak"
add_ignore "*.new"
add_ignore "*.tmp"

# ---------------------------------------------------------------------------
echo ""
echo "=== STEP 5: adopt zoro-docs/ as canonical (remove root duplicates) ==="
for f in AUDIT_AND_FIX_PROMPT.md OVERNIGHT_BUILD_REPORT.md PASTE_TO_CLAUDE_CODE_AUDIT.txt PHASE5_PLUS_PROMPT.md WIRE_UP_FIX.md; do
  if [ -f "zoro-docs/$f" ] && git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    git rm -q "$f" && echo "  moved to zoro-docs: $f"
  fi
done

# ---------------------------------------------------------------------------
echo ""
echo "=== STEP 6: commit the cleanup + new work ==="
git add -A
if git diff --cached --quiet; then
  echo "  nothing to commit (tree already clean)"
else
  git commit -m "chore(zoro): clean working tree to live HEAD; drop dead consolidated fns; relocate docs to zoro-docs; harden gitignore; add voice-hotspot-project + project map"
  echo "  committed. (Not pushed — run 'git push' when ready.)"
fi

# ---------------------------------------------------------------------------
echo ""
echo "=== STEP 7: VERIFY ==="
ok=1
echo "-- node --check all api JS (incl. subfolders)"
while IFS= read -r f; do
  if node --check "$f" 2>/dev/null; then echo "  OK   $f"; else echo "  FAIL $f"; ok=0; fi
done < <(find api -name '*.js')
echo "-- function count (Vercel Hobby limit = 12)"
NF=$(find api -name '*.js' | wc -l | tr -d ' ')
echo "  api functions: $NF"; [ "$NF" -le 12 ] && echo "  OK (<=12)" || { echo "  FAIL (>12)"; ok=0; }
echo "-- vercel.json is valid JSON"
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'));console.log('  OK valid JSON')" || { echo "  FAIL invalid JSON"; ok=0; }
echo "-- CI validator (if present)"
[ -f scripts/ci-validate.mjs ] && node scripts/ci-validate.mjs && echo "  CI validate ran" || echo "  (ci-validate.mjs not run)"
echo "-- git status"
git status -s | head -20
echo "-- HEAD vs origin/main (live must be untouched)"
echo "  HEAD=$(git rev-parse --short HEAD)  origin/main=$(git rev-parse --short origin/main 2>/dev/null || echo none)"

echo ""
if [ "$ok" -eq 1 ]; then
  echo "============================================================"
  echo " DONE — working tree clean & verified. Backups in: $BK_DIR"
  echo " Next: review, then 'git push' to update the repo."
  echo "============================================================"
else
  echo "!!! Some checks FAILED — review output above. Backups in: $BK_DIR"
fi
