# Starts the LGTM stack as native Windows processes, writing only underneath
# -Root. Deleting that directory removes every trace of it.
#
#   .\run.ps1                 start
#   .\run.ps1 -Stop           stop
#   .\run.ps1 -Root D:\lgtm   use a root other than <repo>\.lgtm-native
#
# Run .\fetch.ps1 first.
#
# Ports: 3000 Grafana (admin/admin) · 4317+4318 OTLP · 3200 Tempo · 9090
#        Prometheus · 3100 Loki · 4320 Tempo OTLP receive · 9096 Tempo gRPC
#
# Config templates live in .\config with a __ROOT__ placeholder, which is
# substituted here into <Root>\config so the stack can live anywhere.

param(
  [switch]$Stop,
  [string]$Root = (Join-Path (Resolve-Path "$PSScriptRoot\..\..") '.lgtm-native')
)

$ErrorActionPreference = 'Stop'
$here  = $PSScriptRoot
$bin   = Join-Path $Root 'bin'
$cfgIn = Join-Path $here 'config'
$cfg   = Join-Path $Root 'config'
$log   = Join-Path $Root 'logs'
$data  = Join-Path $Root 'data'
$groot = Join-Path $Root 'grafana'

if (-not (Test-Path (Join-Path $bin 'otelcol.exe'))) {
  throw "no binaries in $bin — run .\fetch.ps1 first"
}

New-Item -ItemType Directory -Force -Path $log, $data, $cfg, (Join-Path $data 'grafana\plugins') | Out-Null

$names = @('otelcol', 'tempo', 'loki', 'prometheus', 'grafana')
foreach ($n in $names) { Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 800

if ($Stop) { Write-Host 'stopped.'; return }

# Resolve __ROOT__ into the runtime config copies.
$rootForYaml = $Root.Replace('\', '/')
foreach ($f in @('tempo.yaml', 'loki.yaml')) {
  (Get-Content (Join-Path $cfgIn $f) -Raw).Replace('__ROOT__', $rootForYaml) |
    Set-Content (Join-Path $cfg $f) -NoNewline
}
Copy-Item (Join-Path $cfgIn 'prometheus.yml') (Join-Path $cfg 'prometheus.yml') -Force
Copy-Item (Join-Path $cfgIn 'otelcol.yaml')   (Join-Path $cfg 'otelcol.yaml')   -Force

# Grafana's provisioning path is fixed relative to --homepath, so the datasource
# file has to be copied into the extracted tree.
$provDir = Join-Path $groot 'conf\provisioning\datasources'
New-Item -ItemType Directory -Force -Path $provDir | Out-Null
Copy-Item (Join-Path $cfgIn 'grafana-datasources.yaml') (Join-Path $provDir 'lgtm.yaml') -Force

# NOTE: the parameter is $ArgList, not $Args. $Args is a PowerShell automatic
# variable; shadowing it silently truncates the command line handed to
# Start-Process, which surfaces as a baffling "config file not found".
function Start-StackProcess {
  param([string]$Name, [string]$Exe, [string[]]$ArgList, [string]$WorkDir)
  $p = Start-Process -FilePath $Exe -ArgumentList $ArgList -WorkingDirectory $WorkDir `
       -RedirectStandardOutput (Join-Path $log "$Name.out.log") `
       -RedirectStandardError  (Join-Path $log "$Name.err.log") `
       -PassThru -WindowStyle Hidden
  Write-Host ("  {0,-11} pid {1}" -f $Name, $p.Id)
}

Write-Host 'starting...'
Start-StackProcess 'otelcol'    "$bin\otelcol.exe"    @("--config=$cfg\otelcol.yaml") -WorkDir $bin
Start-StackProcess 'tempo'      "$bin\tempo.exe"      @("-config.file=$cfg\tempo.yaml") -WorkDir $bin
Start-StackProcess 'loki'       "$bin\loki.exe"       @("-config.file=$cfg\loki.yaml") -WorkDir $bin
Start-StackProcess 'prometheus' "$bin\prometheus.exe" @(
  "--config.file=$cfg\prometheus.yml",
  # Prometheus takes storage config as CLI flags only; putting `storage:` in
  # prometheus.yml fails with "field path not found in type config.plain".
  "--storage.tsdb.path=$rootForYaml/data/prometheus",
  '--storage.tsdb.retention.time=2h',
  '--web.enable-otlp-receiver',
  '--web.listen-address=127.0.0.1:9090',
  '--log.level=warn'
) -WorkDir $bin

$env:GF_PATHS_DATA = Join-Path $data 'grafana'
$env:GF_PATHS_LOGS = $log
$env:GF_PATHS_PLUGINS = Join-Path $data 'grafana\plugins'
$env:GF_PATHS_PROVISIONING = Join-Path $groot 'conf\provisioning'
$env:GF_SECURITY_ADMIN_USER = 'admin'
$env:GF_SECURITY_ADMIN_PASSWORD = 'admin'
$env:GF_ANALYTICS_REPORTING_ENABLED = 'false'
$env:GF_ANALYTICS_CHECK_FOR_UPDATES = 'false'
$env:GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES = 'false'
$env:GF_NEWS_NEWS_FEED_ENABLED = 'false'
$env:GF_LOG_LEVEL = 'warn'
$env:GF_SERVER_HTTP_PORT = '3000'
Start-StackProcess 'grafana' "$groot\bin\grafana.exe" @('server', "--homepath=$groot") -WorkDir $groot

# One short settle, then a single quick probe of each. Deliberately no retry
# loops: waiting does not fix a bad config, and the logs say so immediately.
Start-Sleep -Seconds 12

Write-Host ''
Write-Host 'status:'
function Probe {
  param([string]$Name, [string]$Url, [string]$Port)
  $alive = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  $code = '-'
  try { $code = (Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 3 -SkipHttpErrorCheck).StatusCode } catch { $code = 'no reply' }
  Write-Host ("  {0} {1,-11} :{2,-5} http {3}" -f $(if ($alive) { 'ok  ' } else { 'DOWN' }), $Name, $Port, $code)
}
Probe 'Tempo'      'http://127.0.0.1:3200/ready'      3200
Probe 'Loki'       'http://127.0.0.1:3100/ready'      3100
Probe 'Prometheus' 'http://127.0.0.1:9090/-/ready'    9090
Probe 'Collector'  'http://127.0.0.1:4318/v1/traces'  4318
Probe 'Grafana'    'http://127.0.0.1:3000/api/health' 3000

Write-Host ''
Write-Host 'Grafana  http://localhost:3000   admin / admin'
Write-Host 'Stop with .\run.ps1 -Stop; delete the whole thing with Remove-Item -Recurse -Force'
