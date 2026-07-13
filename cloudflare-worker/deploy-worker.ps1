# ============================================================
#  Deploy Personal OS MCP Worker  (adds the new get_jobs tool)
#  הרץ: לחיצה ימנית על הקובץ -> Run with PowerShell
#  או ב-PowerShell:  powershell -ExecutionPolicy Bypass -File .\deploy-worker.ps1
# ============================================================
$ErrorActionPreference = "Stop"

# 1) עוברים לתיקיית ה-Worker
Set-Location "C:\Users\user\Documents\New project\personal-os\cloudflare-worker"
Write-Host "== Folder ==" -ForegroundColor Cyan
Get-Location

# 2) התקנת תלויות (פעם ראשונה בלבד; לא מזיק להריץ שוב)
Write-Host "== npm install ==" -ForegroundColor Cyan
npm install

# 3) התחברות ל-Cloudflare (נפתח דפדפן; פעם אחת בלבד)
Write-Host "== wrangler login (browser opens; one-time) ==" -ForegroundColor Cyan
npx wrangler login

# 4) פריסה — מעלה את הקוד החדש עם get_jobs
Write-Host "== wrangler deploy ==" -ForegroundColor Cyan
npx wrangler deploy

Write-Host ""
Write-Host "✅ Deploy done. חזור ל-Cowork ותגיד 'סיימתי deploy' כדי שנמשיך לחיווט הדשבורד." -ForegroundColor Green
