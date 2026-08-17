# ============================================================
# PAYROLL GANG SUITE — push del rilascio da Windows (PowerShell)
#
# Normalizzazione fine riga (LF) -> commit -> push su origin/main.
# Dalla radice del repo:
#     .\pgs-push.ps1
#     .\pgs-push.ps1 -Message "il mio messaggio di commit"
#
# Dopo il push, sul server pre-prod (SSH):  pgs-update   poi   bash pgs-xff-check.sh
# ============================================================

[CmdletBinding()]
param([string]$Message)

# NB: niente $ErrorActionPreference='Stop' — git scrive spesso su stderr
# (progressi, avvisi) e in PowerShell 5.1 verrebbe scambiato per errore.
# Il controllo di esito e' fatto a mano su $LASTEXITCODE dopo ogni git.

Set-Location -Path $PSScriptRoot

function Assert-Ok([string]$what) {
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRORE: $what (exit $LASTEXITCODE). Nulla di irreversibile e' stato fatto." -ForegroundColor Red
    exit 1
  }
}

if (-not $Message) {
  $Message = @"
sicurezza (SEC-A5): IP client da CF-Connecting-IP + origine chiusa a Cloudflare

L'app ricava audit e rate limiting da CF-Connecting-IP (non falsificabile
dietro Cloudflare), con fallback a request.ip senza CDN. Nuovo script
pgs-cf-origin-lock.sh: 80/443 solo dai range Cloudflare (CSF/ufw/firewalld).
"@
}

# Lock residui (es. lasciati da una sessione remota sul mount): pulizia difensiva.
Remove-Item -Path (Join-Path $PSScriptRoot '.git\index.lock') -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path (Join-Path $PSScriptRoot '.git') -Filter 'index.lock.stale-*' -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "== Branch ==" -ForegroundColor Cyan
git rev-parse --abbrev-ref HEAD
Assert-Ok "git rev-parse"

Write-Host "== Normalizzazione fine riga (.gitattributes) e staging ==" -ForegroundColor Cyan
git add --renormalize .
Assert-Ok "git add --renormalize"
git add -A
Assert-Ok "git add -A"

Write-Host "== Modifiche in stage ==" -ForegroundColor Cyan
git status --short

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "Niente da committare: albero pulito." -ForegroundColor Yellow
  exit 0
}

Write-Host "== Commit ==" -ForegroundColor Cyan
git commit -m $Message
Assert-Ok "git commit"

Write-Host "== Push su origin/main ==" -ForegroundColor Cyan
git push origin main
Assert-Ok "git push"

Write-Host "OK: push completato. Sul server pre-prod:  pgs-update  poi  bash pgs-xff-check.sh" -ForegroundColor Green
