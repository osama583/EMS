<#
.SYNOPSIS
Assembles the FYP demonstration video from recorded segments, checks it against the
submission rules, and writes it out under the required file name.

.DESCRIPTION
Concatenates every clip in -SegmentDir in filename order (so name them 00-, 01-, 02-
and so on), or takes a single already-recorded file with -SingleFile. It then
verifies the duration falls inside the 3 to 5 minute window and the file is under
1000 MB, re-encoding once if it is not.

.EXAMPLE
pwsh -File docs/demo-video/build-video.ps1

.EXAMPLE
pwsh -File docs/demo-video/build-video.ps1 -SingleFile "$HOME\Downloads\teams-recording.mp4"
#>
[CmdletBinding()]
param(
    [string] $SegmentDir  = (Join-Path $PSScriptRoot 'segments'),
    [string] $SingleFile,
    [string] $OutDir      = (Join-Path $HOME 'Desktop'),
    [string] $BaseName    = 'Osamah Ahmed Mohammed Al-Naggar-TP078781-APD3F2601CS-Video',
    [int]    $MaxSizeMB   = 1000,
    [int]    $MinSeconds  = 180,
    [int]    $MaxSeconds  = 300,
    [switch] $Force
)

$ErrorActionPreference = 'Stop'

function Require-Tool([string] $name) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $cmd) { throw "$name is not on PATH. Install it with: winget install Gyan.FFmpeg" }
    return $cmd.Source
}

function Get-DurationSeconds([string] $path) {
    $raw = & ffprobe -v error -show_entries format=duration -of csv=p=0 -- "$path"
    if ($LASTEXITCODE -ne 0 -or -not $raw) { throw "ffprobe could not read a duration from $path" }
    return [double] $raw
}

function Format-Timecode([double] $seconds) {
    return [TimeSpan]::FromSeconds($seconds).ToString('mm\:ss')
}

Require-Tool ffmpeg  | Out-Null
Require-Tool ffprobe | Out-Null

$output = Join-Path $OutDir "$BaseName.mp4"
if ((Test-Path -LiteralPath $output) -and -not $Force) {
    throw "$output already exists. Re-run with -Force to overwrite it."
}
if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}

# --- 1. Produce a single MP4 -------------------------------------------------

if ($SingleFile) {
    if (-not (Test-Path -LiteralPath $SingleFile)) { throw "No such file: $SingleFile" }
    Write-Host "Source: one file, $SingleFile"
    Copy-Item -LiteralPath $SingleFile -Destination $output -Force
}
else {
    if (-not (Test-Path -LiteralPath $SegmentDir)) {
        throw "No segment directory at $SegmentDir. Record the segments there as 00-title.mp4, 01-public.mp4 and so on, or pass -SingleFile."
    }

    $segments = Get-ChildItem -LiteralPath $SegmentDir -File |
                Where-Object { $_.Extension -in '.mp4', '.mkv', '.mov' } |
                Sort-Object Name

    if ($segments.Count -eq 0) { throw "No .mp4, .mkv or .mov files in $SegmentDir" }

    Write-Host "Source: $($segments.Count) segment(s) in $SegmentDir"
    foreach ($s in $segments) {
        $d = Get-DurationSeconds $s.FullName
        '  {0,-28} {1}' -f $s.Name, (Format-Timecode $d) | Write-Host
    }

    # ffmpeg's concat demuxer: one 'file' line per segment, single quotes escaped.
    $listPath = Join-Path ([System.IO.Path]::GetTempPath()) ("fyp-concat-{0}.txt" -f ([guid]::NewGuid()))
    $lines = $segments | ForEach-Object { "file '" + ($_.FullName -replace "'", "'\''") + "'" }
    Set-Content -LiteralPath $listPath -Value $lines -Encoding UTF8

    try {
        # Stream copy first: instant, and lossless when every segment came out of
        # the same recorder with the same settings.
        & ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i "$listPath" -c copy -movflags +faststart -- "$output"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Stream copy failed (segments differ in codec or resolution). Re-encoding."
            $inputs = @(); foreach ($s in $segments) { $inputs += @('-i', $s.FullName) }
            $filter = (0..($segments.Count - 1) | ForEach-Object { "[$_`:v:0][$_`:a:0]" }) -join ''
            $filter += "concat=n=$($segments.Count):v=1:a=1[v][a]"
            & ffmpeg -hide_banner -loglevel error -y @inputs -filter_complex $filter -map '[v]' -map '[a]' `
                     -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k -movflags +faststart -- "$output"
            if ($LASTEXITCODE -ne 0) { throw 'ffmpeg could not concatenate the segments.' }
        }
    }
    finally {
        Remove-Item -LiteralPath $listPath -ErrorAction SilentlyContinue
    }
}

# --- 2. Check it against the submission rules --------------------------------

$duration = Get-DurationSeconds $output
$sizeMB   = [math]::Round((Get-Item -LiteralPath $output).Length / 1MB, 1)

if ($sizeMB -gt $MaxSizeMB) {
    Write-Host "$sizeMB MB is over the $MaxSizeMB MB cap. Re-encoding once at CRF 26."
    $tmp = [System.IO.Path]::ChangeExtension($output, '.shrink.mp4')
    & ffmpeg -hide_banner -loglevel error -y -i "$output" `
             -c:v libx264 -preset slow -crf 26 -vf 'scale=1920:-2' `
             -c:a aac -b:a 128k -movflags +faststart -- "$tmp"
    if ($LASTEXITCODE -ne 0) { throw 'Re-encode failed.' }
    Move-Item -LiteralPath $tmp -Destination $output -Force
    $sizeMB = [math]::Round((Get-Item -LiteralPath $output).Length / 1MB, 1)
}

$problems = @()
if ($duration -lt $MinSeconds) { $problems += "Too short: $(Format-Timecode $duration), the brief wants at least $(Format-Timecode $MinSeconds)." }
if ($duration -gt $MaxSeconds) { $problems += "Too long: $(Format-Timecode $duration), the brief caps it at $(Format-Timecode $MaxSeconds)." }
if ($sizeMB -gt $MaxSizeMB)    { $problems += "Still $sizeMB MB after re-encoding, over the $MaxSizeMB MB cap." }

Write-Host ''
Write-Host "  File     $output"
Write-Host "  Duration $(Format-Timecode $duration)"
Write-Host "  Size     $sizeMB MB"

if ($problems.Count -gt 0) {
    Write-Host ''
    $problems | ForEach-Object { Write-Host "  ! $_" }
    exit 1
}

Write-Host ''
Write-Host '  Within 3-5 minutes and under the size cap. Ready to submit.'
exit 0
