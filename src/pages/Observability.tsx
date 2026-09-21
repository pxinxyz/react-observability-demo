import { useEffect, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Gauge,
  ScrollText,
  Send,
  Settings2,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react'
import { ProvenanceBanner } from '@/components/ProvenanceBanner'
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  ProvenanceTag,
  StatusDot,
  type Tone,
} from '@/components/ui/primitives'
import { useExportStats, useLogRecords, useMetricCollection } from '@/hooks'
import { useObservabilityStatus } from '@/hooks/useObservabilityStatus'
import { clearTelemetryBuffers, flushTelemetry, recordInteraction } from '@/observability'
import type { FlushReport } from '@/observability'
import { logSeverityTone } from '@/lib/telemetry'
import { cn, formatNumber, formatRelative, formatTimestamp } from '@/lib/utils'
import { useDebounce } from '@/hooks/useDebounce'

/**
 * The page that has to be checkable.
 *
 * Anyone can claim their app "uses OpenTelemetry". This page exists so the claim
 * can be verified without reading the source: here is the resolved endpoint, here
 * is whether the last export succeeded, here is the raw instrument list, here is
 * the log stream, and here is a button that forces a flush so you can go and look
 * in Grafana yourself.
 */
export function ObservabilityPage() {
  const status = useObservabilityStatus()

  useEffect(() => {
    recordInteraction('view-page', 'observability')
  }, [])

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <ProvenanceBanner
          tone="real"
          title="The browser is the observed system"
          body={
            <>
              This tab runs the real OpenTelemetry SDK. It emits OTLP spans, metrics and logs about
              what <em>it</em> is doing — page loads, fetches, clicks, long tasks, Core Web Vitals —
              and exports them over HTTP to whatever endpoint is configured below. Nothing about
              that is simulated.
            </>
          }
        />
        <ProvenanceBanner
          tone="simulated"
          title="The estate in the tables is not"
          body={
            <>
              The service fleet, its latency, its incidents and the Prometheus-style series on the
              Metrics page are fabricated by <code className="font-mono">simulator/</code> and
              served from <code className="font-mono">api/</code>. No production system is
              involved, and the serverless functions are deliberately left uninstrumented.
            </>
          }
        />
      </div>

      <Tabs.Root defaultValue="pipeline" className="flex flex-col gap-4">
        <Tabs.List
          aria-label="Observability detail"
          className="inline-flex w-fit items-center gap-1 rounded-lg border border-edge bg-panel/70 p-1"
        >
          {(
            [
              ['pipeline', 'Pipeline', Send],
              ['config', 'Configuration', Settings2],
              ['logs', 'Log stream', ScrollText],
              ['setup', 'Run it yourself', Terminal],
            ] as const
          ).map(([value, label, Icon]) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium transition-colors',
                'text-subtle hover:text-muted',
                'data-[state=active]:bg-raised data-[state=active]:text-ink',
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="pipeline" className="focus:outline-none">
          <PipelinePanel />
        </Tabs.Content>

        <Tabs.Content value="config" className="focus:outline-none">
          <ConfigPanel status={status} />
        </Tabs.Content>

        <Tabs.Content value="logs" className="focus:outline-none">
          <LogStreamPanel />
        </Tabs.Content>

        <Tabs.Content value="setup" className="focus:outline-none">
          <SetupPanel status={status} />
        </Tabs.Content>
      </Tabs.Root>
    </>
  )
}

/* ── Pipeline health ─────────────────────────────────────────────────────── */

function PipelinePanel() {
  const stats = useExportStats()
  const metrics = useMetricCollection()
  const status = useObservabilityStatus()
  const [flushing, setFlushing] = useState(false)
  const [lastFlush, setLastFlush] = useState<FlushReport | null>(null)

  const failingRecently =
    stats.lastFailureAt !== null &&
    (stats.lastSuccessAt === null || stats.lastFailureAt > stats.lastSuccessAt)

  const health: { tone: Tone; label: string; detail: string } = !status.configured
    ? {
        tone: 'neutral',
        label: 'Export disabled',
        detail:
          'VITE_OTLP_ENDPOINT is empty, so no exporters were constructed. Everything else on this page still works — the SDK is recording, the UI is reading, and nothing is leaving the browser.',
      }
    : failingRecently
      ? {
          tone: 'crit',
          label: 'Export failing',
          detail:
            'The most recent export attempt failed. The usual causes are the collector not running, a wrong URL, or CORS rejecting the request.',
        }
      : stats.lastSuccessAt
        ? {
            tone: 'ok',
            label: 'Exporting',
            detail: 'Batches are being accepted by the OTLP endpoint.',
          }
        : {
            tone: 'warn',
            label: 'Awaiting first export',
            detail:
              'Configured and waiting. BatchSpanProcessor ships a couple of seconds after the first span ends.',
          }

  async function handleFlush() {
    setFlushing(true)
    try {
      const report = await flushTelemetry()
      setLastFlush(report)
    } finally {
      setFlushing(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel className="overflow-hidden">
        <PanelHeader
          icon={Send}
          title="OTLP export pipeline"
          subtitle="Every batch the SDK has attempted to ship, and whether it landed."
          actions={
            <>
              <ProvenanceTag kind="real" />
              <Button size="sm" variant="solid" onClick={() => void handleFlush()} disabled={flushing}>
                <Send className={cn('size-3', flushing && 'animate-pulse')} aria-hidden />
                {flushing ? 'Flushing…' : 'Force flush'}
              </Button>
              <Button size="sm" variant="outline" onClick={clearTelemetryBuffers}>
                <Trash2 className="size-3" aria-hidden />
                Clear buffers
              </Button>
            </>
          }
        />

        <div
          className={cn(
            'flex items-start gap-2.5 border-b border-edge px-4 py-3',
            health.tone === 'ok' && 'bg-ok/5',
            health.tone === 'warn' && 'bg-warn/5',
            health.tone === 'crit' && 'bg-crit/5',
          )}
        >
          <StatusDot tone={health.tone} pulse={health.tone === 'ok'} className="mt-1.5" />
          <div>
            <p
              className={cn(
                'text-sm font-medium',
                health.tone === 'ok' && 'text-ok',
                health.tone === 'warn' && 'text-warn',
                health.tone === 'crit' && 'text-crit',
                health.tone === 'neutral' && 'text-muted',
              )}
            >
              {health.label}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-subtle">{health.detail}</p>
          </div>
        </div>

        <div className="grid gap-px bg-edge sm:grid-cols-2 lg:grid-cols-4">
          <Cell label="Successful batches" value={formatNumber(stats.succeeded)} tone="ok" />
          <Cell
            label="Failed batches"
            value={formatNumber(stats.failed)}
            tone={stats.failed > 0 ? 'crit' : 'neutral'}
          />
          <Cell label="Items exported" value={formatNumber(stats.itemsExported)} />
          <Cell
            label="Last success"
            value={stats.lastSuccessAt ? formatRelative(stats.lastSuccessAt) : 'never'}
            tone={stats.lastSuccessAt ? 'neutral' : 'warn'}
          />
        </div>

        {stats.lastError ? (
          <div className="border-t border-edge bg-crit/5 px-4 py-2.5">
            <p className="flex items-start gap-2 font-mono text-xs leading-relaxed text-crit">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
              {stats.lastError}
            </p>
          </div>
        ) : null}

        {lastFlush ? (
          <div className="border-t border-edge px-4 py-2.5">
            <p className="text-xs text-subtle">
              Last manual flush:{' '}
              {lastFlush.timedOut ? (
                <span className="text-warn">timed out before every provider finished</span>
              ) : (
                <span className="font-mono text-muted">
                  traces {lastFlush.traces ? '✓' : '✗'} · metrics {lastFlush.metrics ? '✓' : '✗'} ·
                  logs {lastFlush.logs ? '✓' : '✗'}
                </span>
              )}
            </p>
          </div>
        ) : null}

        {metrics.errors.length > 0 ? (
          <div className="border-t border-edge bg-warn/5 px-4 py-2.5">
            <p className="text-xs text-warn">
              Metric collection reported {metrics.errors.length} non-fatal error
              {metrics.errors.length === 1 ? '' : 's'}: {metrics.errors.join('; ')}
            </p>
          </div>
        ) : null}
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader
          icon={Gauge}
          title="Recent export attempts"
          subtitle={`The last ${stats.attempts.length} batches, newest first.`}
          actions={<ProvenanceTag kind="real" />}
        />
        {stats.attempts.length === 0 ? (
          <EmptyState
            icon={Send}
            title="No export attempts yet"
            description={
              status.configured
                ? 'Interact with the app. The first batch ships a couple of seconds after the first span ends.'
                : 'Set VITE_OTLP_ENDPOINT and restart the dev server to enable exporting.'
            }
          />
        ) : (
          <ul className="scroll-thin max-h-72 divide-y divide-[var(--color-edge)] overflow-auto">
            {[...stats.attempts].reverse().map((attempt, index) => (
              <li
                key={`${attempt.at}-${index}`}
                className="flex items-center justify-between gap-3 px-4 py-1.5"
              >
                <span className="flex items-center gap-2">
                  {attempt.ok ? (
                    <CheckCircle2 className="size-3.5 text-ok" aria-hidden />
                  ) : (
                    <XCircle className="size-3.5 text-crit" aria-hidden />
                  )}
                  <Badge tone={attempt.ok ? 'ok' : 'crit'} mono>
                    {attempt.signal}
                  </Badge>
                  <span className="tnum font-mono text-2xs text-subtle">
                    {attempt.itemCount} item{attempt.itemCount === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  {attempt.error ? (
                    <span className="truncate font-mono text-2xs text-crit" title={attempt.error}>
                      {attempt.error}
                    </span>
                  ) : null}
                  <span className="tnum shrink-0 font-mono text-2xs text-subtle">
                    {formatTimestamp(attempt.at)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function Cell({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: Tone }) {
  const tones: Record<Tone, string> = {
    neutral: 'text-ink',
    ok: 'text-ok',
    warn: 'text-warn',
    crit: 'text-crit',
    accent: 'text-accent',
    info: 'text-info',
  }
  return (
    <div className="bg-panel px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wider text-subtle">{label}</div>
      <div className={cn('tnum mt-1 text-lg font-semibold', tones[tone])}>{value}</div>
    </div>
  )
}

/* ── Configuration ───────────────────────────────────────────────────────── */

function ConfigPanel({ status }: { status: ReturnType<typeof useObservabilityStatus> }) {
  return (
    <div className="flex flex-col gap-4">
      <Panel className="overflow-hidden">
        <PanelHeader
          icon={Settings2}
          title="Resolved configuration"
          subtitle="What the SDK was actually constructed with, read back at runtime."
          actions={<ProvenanceTag kind="real" />}
        />
        <dl className="divide-y divide-[var(--color-edge)]">
          <Row label="VITE_OTLP_ENDPOINT" value={status.baseEndpoint ?? '(not set)'} mono />
          <Row label="Traces" value={status.endpoints.traces ?? '—'} mono />
          <Row label="Metrics" value={status.endpoints.metrics ?? '—'} mono />
          <Row label="Logs" value={status.endpoints.logs ?? '—'} mono />
          <Row label="service.name" value={status.serviceName} mono />
          <Row label="service.version" value={status.serviceVersion} mono />
          <Row label="deployment.environment.name" value={status.environment} mono />
          <Row label="Trace sample rate" value={`${status.sampleRate} (ParentBased + TraceIdRatio)`} />
          <Row
            label="Metric export interval"
            value={`${formatNumber(status.metricExportIntervalMs)}ms`}
          />
          <Row
            label="Initialised"
            value={`${formatTimestamp(status.startedAt)} (${formatRelative(status.startedAt)})`}
          />
          <Row label="Exporter instrumentation" value="disabled — export requests are never traced" />
        </dl>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader
          icon={Gauge}
          title="Registered instrumentations"
          subtitle={`${status.instrumentations.length} automatic instrumentations patched into this page.`}
          actions={<ProvenanceTag kind="real" />}
        />
        {status.instrumentations.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title="No instrumentations registered"
            description="Automatic instrumentation is registered in src/observability/tracing.ts."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-edge)]">
            {status.instrumentations.map((name) => (
              <li key={name} className="flex items-center gap-2 px-4 py-2">
                <CheckCircle2 className="size-3.5 text-ok" aria-hidden />
                <code className="font-mono text-xs text-muted">{name}</code>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader
          icon={Gauge}
          title="Why there is no zone.js"
          subtitle="A deliberate tradeoff, documented rather than hidden."
        />
        <div className="px-4 py-3">
          <p className="text-xs leading-relaxed text-subtle">
            The SDK is configured with the default <code className="font-mono">StackContextManager</code>{' '}
            rather than <code className="font-mono">ZoneContextManager</code>. zone.js would carry
            context across <code className="font-mono">await</code> boundaries, but it patches
            Promise, timers and every event target in the page — a heavy and invasive dependency for
            a demo. Instead, <code className="font-mono">withSpan</code> in{' '}
            <code className="font-mono">src/observability/tracing.ts</code> invokes{' '}
            <code className="font-mono">fetch</code> before its first{' '}
            <code className="font-mono">await</code>, so the fetch instrumentation always sees the
            active span and nests correctly. The cost is that context does not survive a stray{' '}
            <code className="font-mono">await</code> in the middle of a span; the benefit is not
            shipping a library that rewrites the browser's event loop.
          </p>
        </div>
      </Panel>
    </div>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard may be unavailable; the value is on screen regardless.
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2">
      <dt className="shrink-0 font-mono text-xs text-subtle">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span
          className={cn('truncate text-xs text-muted', mono && 'font-mono')}
          title={value}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          title="Copy"
          className="shrink-0 rounded p-0.5 text-subtle transition-colors hover:bg-raised hover:text-muted"
        >
          {copied ? (
            <CheckCircle2 className="size-3 text-ok" aria-hidden />
          ) : (
            <Copy className="size-3" aria-hidden />
          )}
        </button>
      </dd>
    </div>
  )
}

/* ── Log stream ──────────────────────────────────────────────────────────── */

function LogStreamPanel() {
  const records = useLogRecords()
  const [rawFilter, setRawFilter] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const filter = useDebounce(rawFilter, 200)

  const filtered = records.filter((record) => {
    if (errorsOnly && record.severityNumber < 13) return false
    if (!filter.trim()) return true
    const needle = filter.trim().toLowerCase()
    return (
      record.body.toLowerCase().includes(needle) ||
      record.severityText.toLowerCase().includes(needle) ||
      Object.entries(record.attributes).some(
        ([key, value]) =>
          key.toLowerCase().includes(needle) || String(value).toLowerCase().includes(needle),
      )
    )
  })

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        icon={ScrollText}
        title="Log stream"
        subtitle="Emitted through the OTel Logs SDK. Records inside an active span carry its trace and span ids."
        actions={
          <>
            <ProvenanceTag kind="real" />
            <Button
              size="sm"
              variant={errorsOnly ? 'solid' : 'outline'}
              onClick={() => setErrorsOnly((current) => !current)}
            >
              WARN+
            </Button>
            <input
              value={rawFilter}
              onChange={(event) => setRawFilter(event.target.value)}
              placeholder="Filter…"
              aria-label="Filter log records"
              className="w-32 rounded border border-edge bg-canvas/60 px-2 py-1 text-sm text-ink placeholder:text-subtle focus:border-accent/50 focus:outline-none"
            />
            <Button size="sm" variant="outline" onClick={clearTelemetryBuffers}>
              <Trash2 className="size-3" aria-hidden />
              Clear
            </Button>
          </>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={records.length === 0 ? 'No log records yet' : 'Nothing matches that filter'}
          description={
            records.length === 0
              ? 'Interact with the app. API calls, scenario switches and page views all emit records through the logger in src/observability/logger.ts.'
              : 'Adjust or clear the filter to see the rest of the buffer.'
          }
        />
      ) : (
        <ul className="scroll-thin max-h-[32rem] divide-y divide-[var(--color-edge)] overflow-auto">
          {filtered.map((record, index) => {
            const tone = logSeverityTone(record.severityText)
            return (
              <li key={`${record.timeMs}-${index}`} className="px-4 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tnum font-mono text-2xs text-subtle">
                    {new Date(record.timeMs).toLocaleTimeString('en-US', { hour12: false })}
                  </span>
                  <Badge tone={tone} mono>
                    {record.severityText}
                  </Badge>
                  {record.traceId ? (
                    <span
                      className="truncate font-mono text-2xs text-accent"
                      title={`trace ${record.traceId} span ${record.spanId}`}
                    >
                      {record.traceId.slice(0, 16)}/{record.spanId?.slice(0, 8)}
                    </span>
                  ) : (
                    <span className="font-mono text-2xs text-subtle">no active span</span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted">{record.body}</p>
                {Object.keys(record.attributes).length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {Object.entries(record.attributes).map(([key, value]) => (
                      <span key={key} className="font-mono text-2xs text-subtle">
                        {key}=<span className="text-muted">{String(value)}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/* ── Setup ───────────────────────────────────────────────────────────────── */

function SetupPanel({ status }: { status: ReturnType<typeof useObservabilityStatus> }) {
  const grafana = status.grafanaUrl ?? 'http://localhost:3000'

  return (
    <div className="flex flex-col gap-4">
      <Panel className="overflow-hidden">
        <PanelHeader
          icon={Terminal}
          title="Verify this yourself"
          subtitle="Three commands, then look in Grafana. Nothing here is a mock."
          actions={<ProvenanceTag kind="real" />}
        />
        <ol className="divide-y divide-[var(--color-edge)]">
          <Step
            index={1}
            title="Start the OpenTelemetry backend"
            body="Bundles the OpenTelemetry Collector, Prometheus (metrics), Tempo (traces), Loki (logs), Pyroscope (profiles) and Grafana in one container."
            command="docker compose up -d"
          />
          <Step
            index={2}
            title="Point the app at it and start the dev server"
            body="VITE_OTLP_ENDPOINT is the whole integration. It defaults to the local collector on port 4318."
            command="npm run dev"
          />
          <Step
            index={3}
            title="Generate a trace, then go and find it"
            body={`Click around the app. Force a flush from the Pipeline tab if you are impatient, then open Grafana and use Explore → Tempo, searching by service.name = "${status.serviceName}".`}
            command={`open ${grafana}/explore`}
          />
        </ol>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader
          icon={ExternalLink}
          title="What to look for"
          subtitle="Concrete queries, so this is checkable rather than a claim."
        />
        <div className="flex flex-col divide-y divide-[var(--color-edge)]">
          <Query
            signal="Traces · Tempo"
            body="Explore → Tempo → Search. Filter by service.name. You should see documentLoad, HTTP GET /api/services, click spans and scenario.switch, each with a real trace id."
            expression={`{ resource.service.name = "${status.serviceName}" }`}
          />
          <Query
            signal="Metrics · Prometheus"
            body="Explore → Prometheus. These instruments are recorded by this browser and exported over OTLP. Note that the metrics backend is Prometheus, not Mimir — the grafana/otel-lgtm image ships Prometheus."
            expression='app_api_client_duration_milliseconds_count'
          />
          <Query
            signal="Logs · Loki"
            body="Explore → Loki. Every API call and scenario switch emits a record, and records emitted inside a span carry that span's trace id for correlation."
            expression={`{ service_name = "${status.serviceName}" }`}
          />
          <Query
            signal="Web vitals · Prometheus"
            body="Real Core Web Vitals, measured by the browser and recorded as OTel histograms. These are the least arguable numbers in the project."
            expression="browser_web_vitals_lcp_milliseconds_bucket"
          />
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader
          icon={Download}
          title="Pointing at Grafana Cloud instead"
          subtitle="Same code, different endpoint. No rebuild of anything but the env var."
        />
        <div className="px-4 py-3">
          <pre className="scroll-thin overflow-x-auto rounded border border-edge bg-canvas/60 p-3 font-mono text-xs leading-relaxed text-muted">
{`VITE_OTLP_ENDPOINT=https://otlp-gateway-<zone>.grafana.net/otlp
VITE_OTLP_HEADERS=Authorization=Basic <base64(instanceId:token)>
VITE_GRAFANA_URL=https://<your-stack>.grafana.net`}
          </pre>
          <p className="mt-3 text-xs leading-relaxed text-warn">
            Anything in a <code className="font-mono">VITE_*</code> variable is compiled into the
            browser bundle and readable by anyone who loads the page. Use a write-only,
            ingest-scoped token and nothing else. This is why the hosted demo runs with exporting
            off unless a disposable token is supplied.
          </p>
        </div>
      </Panel>
    </div>
  )
}

function Step({
  index,
  title,
  body,
  command,
}: {
  index: number
  title: string
  body: string
  command: string
}) {
  const [copied, setCopied] = useState(false)

  return (
    <li className="flex gap-3 px-4 py-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-edge-strong bg-raised font-mono text-2xs text-muted">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-subtle">{body}</p>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(command).then(
              () => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              },
              () => undefined,
            )
          }}
          className="mt-2 inline-flex items-center gap-2 rounded border border-edge bg-canvas/60 px-2 py-1 font-mono text-xs text-muted transition-colors hover:border-accent/40 hover:text-ink"
        >
          <span className="text-subtle">$</span>
          {command}
          {copied ? (
            <CheckCircle2 className="size-3 text-ok" aria-hidden />
          ) : (
            <Copy className="size-3 text-subtle" aria-hidden />
          )}
        </button>
      </div>
    </li>
  )
}

function Query({
  signal,
  body,
  expression,
}: {
  signal: string
  body: string
  expression: string
}) {
  return (
    <div className="px-4 py-3">
      <Badge tone="accent">{signal}</Badge>
      <p className="mt-1.5 text-xs leading-relaxed text-subtle">{body}</p>
      <code className="mt-2 block overflow-x-auto rounded border border-edge bg-canvas/60 px-2 py-1.5 font-mono text-xs text-muted">
        {expression}
      </code>
    </div>
  )
}
