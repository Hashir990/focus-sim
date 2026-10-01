<#
.SYNOPSIS
  Cut, build, upload and verify a release, in one run, from PowerShell.

.DESCRIPTION
  The steps in HANDOFF.md section 8a, in the order they have to happen, with the
  things that have each cost a round of "auto-update is broken" checked rather
  than remembered: every source file committed including the untracked ones, all
  four assets on the release rather than just latest.json, the installer named
  with hyphens, and the release marked Latest.

  Stops at the first failure and names the step. Safe to re-run: the bump is
  skipped if package.json already carries that version, and asset upload
  replaces same-named files rather than duplicating them.

  NOTES ON HOW THIS IS WRITTEN, because all three have bitten this project:

    * It is saved as UTF-8 WITH a BOM. Windows PowerShell 5.1 reads a BOM-less
      .ps1 as ANSI, which turns every non-ASCII character into mojibake -- and a
      mojibake character inside a regex silently stops matching. The body below
      is ASCII only as well; the one character it needs is built from its code
      point at runtime.

    * It calls "node tools\<file>.mjs" rather than "npm run <script> ""args""".
      npm hands its arguments to cmd, which re-parses the quoting, and a release
      note with punctuation in it does not survive that reliably.

    * Where output has to be captured, the "2>&1" lives INSIDE the cmd string.
      Doing it in a PowerShell pipeline turns a native command's stderr into
      error records, and with $ErrorActionPreference = Stop the first npm
      warning ends the run.

.PARAMETER Bump
  patch | minor | major, or an explicit version like 1.2.0. Default: minor.

.PARAMETER Notes
  The release note. It is shown in the in-app update banner, so write it for the
  person using the app rather than for the commit log.

.PARAMETER SkipTests
  Skip the test suite entirely. For a second run in a tree where it has already
  passed -- never for getting past a failure, because it hides the next one too.

.PARAMETER Except
  Substrings of check names that are allowed to fail without stopping the
  release. Everything still runs and everything still gets printed; only the
  named ones lose their veto. Prefer this over -SkipTests: a suite with three
  known-red checks still catches the fourth.

.PARAMETER AllowBankInProgress
  Shorthand for the crossword-bank counting checks. A background job adds a
  couple of puzzles at each size a day, so the checks that want ten of
  everything are red for as long as the bank is short of that; they are about
  the state of the data, not about the code being shipped.

  The no-repeat rule is deliberately NOT in here. That one is a rule the
  generator keeps on every run, so if it goes red something is actually wrong --
  either the bank, or, as happened once, the check itself asserting a rule the
  generator had retired.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\tools\ship-release.ps1 -Notes "What changed."
