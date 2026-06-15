<***REMOVED***
.SYNOPSIS
  Remove leaked secrets from the ENTIRE git history (every commit) with git-filter-repo,
  on a throwaway mirror clone, verify, then optionally force-push.

.DESCRIPTION
  Safe by default:
    * works on a fresh `git clone --mirror` in a TEMP dir — never your working copy;
    * keeps a backup of the original mirror;
    * does NOT push unless you pass -Push (and type FORCE to confirm).

  IMPORTANT: rewriting history does NOT un-leak anything. ROTATE every leaked secret at the
  source FIRST (DB users, broker users, etc.). Treat them as already compromised.

.PARAMETER RepoUrl
  Remote to clean. Defaults to the `origin` of the current repo.

.PARAMETER SecretsFile
  git-filter-repo --replace-text file; one rule per line: <literal-secret>==><replacement>.
  If it doesn't exist a template is written (in TEMP) and the script stops so you can fill it.
  This file holds real secrets — never commit it.

.PARAMETER WorkDir
  Where the mirror clone + backup live. Default: $env:TEMP\secret-scrub (outside the repo).

.PARAMETER Push
  Force-push the rewritten history to RepoUrl (asks for an explicit FORCE confirmation).

.EXAMPLE
  .\scripts\scrub-secrets.ps1                 ***REMOVED*** 1st run: writes the template, stops
  ***REMOVED*** ...edit the template with the real leaked values...
  .\scripts\scrub-secrets.ps1                 ***REMOVED*** rewrite locally + verify (no push)
  .\scripts\scrub-secrets.ps1 -Push           ***REMOVED*** after rotating + verifying: push
***REMOVED***>
[CmdletBinding()]
param(
  [string]$RepoUrl,
  [string]$WorkDir = (Join-Path $env:TEMP 'secret-scrub'),
  [string]$SecretsFile = (Join-Path $env:TEMP 'secret-scrub\secret-replacements.txt'),
  [switch]$Push
)

$ErrorActionPreference = 'Stop'
function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Ok($m)   { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }
function Die($m)  { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }

***REMOVED*** --- prerequisites ----------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die 'git not found in PATH.' }

if (-not $RepoUrl) {
  try { $RepoUrl = (git remote get-url origin 2>$null).Trim() } catch {}
  if (-not $RepoUrl) { Die 'No -RepoUrl given and no "origin" remote found.' }
}
Info "Target repo : $RepoUrl"

***REMOVED*** Resolve how to invoke git-filter-repo: as a git subcommand, a standalone exe, or — when
***REMOVED*** only the Python package is installed (pip without its Scripts dir on PATH) — the module.
$FR_EXE = $null
$FR_PRE = @()
git filter-repo --version *> $null
if ($LASTEXITCODE -eq 0) {
  $FR_EXE = 'git'; $FR_PRE = @('filter-repo')
}
elseif (Get-Command git-filter-repo -ErrorAction SilentlyContinue) {
  $FR_EXE = (Get-Command git-filter-repo).Source
}
else {
  $pyExe = (Get-Command python -ErrorAction SilentlyContinue)
  if (-not $pyExe) { $pyExe = (Get-Command py -ErrorAction SilentlyContinue) }
  if ($pyExe) {
    $mod = (& $pyExe.Source -c "import git_filter_repo,sys;sys.stdout.write(git_filter_repo.__file__)") 2>$null
    if ($mod -and (Test-Path $mod)) { $FR_EXE = $pyExe.Source; $FR_PRE = @($mod) }
  }
}
if (-not $FR_EXE) {
  Warn 'git-filter-repo not found (not a git subcommand, not on PATH, not importable).'
  Warn '  pip install git-filter-repo'
  Warn '  then re-run (this script also runs it directly via the Python module).'
  Die  'git-filter-repo required.'
}
Info "filter-repo  : $FR_EXE $($FR_PRE -join ' ')"

