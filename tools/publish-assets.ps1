<#
  Attach a built release to GitHub, correctly, and say so.

      npm run publish:assets

  This exists because `electron-builder --publish always` has failed to get the
  installer onto the release three times running, each time for a different
  reason and each time quietly enough that the app looked broken instead:

    * a 401 that killed the upload but left the release created,
    * a release that ended up holding latest.json and nothing else,
    * and a DRAFT release, which is electron-builder's GitHub default: the
      files upload fine, to a release nobody can see.

  The symptom is identical every time. Installed copies read latest.yml, find
  nothing, and fall back to offering a link. A missing update file and no update
  look the same from the outside, which is why this is worth a script rather
  than a checklist.

  Safe to run repeatedly: assets with the same name are replaced. It finishes by
  reading the release back and printing what is on it, because every failure
  this script exists for reported success.

  Your token is read from the environment and never printed.

  ASCII ONLY IN THIS FILE. Windows PowerShell 5.1 reads a .ps1 with no BOM as
  Windows-1252, so a UTF-8 em dash arrives as three characters, the last of
  which is a curly quote. PowerShell accepts curly quotes as string delimiters,
  so one dash in a comment opens a string that never closes and the parser
  reports a missing brace fifty lines away. That is exactly what happened to the
  first version of this file.
#>

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

# Windows PowerShell 5.1 runs on .NET Framework, which still negotiates TLS 1.0
# by default. GitHub refuses that, and the refusal arrives as "The underlying
# connection was closed" rather than as anything about TLS.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---- the token -------------------------------------------------------------
$token = $env:GH_TOKEN
if (-not $token) { $token = $env:GITHUB_TOKEN }
if (-not $token) {
  Write-Host ''
  Write-Host '  GH_TOKEN is not set in this window.' -ForegroundColor Red
  Write-Host '  setx GH_TOKEN "ghp_..."   then CLOSE this window and open a new one.'
  Write-Host '  (setx only affects new shells. This is the step everyone skips.)'
  exit 1
}
$token = $token.Trim()

$pkg     = Get-Content package.json -Raw | ConvertFrom-Json
$version = $pkg.version
$tag     = "v$version"
$owner   = $pkg.build.publish[0].owner
$repo    = $pkg.build.publish[0].repo
$api     = "https://api.github.com/repos/$owner/$repo"

$headers = @{
  Authorization          = "Bearer $token"
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'           = 'focus-publish-assets'
}

Write-Host ''
Write-Host "  Focus Simulator $version  ->  github.com/$owner/$repo"
Write-Host ''

# ---- the files -------------------------------------------------------------
# latest.yml is the one that matters and the one that goes missing. The banner
# in the page reads latest.json; the installed app's updater reads latest.yml
# and the .exe beside it. Upload one without the other and the app announces a
# version it cannot deliver.
$files = @(
  "release\Focus-Simulator-Setup-$version.exe",
  "release\Focus-Simulator-Setup-$version.exe.blockmap",
  'release\latest.yml',
  'latest.json'
)

$missing = $files | Where-Object { -not (Test-Path $_) }
if ($missing) {
  Write-Host '  These are not built yet:' -ForegroundColor Red
  foreach ($m in $missing) { Write-Host "    $m" }
  Write-Host ''
  Write-Host '  npm run build; npx electron-builder --win'
  exit 1
}

# A space in the name is fatal and invisible: GitHub rewrites spaces to dots on
# upload, so the asset arrives as Focus.Simulator.Setup.1.0.9.exe while
# latest.yml still asks for the hyphenated name. The updater 404s, reports
# nothing, and looks exactly like an app with no update available.
foreach ($f in $files) {
  $leaf = Split-Path $f -Leaf
  if ($leaf -match '\s') {
    Write-Host "  '$leaf' has a space in its name. Rename it to use hyphens." -ForegroundColor Red
    exit 1
  }
}

# latest.yml must describe this build, not the previous one, or the updater
# downloads a file whose hash will not match and gives up.
$ymlLine = Select-String -Path 'release\latest.yml' -Pattern '^version:\s*(.+)$'
$ymlVersion = $ymlLine.Matches[0].Groups[1].Value.Trim()
if ($ymlVersion -ne $version) {
  Write-Host "  release\latest.yml describes $ymlVersion but package.json says $version." -ForegroundColor Red
  Write-Host '  Rebuild so the two agree.'
  exit 1
}

# ---- find or make the release ----------------------------------------------
# Listing releases while authenticated is the only way to see drafts, which is
# where electron-builder puts things by default and where they have hidden
# before.
$releases = Invoke-RestMethod -Uri "$api/releases?per_page=100" -Headers $headers
$mine     = @($releases | Where-Object { $_.tag_name -eq $tag })

# **A published release wins over a draft on the same tag, always.**
#
# electron-builder leaves a draft behind; a partial earlier run can leave a
# published one. When both exist, uploading to the draft is a dead end: you
# cannot then publish it, because GitHub refuses two releases on one tag with
# "Validation Failed ... Release already_exists tag_name" - and that 422 arrives
# at the very end, after the 135 MB upload has already gone to the wrong place.
#
# So target the visible one. It is the one the updater reads, and it is the only
# one that can be made Latest.
$published = @($mine | Where-Object { -not $_.draft })
$drafts    = @($mine | Where-Object { $_.draft })