#>
[CmdletBinding()]
param(
  [ValidatePattern('^(patch|minor|major|\d+\.\d+\.\d+)$')]
  [string] $Bump = 'minor',
  [Parameter(Mandatory = $true)]
  [string] $Notes,
  [switch] $SkipTests,
  [string[]] $Except = @(),
  [switch] $AllowBankInProgress
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
# So the suite's tick and cross render instead of arriving as question marks.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$CROSS = [char]0x2717

$script:step = 0
$script:tolerated = @()
function Step($name) {
  $script:step++
  Write-Host ''
  Write-Host ("=== {0}. {1} " -f $script:step, $name).PadRight(72, '=') -ForegroundColor Cyan
}
function Fail($why) {
  Write-Host ''
  Write-Host "FAILED at step $script:step : $why" -ForegroundColor Red
  exit 1
}
# Native commands, called directly so PowerShell does the quoting once and cmd
# never sees it. $LASTEXITCODE is read on the very next line: anything else in
# between can overwrite it.
function Run {
  param([string] $exe, [string[]] $argv)
  Write-Host "> $exe $($argv -join ' ')" -ForegroundColor DarkGray
  & $exe @argv
  $code = $LASTEXITCODE
  if ($code -ne 0) { Fail "$exe exited $code" }
}

# --- 1. the things that make everything after them pointless -----------------
Step 'Preflight'
foreach ($exe in 'node', 'npm', 'git') {
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { Fail "$exe is not on PATH" }
}
# publish-check.mjs and publish-assets.ps1 take either name; electron-builder
# wants GH_TOKEN. Mirror whichever exists so nothing downstream disagrees.
$token = if ($env:GH_TOKEN) { $env:GH_TOKEN } else { $env:GITHUB_TOKEN }
if (-not $token) {
  Fail 'Neither GH_TOKEN nor GITHUB_TOKEN is set in this window. setx does not affect the window it was typed in; open a new one.'
}
# A trailing space is the whole of "Bad credentials". It survives setx, it is
# invisible, and it turns every upload into a 401 that reads like a scope issue.
if ($token -ne $token.Trim()) {
  Fail 'The token has whitespace around it, which alone causes "Bad credentials". Re-set it and paste nothing after the closing quote.'
}
$env:GH_TOKEN = $token
Write-Host ("token present ({0}..., {1} characters)" -f $token.Substring(0, [Math]::Min(7, $token.Length)), $token.Length)

# A lock with no git process behind it fails every "git add" in the tree with
# "Another git process seems to be running", which reads like a real conflict.
if (Test-Path '.git\index.lock') {
  $lock = Get-Item '.git\index.lock'
  Fail ("A git index lock from {0:yyyy-MM-dd HH:mm} is in the way. If no git process is running: Remove-Item .git\index.lock" -f $lock.LastWriteTime)
}
$before = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host "version $before, bumping $Bump"

# --- 2. tests, against the tree that is about to be shipped ------------------
if ($SkipTests) {
  Write-Host 'Skipping tests (-SkipTests)' -ForegroundColor Yellow
} else {
  Step 'Tests'
  # Captured rather than streamed raw: "npm test" is seven files and thousands of
  # lines of pass output, and the last forty of them are almost never the reason.
  $log = Join-Path $env:TEMP ("focus-test-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Write-Host "> npm test   (log: $log)" -ForegroundColor DarkGray
  & cmd /c "npm test 2>&1" | Tee-Object -FilePath $log | Where-Object {
    $_ -match 'checks passed' -or $_ -match [regex]::Escape($CROSS) -or $_ -match '^(FAILED|Error)'
  } | ForEach-Object { Write-Host $_ }
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    $failed = @(Select-String -Path $log -SimpleMatch $CROSS | ForEach-Object { $_.Line.Trim() })
    # **A non-zero exit with no failing checks is not a tolerable failure, it is
    # a crash.** The suite died on an unsupported import once and printed no
    # check lines at all; anything that treats "nothing failed" as "nothing to
    # veto" would have waved that straight through to a release.
    if ($failed.Count -eq 0) {
      Write-Host "Full output: $log" -ForegroundColor DarkGray
      Fail "npm test exited $code without reporting a single failing check, which means it did not finish. Read the log."
    }
    $allow = @($Except)
    if ($AllowBankInProgress) {
      $allow += 'nine-by-nines in the bank',
                'at least ten of every size', 'every puzzle at this size'
    }
    $blocking = @($failed | Where-Object {
      $line = $_
      -not ($allow | Where-Object { $line -like "*$_*" })
    })
    $tolerated = @($failed | Where-Object { $_ -notin $blocking })
    if ($tolerated.Count) {
      Write-Host ''
      Write-Host 'Allowed to fail:' -ForegroundColor Yellow
      $tolerated | ForEach-Object { Write-Host ('  ' + $_) -ForegroundColor Yellow }
      $script:tolerated = $tolerated
    }
    if ($blocking.Count) {
      Write-Host ''
      Write-Host 'Failing checks:' -ForegroundColor Red
      $blocking | ForEach-Object { Write-Host ('  ' + $_) -ForegroundColor Red }
      Write-Host "Full output: $log" -ForegroundColor DarkGray
      Fail "$($blocking.Count) check(s) failed. Fix them, or name them with -Except if they are not regressions from this change."
    }
    Write-Host ''
    Write-Host "Carrying on: every remaining failure was named as allowed." -ForegroundColor Yellow
  } else {
    Write-Host 'tests passed' -ForegroundColor Green
  }
}

# --- 3. everything committed, including files git has never seen -------------
# 46-buddy.js, 30-embers.css and the look tools are untracked; a release built
# from a dirty tree is one nobody can rebuild.
Step 'Commit the working tree'
Run 'git' @('add', '-A')
$staged = & git diff --cached --name-only
if (-not $staged) {
  Write-Host 'Nothing to commit; tree already clean.' -ForegroundColor Yellow
} else {
  Write-Host ("{0} files staged" -f @($staged).Count) -ForegroundColor DarkGray
  Run 'git' @('commit', '-m', $Notes)
}

# --- 4. bump, build, write latest.json ---------------------------------------
Step 'Cut the release'
Run 'node' @('tools/make-release.mjs', $Bump, $Notes)
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host "version is now $version" -ForegroundColor Green

# The bump has to be its own commit, and it has to happen before the tag. Step 3
# committed the work; make-release then rewrote package.json and latest.json, so
# without this the tag points at a commit that does not contain the version it
# is named after -- and latest.json, which is the entire server side of the page
# updater, never reaches the repo at all. dist/ and release/ are gitignored, so
# this stages exactly those two files.
if (& git status --porcelain) {
  Run 'git' @('add', 'package.json', 'latest.json')
  Run 'git' @('commit', '-m', "Release v$version")
}

# --- 5. names, hashes, token, and what the last release actually carries ------
Step 'publish:check'
Run 'node' @('tools/publish-check.mjs')

# --- 6. build the installer, locally, with no publishing in it ---------------
# Deliberately NOT "npm run publish:win". That runs electron-builder with
# "--publish always", which has failed to attach the installer three times in
# this project and reported success every time -- a 401, a release holding only
# latest.json, and a draft release. Building and uploading are separated here so
# that the upload is done by the one thing that reads the release back
# afterwards, and so that a build is never thrown away because an upload failed.
Step 'Build the Windows installer'
# The developer menu is stamped in from .env.local, which exists on the machine
# this is usually run from. Never into anything handed out: see devFlag in
# tools/build.mjs, which ignores that file when FOCUS_RELEASE is set.
$env:FOCUS_RELEASE = '1'
Run 'npm' @('run', 'build')
# Not fatal on its own: electron-builder can exit non-zero having still written
# a perfectly good installer -- typically while trying to publish something it
# was not asked to publish. Step 7 is the judge, because it checks for the files.
Write-Host '> npx electron-builder --win' -ForegroundColor DarkGray
& npx electron-builder --win
if ($LASTEXITCODE -ne 0) {
  Write-Host 'electron-builder exited non-zero; carrying on to the upload, which checks for the files it needs.' -ForegroundColor Yellow
}

# --- 6b. the copy it installs has to be removable again ----------------------
# An update uninstalls the old copy before putting the new one down, and the
# uninstaller moves every installed file into a temp folder to do it. A path
# too long for that move fails, is reported as "File is busy", and leaves
# everybody stranded on the version they already have -- one release later, so
# the build that caused it is long gone. Measured before the upload, because
# after the upload it is somebody else's problem. See tools/path-check.mjs.
Step 'Check the packed paths'
Run 'node' @('tools/path-check.mjs')

# --- 7. upload the four files and read the release back ----------------------
# publish-assets.ps1 finds the release for this tag including drafts, replaces
# same-named assets, publishes the draft, sets make_latest, and then reads the
# release back and prints what is on it -- because every failure it exists for
# reported success. It uploads latest.json too, so publish-extra.mjs is not
# needed on this path.
Step 'Attach and verify the assets'
Run 'powershell' @('-ExecutionPolicy', 'Bypass', '-File', 'tools/publish-assets.ps1')

Step 'Re-check'
Run 'node' @('tools/publish-check.mjs')

# --- 8. tag ------------------------------------------------------------------
Step 'Tag'
$tag = "v$version"
if (-not (& git tag -l $tag)) { Run 'git' @('tag', '-a', $tag, '-m', $Notes) }

Write-Host ''
if ($script:tolerated) {
  Write-Host 'Shipped with these checks knowingly red:' -ForegroundColor Yellow
  $script:tolerated | ForEach-Object { Write-Host ('  ' + $_) -ForegroundColor Yellow }
  Write-Host ''
}
Write-Host "Released $version." -ForegroundColor Green
Write-Host 'Push it when you are happy:' -ForegroundColor Green
Write-Host "  git push && git push origin $tag" -ForegroundColor Green
Write-Host ''
Write-Host 'Then confirm on GitHub that the release is marked "Set as the latest release"' -ForegroundColor Green
Write-Host 'and carries all four assets:' -ForegroundColor Green
Write-Host "  Focus-Simulator-Setup-$version.exe" -ForegroundColor Green
Write-Host "  Focus-Simulator-Setup-$version.exe.blockmap" -ForegroundColor Green
Write-Host '  latest.yml' -ForegroundColor Green
Write-Host '  latest.json' -ForegroundColor Green
