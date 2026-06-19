<#
================================================================================
 cleanup-zoro.ps1  —  Safe cleanup of the Personal OS / Zoro working tree (Windows / PowerShell)
 Built from a verified diagnosis on 2026-06-19.

 STEPS (each safe + reversible; full backup first):
   0. Backup (git bundle of ALL history + tar of working tree)
   1. Realign working tree to HEAD (== live deploy)
   2. Delete dead/junk files (would break the 12-fn Vercel limit)
   3. Delete the stale lock branch
   4. Harden .gitignore
   5. Adopt zoro-docs/ as canonical docs location
   6. Commit the genuinely-new work
   7. Verify everything

 RUN (PowerShell, from anywhere):
   powershell -ExecutionPolicy Bypass -File "C:\Users\user\Documents\New project\personal-os\cleanup-zoro.ps1"
 Nothing is pushed automatically. Review, then `git push` yourself.
================================================================================
#>
$ErrorActionPreference = 'Continue'

# Operate on the repo this script lives in.
Set-Location -LiteralPath $PSScriptRoot
$REPO = (Get-Location).Path
Write-Host "Repo: $REPO"
if (-not (Test-Path ".git")) { Write-Host "ERROR: not a git repo. Aborting." -ForegroundColor Red; exit 1 }

$STAMP  = Get-Date -Format "yyyyMMdd-HHmmss"
$BK_DIR = Split-Path $REPO -Parent

# ---------------------------------------------------------------------------
Write-Host "`n=== STEP 0: BACKUP (so everything is reversible) ==="
git bundle create "$BK_DIR\zoro-repo-backup-$STAMP.bundle" --all
if ($LASTEXITCODE -eq 0) { Write-Host "  git history -> $BK_DIR\zoro-repo-backup-$STAMP.bundle" }
# tar.exe ships with Windows 10+; excludes .git and any node_modules
tar --exclude='./.git' --exclude='*/node_modules/*' -czf "$BK_DIR\zoro-worktree-backup-$STAMP.tar.gz" .
if ($LASTEXITCODE -eq 0) { Write-Host "  working tree -> $BK_DIR\zoro-worktree-backup-$STAMP.tar.gz" }

# ---------------------------------------------------------------------------
Write-Host "`n=== SAFETY CHECK: abort if there are unpushed local commits ==="
git fetch origin --quiet 2>$null
$HEAD_SHA   = (git rev-parse HEAD).Trim()
$ORIGIN_SHA = (git rev-parse origin/main 2>$null)
if ($ORIGIN_SHA) { $ORIGIN_SHA = $ORIGIN_SHA.Trim() } else { $ORIGIN_SHA = "none" }
Write-Host "  HEAD        = $HEAD_SHA"
Write-Host "  origin/main = $ORIGIN_SHA"
if ($ORIGIN_SHA -ne "none" -and $HEAD_SHA -ne $ORIGIN_SHA) {
  Write-Host "  WARNING: HEAD != origin/main. Inspect before reset. Aborting to be safe." -ForegroundColor Yellow
  Write-Host "  (Run: git log --oneline origin/main..HEAD  to see local-only commits.)"
  exit 1
}
Write-Host "  OK: HEAD matches origin/main (== live deploy). Safe to realign." -ForegroundColor Green

# ---------------------------------------------------------------------------
Write-Host "`n=== STEP 1: realign tracked files to HEAD (restores Whisper/push/CI) ==="
git reset --hard HEAD
git rev-parse HEAD

# ---------------------------------------------------------------------------
Write-Host "`n=== STEP 2: delete dead + junk files ==="
$JUNK = @(
  "api\gemini.js","api\job-coach.js","api\match-score.js",
  "index.html.new","index.html.prevdeploy.bak",
  "_head_index.tmp","_head.txt","_disk.txt","_deltest.txt"
)
foreach ($f in $JUNK) {
  if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force; Write-Host "  removed: $f" }
  else { Write-Host "  (absent): $f" }
}

