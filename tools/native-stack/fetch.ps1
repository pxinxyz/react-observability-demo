# Downloads the LGTM stack as native binaries — no Docker, no daemon, no
# virtualisation. Everything lands under -Root, which is disposable.
#
#   .\fetch.ps1                 download + extract into <repo>\.lgtm-native
#   .\fetch.ps1 -Root D:\lgtm   ...or somewhere else
#
# Roughly 700 MB of downloads, ~1.5 GB once extracted.

param(
  [string]$Root = (Join-Path (Resolve-Path "$PSScriptRoot\..\..") '.lgtm-native')
)

$ErrorActionPreference = 'Stop'
$dl = Join-Path $Root 'downloads'
$bin = Join-Path $Root 'bin'
foreach ($d in @($Root, $dl, $bin)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

# These are the versions inside the grafana/otel-lgtm image at the time of
# writing, so this stack is a faithful stand-in for the container.
$artifacts = @(
  @{ name='otelcol';    exe='otelcol.exe';    url='https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.161.0/otelcol_0.161.0_windows_amd64.tar.gz'; out='otelcol.tar.gz' },
  @{ name='tempo';      exe='tempo.exe';      url='https://github.com/grafana/tempo/releases/download/v3.0.3/tempo_3.0.3_windows_amd64.tar.gz';                                         out='tempo.tar.gz' },
  @{ name='loki';       exe='loki-windows-amd64.exe'; url='https://github.com/grafana/loki/releases/download/v3.7.8/loki-windows-amd64.exe.zip';                                       out='loki.zip' },
  @{ name='prometheus'; exe='prometheus.exe'; url='https://github.com/prometheus/prometheus/releases/download/v3.14.0/prometheus-3.14.0.windows-amd64.zip';                           out='prometheus.zip' },
  @{ name='grafana';    exe=$null;            url='https://dl.grafana.com/oss/release/grafana-13.2.2.windows-amd64.zip';                                                              out='grafana.zip' }
)

foreach ($a in $artifacts) {
  $file = Join-Path $dl $a.out
  if (-not (Test-Path $file)) {
    Write-Host "[get ] $($a.name)"
    Invoke-WebRequest $a.url -OutFile $file -UseBasicParsing -TimeoutSec 1800
  } else {
    Write-Host "[skip] $($a.name) already downloaded"
  }

  $stage = Join-Path $Root "stage-$($a.name)"
  New-Item -ItemType Directory -Force -Path $stage | Out-Null

  if ($a.out.EndsWith('.tar.gz')) {
    tar -xzf $file -C $stage
  } else {
    Expand-Archive -Path $file -DestinationPath $stage -Force
  }

  if ($a.name -eq 'grafana') {
    # Grafana unpacks into a versioned folder; normalise it to <Root>\grafana.
    $target = Join-Path $Root 'grafana'
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    $inner = Get-ChildItem $stage -Directory | Select-Object -First 1
    Move-Item $inner.FullName $target
  } else {
    # Copy by exact name. Do NOT glob *.exe: these archives ship several
    # binaries (promtool, tempo-cli, tempo-query) and a glob silently overwrites
    # the one you wanted with whichever sorts last.
    $found = Get-ChildItem $stage -Recurse -Filter $a.exe | Select-Object -First 1
    if (-not $found) { throw "could not find $($a.exe) in the $($a.name) archive" }
    $short = if ($a.name -eq 'loki') { 'loki.exe' } else { $a.exe }
    Copy-Item $found.FullName (Join-Path $bin $short) -Force
  }
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "installed into $bin"
Get-ChildItem $bin | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize

# Prove each binary is what it claims to be — a cheap guard against the
# wrong-file-copied class of mistake.
Write-Host 'versions:'
foreach ($pair in @(@('otelcol','--version'), @('tempo','--version'), @('loki','--version'), @('prometheus','--version'))) {
  $v = & (Join-Path $bin "$($pair[0]).exe") $pair[1] 2>&1 | Select-Object -First 1
  Write-Host "  $($pair[0]): $v"
}
$gv = & (Join-Path $Root 'grafana\bin\grafana.exe') --version 2>&1 | Select-Object -First 1
Write-Host "  grafana: $gv"