if ($published.Count -gt 0) {
  $mine = @($published | Sort-Object { $_.assets.Count } -Descending)
  if ($drafts.Count -gt 0) {
    Write-Host "  Note: $($drafts.Count) draft release(s) also on $tag - ignoring them." -ForegroundColor Yellow
    Write-Host '  They cannot be published while this one holds the tag, and they confuse'
    Write-Host '  the Releases page. Delete them on GitHub when convenient:'
    foreach ($d in $drafts) { Write-Host "    $($d.html_url)" }
  }
} elseif ($drafts.Count -gt 0) {
  $mine = @($drafts | Sort-Object { $_.assets.Count } -Descending)
}

if ($mine.Count -eq 0) {
  Write-Host "  Creating release $tag"
  $notes = (Get-Content latest.json -Raw | ConvertFrom-Json).notes
  $body  = @{
    tag_name   = $tag
    name       = $tag
    body       = $notes
    draft      = $false
    prerelease = $false
  } | ConvertTo-Json
  $release = Invoke-RestMethod -Uri "$api/releases" -Headers $headers -Method Post `
    -Body $body -ContentType 'application/json'
} else {
  $release = $mine[0]
  if ($release.draft) { $what = 'draft' } else { $what = 'published' }
  Write-Host "  Found $what release $tag (id $($release.id))"
}

# ---- upload ----------------------------------------------------------------
# **Not Invoke-RestMethod.** On Windows PowerShell 5.1 it buffers the entire
# body into memory before sending, and on a 135 MB installer the send dies with
# "The underlying connection was closed: An unexpected error occurred on a
# send." The small files go up fine, which makes it look like an intermittent
# network fault rather than a size limit.
#
# curl.exe ships with Windows 10 1803 and later and streams the body, so it is
# the one used here. The token goes in a config file rather than on the command
# line: arguments are visible to anything that can list processes.
$curl = (Get-Command curl.exe -ErrorAction SilentlyContinue)

$cfg = $null
if ($curl) {
  $cfg = [System.IO.Path]::GetTempFileName()
  @(
    "header = `"Authorization: Bearer $token`""
    'header = "Accept: application/vnd.github+json"'
    'header = "Content-Type: application/octet-stream"'
    'header = "X-GitHub-Api-Version: 2022-11-28"'
    'user-agent = "focus-publish-assets"'
  ) | Set-Content -Path $cfg -Encoding ASCII
}

try {
  foreach ($f in $files) {
    $name = Split-Path $f -Leaf
    $old  = $release.assets | Where-Object { $_.name -eq $name }
    if ($old) {
      Write-Host "  replacing $name"
      Invoke-RestMethod -Uri "$api/releases/assets/$($old.id)" -Headers $headers -Method Delete | Out-Null
    } else {
      $mb = [math]::Round((Get-Item $f).Length / 1MB, 1)
      Write-Host "  uploading $name ($mb MB)"
    }
    $url = "https://uploads.github.com/repos/$owner/$repo/releases/$($release.id)/assets?name=$name"

    if ($curl) {
      $full = (Resolve-Path $f).Path
      & curl.exe -sS -f -K $cfg -X POST --data-binary "@$full" $url | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Write-Host "  curl failed on $name (exit $LASTEXITCODE)" -ForegroundColor Red
        exit 1
      }
    } else {
      # No curl.exe: older Windows. This works for the small files and may fail
      # on the installer, which is the case curl exists to cover.
      Invoke-RestMethod -Uri $url -Headers $headers -Method Post `
        -InFile $f -ContentType 'application/octet-stream' | Out-Null
    }
  }
} finally {
  if ($cfg -and (Test-Path $cfg)) { Remove-Item $cfg -Force }
}

# ---- publish it, and make it the one people get ----------------------------
# A draft is invisible to the updater. And GitHub assigns Latest by publish date
# rather than by version number, so this has to be asked for explicitly, or
# re-touching an older release quietly points everybody backwards.
#
# Wrapped, because this is the last step and the files are already up. If the
# label cannot be set the release is still usable and the verification below
# will say what is actually true - failing hard here would report a broken
# publish over a cosmetic problem.
$patch = @{ draft = $false; prerelease = $false; make_latest = 'true' } | ConvertTo-Json
try {
  Invoke-RestMethod -Uri "$api/releases/$($release.id)" -Headers $headers -Method Patch `
    -Body $patch -ContentType 'application/json' | Out-Null
} catch {
  Write-Host '  Could not update the release flags:' -ForegroundColor Yellow
  Write-Host "    $($_.Exception.Message)"
  Write-Host '  If that says already_exists, there is a second release on this tag.'
  Write-Host '  Delete the empty one on GitHub, then run this again.'
}

# ---- read it back ----------------------------------------------------------
# Not optional. Every failure this script exists for reported success.
$check = Invoke-RestMethod -Uri "$api/releases/tags/$tag" -Headers $headers
$names = @($check.assets | ForEach-Object { $_.name })

Write-Host ''
Write-Host "  $tag now has:"
foreach ($n in $names) { Write-Host "    $n" }

$hasExe = $names -contains "Focus-Simulator-Setup-$version.exe"
$hasYml = $names -contains 'latest.yml'

Write-Host ''
if ($hasExe -and $hasYml -and -not $check.draft) {
  Write-Host '  Done. Installed copies will update themselves.' -ForegroundColor Green
  Write-Host ''
} else {
  Write-Host '  Something is still missing:' -ForegroundColor Red
  if (-not $hasExe)  { Write-Host '    the installer' }
  if (-not $hasYml)  { Write-Host '    latest.yml. Without it no installed copy ever updates.' }
  if ($check.draft)  { Write-Host '    it is still a draft, so nothing can see it' }
  Write-Host ''
  exit 1
}
