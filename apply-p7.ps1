<#
================================================================================
 apply-p7.ps1  —  P7a: free neural Hebrew TTS (Microsoft Edge) + Avri/Hila switch
 Built 2026-06-19.

 WHAT CHANGED (already written; this script installs the dep, verifies, commits):
   EDIT api/claude.js   handleSpeak now uses Edge neural TTS (free, no key).
                        Voices: avri (male) / hila (female). OpenAI kept as an
                        optional fallback only if OPENAI_API_KEY exists. On total
                        failure the client still falls back to the browser voice.
   EDIT voice.js        sends the chosen voice; new menu toggle "קול: אברי/הילה"
                        (persisted in localStorage), with an audible sample on switch.
   EDIT package.json    adds dependency edge-tts-universal (^1.4.0).
   FUNCTIONS: unchanged (9/12) — no new serverless function.

 RUN (PowerShell):
   powershell -ExecutionPolicy Bypass -File "C:\Users\user\Documents\New project\personal-os\apply-p7.ps1"
 Nothing is pushed automatically.
================================================================================
#>
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot
$REPO = (Get-Location).Path
Write-Host "Repo: $REPO"
if (-not (Test-Path ".git")) { Write-Host "ERROR: not a git repo. Aborting." -ForegroundColor Red; exit 1 }

$STAMP  = Get-Date -Format "yyyyMMdd-HHmmss"
$BK_DIR = Split-Path $REPO -Parent

Write-Host "`n=== STEP 0: BACKUP ==="
git bundle create "$BK_DIR\zoro-repo-backup-$STAMP.bundle" --all 2>$null
tar --exclude='./.git' --exclude='*/node_modules/*' -czf "$BK_DIR\zoro-worktree-backup-$STAMP.tar.gz" . 2>$null
Write-Host "  backups -> $BK_DIR"

Write-Host "`n=== SAFETY CHECK: HEAD must equal origin/main ==="
git fetch origin --quiet 2>$null
$HEAD_SHA = (git rev-parse HEAD).Trim()
$ORIGIN_SHA = (git rev-parse origin/main 2>$null); if ($ORIGIN_SHA) { $ORIGIN_SHA = $ORIGIN_SHA.Trim() } else { $ORIGIN_SHA = "none" }
Write-Host "  HEAD=$HEAD_SHA  origin/main=$ORIGIN_SHA"
if ($ORIGIN_SHA -ne "none" -and $HEAD_SHA -ne $ORIGIN_SHA) {
  Write-Host "  WARNING: HEAD != origin/main. Push or inspect first. Aborting." -ForegroundColor Yellow; exit 1
}

Write-Host "`n=== STEP 1: install dependency (generates package-lock.json) ==="
npm install edge-tts-universal --save 2>&1 | Select-Object -Last 3
if ($LASTEXITCODE -ne 0) { Write-Host "  WARNING: npm install reported an issue; Vercel will still install on deploy." -ForegroundColor Yellow }

Write-Host "`n=== STEP 2: VERIFY ==="
$ok = $true
Write-Host "-- node --check all api JS"
Get-ChildItem -Path "api" -Recurse -Filter *.js | ForEach-Object {
  node --check $_.FullName 2>$null
  if ($LASTEXITCODE -eq 0) { Write-Host "  OK   $($_.Name)" } else { Write-Host "  FAIL $($_.FullName)" -ForegroundColor Red; $ok = $false }
}
Write-Host "-- node --check voice.js"
node --check voice.js 2>$null; if ($LASTEXITCODE -eq 0) { Write-Host "  OK voice.js" } else { Write-Host "  FAIL voice.js" -ForegroundColor Red; $ok = $false }
Write-Host "-- function count (limit 12)"
$NF = (Get-ChildItem -Path "api" -Recurse -Filter *.js).Count
Write-Host "  api functions: $NF"; if ($NF -le 12) { Write-Host "  OK (<=12)" -ForegroundColor Green } else { Write-Host "  FAIL (>12)" -ForegroundColor Red; $ok = $false }
Write-Host "-- JSON validity (package.json + vercel.json)"
foreach ($j in @("package.json","vercel.json")) {
  try { Get-Content $j -Raw | ConvertFrom-Json | Out-Null; Write-Host "  OK $j" -ForegroundColor Green } catch { Write-Host "  FAIL $j invalid" -ForegroundColor Red; $ok = $false }
}
Write-Host "-- wiring checks"
if (Select-String -Path "api\claude.js" -Pattern "edge-tts-universal" -Quiet) { Write-Host "  OK claude.js uses Edge TTS" } else { Write-Host "  FAIL claude.js missing Edge TTS" -ForegroundColor Red; $ok = $false }
if (Select-String -Path "voice.js" -Pattern "voice: ttsVoice" -Quiet) { Write-Host "  OK voice.js sends voice param" } else { Write-Host "  FAIL voice.js param" -ForegroundColor Red; $ok = $false }
if (Select-String -Path "package.json" -Pattern "edge-tts-universal" -Quiet) { Write-Host "  OK dependency declared" } else { Write-Host "  FAIL dependency missing" -ForegroundColor Red; $ok = $false }
Write-Host "-- CI validator"
if (Test-Path "scripts\ci-validate.mjs") { node scripts\ci-validate.mjs; if ($LASTEXITCODE -ne 0) { $ok = $false } }

if (-not $ok) {
  Write-Host "`n!!! VERIFY FAILED - NOT committing. Restore: git checkout -- . (backups in $BK_DIR)" -ForegroundColor Red
  exit 1
}

Write-Host "`n=== STEP 3: commit (not pushed) ==="
git add -A
git commit -m "P7: free neural Hebrew TTS via Edge (Avri/Hila) + voice toggle; OpenAI now optional fallback"

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " P7 DONE locally & verified. Functions: $NF/12." -ForegroundColor Green
Write-Host " Next: git push   (triggers Vercel deploy + CI)"
Write-Host " Rollback: git revert HEAD   (or restore from $BK_DIR)"
Write-Host "============================================================" -ForegroundColor Green
Write-Host @"

 SMOKE TEST (after 'git push' + Vercel finishes):
   `$base='https://personal-os-coral-tau.vercel.app'
   # Avri (male):
   Invoke-WebRequest "`$base/api/claude" -Method POST -ContentType 'application/json' ``
     -Body '{"mode":"speak","text":"שלום רואי, זה הקול של אברי","voice":"avri"}' -OutFile "`$env:TEMP\zoro-avri.mp3"
   Start-Process "`$env:TEMP\zoro-avri.mp3"
   # Hila (female):
   Invoke-WebRequest "`$base/api/claude" -Method POST -ContentType 'application/json' ``
     -Body '{"mode":"speak","text":"שלום, אני הילה","voice":"hila"}' -OutFile "`$env:TEMP\zoro-hila.mp3"
   Start-Process "`$env:TEMP\zoro-hila.mp3"

 If both mp3s play neural Hebrew -> success. (A tiny JSON file instead = TTS error; the
 app then auto-uses the browser voice.) In the app: tap the orb -> menu -> "קול: אברי/הילה" to switch.
"@
