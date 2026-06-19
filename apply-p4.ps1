<#
================================================================================
 apply-p4.ps1  —  P4: consolidate 4 endpoints into api/util.js (Vercel headroom)
 Built + verified on 2026-06-19.

 WHAT CHANGED (already written, this script just deletes the old files + commits):
   NEW   api/util.js          dispatches fetch-page | log-error | news-digest | send
   EDIT  vercel.json          routes those 4 pretty-paths -> util.js?fn=... ; registers util.js
   DELETE api/fetch-page.js, api/log-error.js, api/news-digest.js, api/whatsapp/send.js
   RESULT  12 -> 9 serverless functions (3 free under Vercel Hobby's 12 limit)

 The client calls only the pretty paths (/api/fetch-page etc.), which are unchanged,
 so NO front-end changes are needed. Google OAuth + webhook/whatsapp-command untouched.

 IMPORTANT: deletion + util.js + vercel.json land in ONE commit, so the deploy never
 sees 13 functions. Nothing is pushed automatically.

 RUN (PowerShell):
   powershell -ExecutionPolicy Bypass -File "C:\Users\user\Documents\New project\personal-os\apply-p4.ps1"
================================================================================
#>
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot
$REPO = (Get-Location).Path
Write-Host "Repo: $REPO"
if (-not (Test-Path ".git")) { Write-Host "ERROR: not a git repo. Aborting." -ForegroundColor Red; exit 1 }
if (-not (Test-Path "api\util.js")) { Write-Host "ERROR: api\util.js missing - run from the prepared repo. Aborting." -ForegroundColor Red; exit 1 }

$STAMP  = Get-Date -Format "yyyyMMdd-HHmmss"
$BK_DIR = Split-Path $REPO -Parent

Write-Host "`n=== STEP 0: BACKUP ==="
git bundle create "$BK_DIR\zoro-repo-backup-$STAMP.bundle" --all 2>$null
if ($LASTEXITCODE -eq 0) { Write-Host "  history -> $BK_DIR\zoro-repo-backup-$STAMP.bundle" }
tar --exclude='./.git' --exclude='*/node_modules/*' -czf "$BK_DIR\zoro-worktree-backup-$STAMP.tar.gz" . 2>$null
if ($LASTEXITCODE -eq 0) { Write-Host "  worktree -> $BK_DIR\zoro-worktree-backup-$STAMP.tar.gz" }

Write-Host "`n=== SAFETY CHECK: HEAD must equal origin/main ==="
git fetch origin --quiet 2>$null
$HEAD_SHA   = (git rev-parse HEAD).Trim()
$ORIGIN_SHA = (git rev-parse origin/main 2>$null); if ($ORIGIN_SHA) { $ORIGIN_SHA = $ORIGIN_SHA.Trim() } else { $ORIGIN_SHA = "none" }
Write-Host "  HEAD=$HEAD_SHA  origin/main=$ORIGIN_SHA"
if ($ORIGIN_SHA -ne "none" -and $HEAD_SHA -ne $ORIGIN_SHA) {
  Write-Host "  WARNING: HEAD != origin/main. Push or inspect first. Aborting to be safe." -ForegroundColor Yellow
  exit 1
}

Write-Host "`n=== STEP 1: delete the 4 merged files ==="
$OLD = @("api\fetch-page.js","api\log-error.js","api\news-digest.js","api\whatsapp\send.js")
foreach ($f in $OLD) {
  if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force; Write-Host "  removed: $f" }
  else { Write-Host "  (already absent): $f" }
}

Write-Host "`n=== STEP 2: stage everything ==="
git add -A

Write-Host "`n=== STEP 3: VERIFY (before commit) ==="
$ok = $true
Write-Host "-- node --check all api JS"
Get-ChildItem -Path "api" -Recurse -Filter *.js | ForEach-Object {
  node --check $_.FullName 2>$null
  if ($LASTEXITCODE -eq 0) { Write-Host "  OK   $($_.Name)" } else { Write-Host "  FAIL $($_.FullName)" -ForegroundColor Red; $ok = $false }
}
Write-Host "-- function count (limit 12)"
$NF = (Get-ChildItem -Path "api" -Recurse -Filter *.js).Count
Write-Host "  api functions: $NF"
if ($NF -le 12) { Write-Host "  OK (<=12), headroom: $(12 - $NF)" -ForegroundColor Green } else { Write-Host "  FAIL (>12)" -ForegroundColor Red; $ok = $false }
Write-Host "-- vercel.json valid JSON"
try { Get-Content "vercel.json" -Raw | ConvertFrom-Json | Out-Null; Write-Host "  OK valid JSON" -ForegroundColor Green } catch { Write-Host "  FAIL invalid JSON" -ForegroundColor Red; $ok = $false }
Write-Host "-- every route ?fn= is handled in util.js"
$routeFns = (Select-String -Path "vercel.json" -Pattern "util\.js\?fn=([a-z-]+)" -AllMatches).Matches | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
$handled  = (Select-String -Path "api\util.js" -Pattern "fn === '([a-z-]+)'" -AllMatches).Matches | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
foreach ($r in $routeFns) { if ($handled -contains $r) { Write-Host "  OK   route fn=$r handled" } else { Write-Host "  FAIL route fn=$r NOT handled" -ForegroundColor Red; $ok = $false } }
Write-Host "-- CI validator"
if (Test-Path "scripts\ci-validate.mjs") { node scripts\ci-validate.mjs; if ($LASTEXITCODE -ne 0) { $ok = $false } }

if (-not $ok) {
  Write-Host "`n!!! VERIFY FAILED - NOT committing. Restore with: git reset --hard HEAD ; git checkout -- ." -ForegroundColor Red
  Write-Host "    (Your files + backups are intact in $BK_DIR)"
  exit 1
}

Write-Host "`n=== STEP 4: commit (not pushed) ==="
git commit -m "P4: consolidate fetch-page/log-error/news-digest/whatsapp-send into api/util.js (12 -> 9 functions)"

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " P4 DONE locally & verified. 12 -> $NF functions." -ForegroundColor Green
Write-Host " Next:"
Write-Host "   1) git push        (triggers Vercel deploy + CI)"
Write-Host "   2) After deploy, smoke-test the 4 routes (see below)."
Write-Host " Rollback if needed:  git revert HEAD   (or restore from $BK_DIR)"
Write-Host "============================================================" -ForegroundColor Green
Write-Host @"

 SMOKE TEST (run after 'git push' + Vercel finishes deploying):
   `$base='https://personal-os-coral-tau.vercel.app'
   irm "`$base/api/fetch-page?url=https://example.com"            # expect ok:true, chars>0
   irm "`$base/api/log-error?user=tklroei1@gmail.com"             # expect { errors: [...] }
   irm "`$base/api/news-digest" -Method POST -ContentType 'application/json' -Body '{"topics":["AI"]}'
   irm "`$base/api/whatsapp/send" -Method POST -ContentType 'application/json' -Body '{"to":"+10000000000","body":"test"}'  # expect Twilio 'not configured' or sid
"@