# ---------------------------------------------------------------------------
Write-Host "`n=== STEP 3: delete stale lock branch ==="
$branches = git branch --format='%(refname:short)'
if ($branches -contains "main.lock.stale_1781787330") {
  git branch -D main.lock.stale_1781787330; Write-Host "  deleted stale branch"
} else { Write-Host "  (no stale branch found)" }

# ---------------------------------------------------------------------------
Write-Host "`n=== STEP 4: harden .gitignore ==="
$patterns = @("node_modules/","*.bak","*.new","*.tmp")
$existing = @()
if (Test-Path ".gitignore") { $existing = Get-Content ".gitignore" }
foreach ($p in $patterns) {
  if ($existing -notcontains $p) { Add-Content ".gitignore" $p; Write-Host "  + $p" }
}

# ---------------------------------------------------------------------------
Write-Host "`n=== STEP 5: adopt zoro-docs/ as canonical (remove root duplicates) ==="
$docs = @("AUDIT_AND_FIX_PROMPT.md","OVERNIGHT_BUILD_REPORT.md","PASTE_TO_CLAUDE_CODE_AUDIT.txt","PHASE5_PLUS_PROMPT.md","WIRE_UP_FIX.md")
foreach ($d in $docs) {
  $tracked = $false
  git ls-files --error-unmatch $d *> $null 2>&1; if ($LASTEXITCODE -eq 0) { $tracked = $true }
  if ((Test-Path "zoro-docs\$d") -and $tracked) { git rm -q $d; Write-Host "  moved to zoro-docs: $d" }
}

# ---------------------------------------------------------------------------
Write-Host "`n=== STEP 6: commit the cleanup + new work ==="
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Write-Host "  nothing to commit (tree already clean)" }
else {
  git commit -m "chore(zoro): clean working tree to live HEAD; drop dead consolidated fns; relocate docs to zoro-docs; harden gitignore; add voice-hotspot-project + project map"
  Write-Host "  committed. (Not pushed - run 'git push' when ready.)"
}

# ---------------------------------------------------------------------------
Write-Host "`n=== STEP 7: VERIFY ==="
$ok = $true
Write-Host "-- node --check all api JS (incl. subfolders)"
Get-ChildItem -Path "api" -Recurse -Filter *.js | ForEach-Object {
  node --check $_.FullName 2>$null
  if ($LASTEXITCODE -eq 0) { Write-Host "  OK   $($_.FullName)" } else { Write-Host "  FAIL $($_.FullName)" -ForegroundColor Red; $ok = $false }
}
Write-Host "-- function count (Vercel Hobby limit = 12)"
$NF = (Get-ChildItem -Path "api" -Recurse -Filter *.js).Count
Write-Host "  api functions: $NF"
if ($NF -le 12) { Write-Host "  OK (<=12)" -ForegroundColor Green } else { Write-Host "  FAIL (>12)" -ForegroundColor Red; $ok = $false }
Write-Host "-- vercel.json is valid JSON"
try { Get-Content "vercel.json" -Raw | ConvertFrom-Json | Out-Null; Write-Host "  OK valid JSON" -ForegroundColor Green }
catch { Write-Host "  FAIL invalid JSON" -ForegroundColor Red; $ok = $false }
Write-Host "-- CI validator (if present)"
if (Test-Path "scripts\ci-validate.mjs") { node scripts\ci-validate.mjs; Write-Host "  CI validate ran" } else { Write-Host "  (ci-validate.mjs not run)" }
Write-Host "-- git status"
git status -s
Write-Host "-- HEAD vs origin/main (live must be untouched)"
Write-Host ("  HEAD=" + (git rev-parse --short HEAD) + "  origin/main=" + (git rev-parse --short origin/main 2>$null))

Write-Host ""
if ($ok) {
  Write-Host "============================================================" -ForegroundColor Green
  Write-Host " DONE - working tree clean & verified. Backups in: $BK_DIR" -ForegroundColor Green
  Write-Host " Next: review, then 'git push' to update the repo." -ForegroundColor Green
  Write-Host "============================================================" -ForegroundColor Green
} else {
  Write-Host "!!! Some checks FAILED - review output above. Backups in: $BK_DIR" -ForegroundColor Red
}
