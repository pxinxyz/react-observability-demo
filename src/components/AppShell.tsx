import { NavLink, Outlet } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Gauge,
  LayoutDashboard,
  Radio,
  Siren,
  Telescope,
  XCircle,
} from 'lucide-react'
import { Badge, StatusDot } from '@/components/ui/primitives'
import { ScenarioPicker } from '@/components/ScenarioPicker'
import { useObservabilityStatus } from '@/hooks/useObservabilityStatus'
import { useExportStats } from '@/hooks/useTelemetryStore'
import { useSummary } from '@/hooks/useServices'
import { cn, formatCompact, formatDuration, formatPercent, formatRelative } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/traces', label: 'Traces', icon: Telescope, end: false },
  { to: '/metrics', label: 'Metrics', icon: BarChart3, end: false },
  { to: '/incidents', label: 'Incidents', icon: Siren, end: false },
  { to: '/observability', label: 'Observability', icon: Gauge, end: false },
]

export function AppShell() {
  const status = useObservabilityStatus()
  const exports = useExportStats()
  const summary = useSummary()

  const exportHealthy = exports.lastSuccessAt !== null && exports.failed === 0
  const exportBroken = exports.failed > 0 && (exports.lastSuccessAt === null || exports.lastFailureAt !== null && exports.lastFailureAt > exports.lastSuccessAt)

  return (
    <div className="app-backdrop flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-edge bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-7 shrink-0 items-center justify-center rounded border border-accent/30 bg-accent/10">
              <Radio className="size-4 text-accent" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold leading-tight tracking-tight text-ink">
                React Observability Demo
              </h1>
              <p className="truncate text-[11px] leading-tight text-subtle">
                The browser is the observed system
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <OtlpStatusBadge
              configured={status.configured}
              exportHealthy={exportHealthy}
              exportBroken={exportBroken}
              lastSuccessAt={exports.lastSuccessAt}
              endpoint={status.baseEndpoint}
            />
            {status.grafanaUrl ? (
              <a
                href={status.grafanaUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded border border-edge-strong px-2 py-1 text-[11px] text-muted transition-colors hover:border-accent/50 hover:text-ink"
              >
                Grafana
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
            <ScenarioPicker />
          </div>
        </div>

        <nav className="mx-auto max-w-[1600px] px-4 sm:px-6">
          <ul className="scroll-thin -mb-px flex gap-1 overflow-x-auto">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                      isActive
                        ? 'border-accent text-ink'
                        : 'border-transparent text-subtle hover:border-edge-strong hover:text-muted',
                    )
                  }
                >
                  <item.icon className="size-3.5" aria-hidden />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <SummaryStrip summary={summary} />

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-4 sm:px-6">
        <Outlet />
      </main>

      <footer className="border-t border-edge px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 text-[11px] text-subtle">
          <p>
            Span, metric and log data about this page is real OpenTelemetry. The service estate
            shown in the tables is simulated — see the{' '}
            <NavLink to="/observability" className="text-muted underline decoration-dotted">
              Observability
            </NavLink>{' '}
            page.
          </p>
          <p className="font-mono">
            {status.serviceName} v{status.serviceVersion} · {status.environment}
          </p>
        </div>
      </footer>
    </div>
  )
}

function OtlpStatusBadge({
  configured,
  exportHealthy,
  exportBroken,
  lastSuccessAt,
  endpoint,
}: {
  configured: boolean
  exportHealthy: boolean
  exportBroken: boolean
  lastSuccessAt: number | null
  endpoint: string | null
}) {
  if (!configured) {
    return (
      <span
        title="VITE_OTLP_ENDPOINT is not set. The app runs, but exports nothing."
        className="inline-flex items-center gap-1.5 rounded border border-edge-strong bg-raised px-2 py-1 text-[11px] text-subtle"
      >
        <StatusDot tone="neutral" />
        OTLP off
      </span>
    )
  }

  const tone = exportBroken ? 'crit' : exportHealthy ? 'ok' : 'warn'
  const label = exportBroken
    ? 'export failing'
    : lastSuccessAt
      ? `exported ${formatRelative(lastSuccessAt)}`
      : 'awaiting export'

  const details = {
    ok: 'Spans and metrics are reaching the OTLP endpoint.',
    warn: 'Configured, but nothing has been exported yet. The first batch ships a couple of seconds after the first span ends.',
    crit: 'The most recent export attempt failed. The collector is probably not running, or CORS is blocking the request.',
  }[tone]

  return (
    <span
      title={`${endpoint}\n\n${details}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px]',
        tone === 'ok' && 'border-ok/30 bg-ok/10 text-ok',
        tone === 'warn' && 'border-warn/30 bg-warn/10 text-warn',
        tone === 'crit' && 'border-crit/30 bg-crit/10 text-crit',
      )}
    >
      <StatusDot tone={tone} pulse={tone === 'ok'} />
      {label}
    </span>
  )
}

function SummaryStrip({ summary }: { summary: ReturnType<typeof useSummary> }) {
  if (!summary) {
    return (
      <div className="border-b border-edge bg-panel/40">
        <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-4 py-2 text-[11px] text-subtle sm:px-6">
          <Activity className="size-3.5 animate-pulse" aria-hidden />
          Loading estate…
        </div>
      </div>
    )
  }

  const { services, traffic, incidents } = summary

  return (
    <div className="border-b border-edge bg-panel/40">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2 sm:px-6">
        <Tile
          icon={CheckCircle2}
          tone="ok"
          label="healthy"
          value={`${services.healthy}/${services.total}`}
        />
        {services.degraded > 0 ? (
          <Tile icon={AlertTriangle} tone="warn" label="degraded" value={String(services.degraded)} />
        ) : null}
        {services.critical > 0 ? (
          <Tile icon={XCircle} tone="crit" label="critical" value={String(services.critical)} />
        ) : null}

        <Divider />

        <Tile label="traffic" value={`${formatCompact(traffic.requestsPerSecond)}/s`} />
        <Tile
          label="error rate"
          value={formatPercent(traffic.errorRate)}
          tone={traffic.errorRate >= 0.01 ? 'crit' : 'neutral'}
        />
        <Tile label="p95" value={formatDuration(traffic.p95Ms)} />

        <Divider />

        <Tile label="availability" value={formatPercent(summary.availability, 3)} />
        <Tile
          label={`SLO ${formatPercent(summary.sloTarget, 1)}`}
          value={summary.availability >= summary.sloTarget ? 'meeting' : 'breaching'}
          tone={summary.availability >= summary.sloTarget ? 'ok' : 'crit'}
        />

        {incidents.open > 0 ? (
          <>
            <Divider />
            <Tile
              icon={Siren}
              tone={incidents.worstSeverity === 'sev1' ? 'crit' : 'warn'}
              label="open incidents"
              value={String(incidents.open)}
            />
          </>
        ) : null}

        <span className="ml-auto hidden items-center gap-1.5 sm:inline-flex">
          <Badge tone="info" mono>
            simulated
          </Badge>
        </span>
      </div>
    </div>
  )
}

function Divider() {
  return <span className="hidden h-4 w-px bg-edge sm:block" aria-hidden />
}

function Tile({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon?: typeof Activity
  label: string
  value: string
  tone?: 'neutral' | 'ok' | 'warn' | 'crit'
}) {
  const tones = {
    neutral: 'text-muted',
    ok: 'text-ok',
    warn: 'text-warn',
    crit: 'text-crit',
  }
  return (
    <span className="inline-flex items-baseline gap-1.5 text-[11px]">
      {Icon ? <Icon className={cn('size-3.5 self-center', tones[tone])} aria-hidden /> : null}
      <span className="text-subtle">{label}</span>
      <span className={cn('tnum font-medium', tones[tone])}>{value}</span>
    </span>
  )
}
