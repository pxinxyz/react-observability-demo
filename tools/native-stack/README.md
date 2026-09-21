# Native LGTM stack (no Docker)

Runs the same five components as `docker-compose.yml` — OpenTelemetry Collector, **Prometheus**,
Tempo, Loki and Grafana — as bare Windows binaries, so the demo can be verified on a machine where
Docker cannot run at all.

This exists because the machine this project was built on has virtualisation disabled in firmware:
WSL2 refuses to start, so Docker Desktop's Linux engine never comes up, and `docker compose up -d` is
not an option. That left "spans visible in Grafana" as the one unverified claim in the README. This
closes it.

`docker-compose.yml` is still the supported path. Prefer it if you can run Docker.

## Usage

```powershell
cd tools\native-stack
.\fetch.ps1        # ~700 MB of downloads, ~1.5 GB extracted
.\run.ps1          # start; writes only under <repo>\.lgtm-native
.\run.ps1 -Stop    # stop
```

Run these in an interactive PowerShell. `run.ps1` leaves five background processes holding their
console handles, so piping its output into another program will wait for an EOF that never arrives —
the script has finished, but the pipe stays open. Use `-Root <path>` to point at an install somewhere
other than `<repo>\.lgtm-native`.

Then, from the repository root:

```powershell
npm run dev
```

`VITE_OTLP_ENDPOINT` defaults to `http://localhost:4318`, which is this collector's OTLP/HTTP
receiver, so a browser visit lands in Grafana at <http://localhost:3000> (`admin` / `admin`) via
Explore → Tempo.

## Removing it

Nothing is installed system-wide and nothing is registered as a service. The stack only ever writes
under its root directory:

```powershell
.\run.ps1 -Stop
Remove-Item -Recurse -Force ..\..\.lgtm-native
```

If that second command reports `Access is denied` on `gpx_*.exe` files under Grafana's plugin
directories, Grafana's plugin backends are still running. `Stop-Process -Name grafana` kills the
server but not its plugin subprocesses, and they hold their own binaries open. Clear them first:

```powershell
Get-Process | Where-Object Name -like 'gpx_*' | Stop-Process -Force
```

They accumulate one set per Grafana start, so a few restarts leave a few dozen of them.

## Versions

Pinned to match the `grafana/otel-lgtm` image, so this is a faithful stand-in rather than an
approximation:

| Component | Version |
|---|---|
| Grafana | 13.2.2 |
| Prometheus | 3.14.0 |
| Tempo | 3.0.3 |
| Loki | 3.7.8 |
| OpenTelemetry Collector | 0.161.0 |

## Notes for anyone adapting this

Four things cost real time to work out, and each produces a confusing error rather than an obvious
one:

- **`$Args` is a PowerShell automatic variable.** Using it as a function parameter name silently
  truncates the argument list handed to `Start-Process`; the process then starts and reports a
  missing config file. The parameter here is `$ArgList`.
- **Do not copy extracted binaries with a `*.exe` glob.** These archives ship several executables
  (`promtool`, `tempo-cli`, `tempo-query`), and the glob copies whichever sorts last over the one you
  wanted.
- **Prometheus rejects a `storage:` block in `prometheus.yml`** (`field path not found in type
  config.plain`). TSDB path and retention are CLI flags only.
- **Pin Loki's `instance_addr`.** Left to itself it auto-detects a host address — on this machine it
  picked a virtual adapter — and then spends the run logging i/o timeouts trying to reach its own
  ingester.
- **Tempo 3.x rejects unknown config keys outright.** Older examples showing top-level `compactor:`
  or `querier:` blocks fail with `field X not found in type app.Config`; omit them and the defaults
  apply.

The collector config also has to allow CORS for the origins the app is served from. Without that,
every export is dropped by the browser before it is ever sent, and the only symptom is an empty
Grafana.