***REMOVED*** --- secrets / replacements file -------------------------------------------
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
if (-not (Test-Path $SecretsFile)) {
  @'
***REMOVED*** git-filter-repo --replace-text rules. One per line: <literal-secret>==><replacement>
***REMOVED*** Put the ACTUAL leaked values on the LEFT. They are replaced in EVERY commit/blob.
***REMOVED*** Lines starting with ***REMOVED*** are ignored. NEVER commit this file.
PUT-MONGO-PASSWORD-HERE==>REDACTED
PUT-RABBITMQ-PASSWORD-HERE==>REDACTED
PUT-RABBITMQ-USERNAME-HERE==>REDACTED
PUT-REDIS-PASSWORD-HERE==>REDACTED
'@ | Set-Content -Encoding UTF8 $SecretsFile
  Ok   "Template written: $SecretsFile"
  Warn 'Fill it with the real leaked values, then re-run this script.'
  exit 0
}
if (Select-String -Path $SecretsFile -Pattern 'PUT-.*-HERE' -Quiet) {
  Die "Replacements file still has PUT-...-HERE placeholders. Fill real values: $SecretsFile"
}

***REMOVED*** parse the literal secrets (left of ==>) for verification
$secrets = Get-Content $SecretsFile |
  Where-Object { $_ -and -not $_.TrimStart().StartsWith('***REMOVED***') -and $_ -match '==>' } |
  ForEach-Object { ($_ -split '==>', 2)[0] }
if (-not $secrets) { Die 'No valid rules found in the replacements file.' }

***REMOVED*** --- mirror clone (+ backup) -----------------------------------------------
$repoName  = (($RepoUrl -split '[/\\]')[-1]) -replace '\.git$',''
$mirrorDir = Join-Path $WorkDir "$repoName.git"
$backupDir = Join-Path $WorkDir "$repoName.backup.git"
foreach ($d in @($mirrorDir, $backupDir)) { if (Test-Path $d) { Remove-Item -Recurse -Force $d } }

Info "Mirror clone -> $mirrorDir"
git clone --mirror $RepoUrl $mirrorDir
if ($LASTEXITCODE -ne 0) { Die 'Mirror clone failed.' }
Copy-Item -Recurse $mirrorDir $backupDir
Ok "Backup kept   -> $backupDir"

***REMOVED*** --- rewrite ----------------------------------------------------------------
Push-Location $mirrorDir
try {
  Info 'Rewriting history (filter-repo --replace-text)...'
  & $FR_EXE @FR_PRE --replace-text $SecretsFile --force
  if ($LASTEXITCODE -ne 0) { Die 'git filter-repo failed.' }
  Ok 'History rewritten on the mirror.'

  ***REMOVED*** --- verify: each secret must be absent from EVERY blob in EVERY commit ----
  Info 'Verifying (scanning all revisions)...'
  $revs = git rev-list --all
  $clean = $true
  foreach ($s in $secrets) {
    $hit = git grep -F -I -n -e $s $revs 2>$null
    if ($hit) { Write-Host "  STILL PRESENT: $s" -ForegroundColor Red; $clean = $false }
    else      { Write-Host "  clean: $s" -ForegroundColor Green }
  }
  if (-not $clean) { Die 'Some secrets are still present after rewrite — do NOT push. Check the rules.' }
  Ok 'All secrets absent from history.'
}
finally { Pop-Location }

***REMOVED*** --- push (guarded) ---------------------------------------------------------
if (-not $Push) {
  Warn 'No -Push: nothing was pushed. Review, ROTATE the secrets, then re-run with -Push.'
  Info "Mirror ready at: $mirrorDir"
  exit 0
}

Warn ''
Warn "About to FORCE-PUSH rewritten history to: $RepoUrl"
Warn 'This is destructive and irreversible on the remote, and rewrites every commit SHA.'
Warn 'Have you ROTATED all leaked secrets already?'
if ((Read-Host "Type 'FORCE' to proceed") -ne 'FORCE') { Die 'Aborted — nothing pushed.' }

Push-Location $mirrorDir
try {
  ***REMOVED*** Push directly to the URL (filter-repo strips the origin remote as a safeguard).
  git push --force $RepoUrl 'refs/heads/*:refs/heads/*'
  if ($LASTEXITCODE -ne 0) { Die 'Force-push of branches failed.' }
  git push --force $RepoUrl 'refs/tags/*:refs/tags/*'
  Ok 'Force-push complete. Tell collaborators to re-clone (or reset --hard) — do NOT merge old clones.'
}
finally { Pop-Location }
