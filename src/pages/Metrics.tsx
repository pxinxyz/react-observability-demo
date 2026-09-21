import { useEffect } from 'react'
import { BarChart3, Gauge, Table2 } from 'lucide-react'
import { AppMetricsPanel, SimulatedMetricsPanel } from '@/components/MetricsPanel'
import { ProvenanceBanner } from '@/components/ProvenanceBanner'
import { ScenarioNarrative } from '@/components/ScenarioPicker'
import {
  Badge,
  EmptyState,
  Panel,
  PanelHeader,
  ProvenanceTag,
  Stat,
  type Tone,
} from '@/components/ui/primitives'
import { useMetricCollection, useMetrics, useVitals } from '@/hooks'
import { recordInteraction } from '@/observability'
import { cn, formatDuration, formatNumber } from '@/lib/utils'

export function MetricsPage() {
  const collection = useMetricCollection()
  const simulated = useMetrics({ windowMinutes: 30, stepSeconds: 30 })
  const vitals = useVitals()

  useEffect(() => {
    recordInteraction('view-page', 'metrics')
  }, [])

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ScenarioNarrative />
      </div>

      <ProvenanceBanner
        tone="real"
        title="Instruments recorded by this browser"
        body={
          <>
            Read out of the OpenTelemetry SDK's own aggregation state by a custom{' '}
            <code className="font-mono">MetricReader</code> registered alongside the OTLP exporter.
            The values here and the values in Prometheus come from the same instruments and the same
            recordings — only the destination differs. Polled every two seconds.
          </>
        }
      />
      <AppMetricsPanel
        metrics={collection.metrics}
        history={collection.history}
        collectedAt={collection.collectedAt}
      />

      <Panel className="overflow-hidden">
        <PanelHeader
          icon={Gauge}
          title="Core Web Vitals"
          subtitle="Measured by the browser with the web-vitals library, recorded as OTel histograms."
          actions={<ProvenanceTag kind="real" />}
        />
        {vitals.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title="Waiting for vitals"
            description="LCP, CLS, TTFB and FCP report once the page settles. INP reports after the first interaction — click something."
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 px-4 py-4 lg:grid-cols-5">
            {vitals.map((vital) => {
              const tone: Tone =
                vital.rating === 'good'
                  ? 'ok'
                  : vital.rating === 'needs-improvement'
                    ? 'warn'
                    : 'crit'
              return (
                <Stat
                  key={vital.name}
                  label={vital.name}
                  tone={tone}
                  value={
                    vital.unit === 'score'
                      ? vital.value.toFixed(3)
                      : formatDuration(vital.value)
                  }
                  hint={
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'inline-block size-1.5 rounded-full',
                          tone === 'ok' ? 'bg-ok' : tone === 'warn' ? 'bg-warn' : 'bg-crit',
                        )}
                        aria-hidden
                      />
                      {vital.rating} · {vital.navigationType}
                    </span>
                  }
                />
              )
            })}
          </div>
        )}
      </Panel>

      <ProvenanceBanner
        tone="simulated"
        title="The fabricated estate's metrics"
        body={
          <>
            Prometheus-style series produced by{' '}
            <code className="font-mono">simulator/engine.ts</code>. These are not scraped from the
            Prometheus running in the OTEL-LGTM stack, and they do not describe any real system.
            Prometheus in that stack holds the metrics this browser genuinely exported.
          </>
        }
      />
      <SimulatedMetricsPanel
        series={simulated.data?.series ?? []}
        windowMinutes={simulated.data?.windowMinutes ?? 30}
        stepSeconds={simulated.data?.stepSeconds ?? 30}
      />

      <MetricExplorer metrics={collection.metrics} errors={collection.errors} />
    </>
  )
}

/**
 * The raw instrument view.
 *
 * Charts summarise; this does not. Being able to see the actual data points,
 * with their attributes and temporality, is what turns "we have metrics" into
 * something a reader can verify.
 */
function MetricExplorer({
  metrics,
  errors,
}: {
  metrics: ReturnType<typeof useMetricCollection>['metrics']
  errors: string[]
}) {
  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        icon={Table2}
        title="Raw instruments"
        subtitle={`${metrics.length} instruments currently reporting from this browser`}
        actions={<ProvenanceTag kind="real" />}
      />

      {errors.length > 0 ? (
        <div className="border-b border-edge bg-crit/5 px-4 py-2">
          <p className="text-xs text-crit">
            SDK reported {errors.length} non-fatal collection {errors.length === 1 ? 'error' : 'errors'}:{' '}
            {errors.join('; ')}
          </p>
        </div>
      ) : null}

      {metrics.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No instruments reporting"
          description="Interact with the app to generate metric data points."
        />
      ) : (
        <div className="scroll-thin max-h-[28rem] overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-panel/95 backdrop-blur">
              <tr className="border-b border-edge text-subtle">
                <th scope="col" className="px-3 py-2 font-medium">Instrument</th>
                <th scope="col" className="px-3 py-2 font-medium">Type</th>
                <th scope="col" className="px-3 py-2 font-medium">Temporality</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Points</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Latest</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => (
                <tr key={metric.name} className="border-b border-edge/50 align-top">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs text-ink">{metric.name}</div>
                    <div className="mt-0.5 max-w-xl text-2xs leading-relaxed text-subtle">
                      {metric.description || '—'}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[...new Set(metric.points.flatMap((point) => Object.keys(point.attributes)))]
                        .slice(0, 6)
                        .map((key) => (
                          <Badge key={key} tone="neutral" mono>
                            {key}
                          </Badge>
                        ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone="accent" mono>
                      {metric.type}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-subtle">{metric.temporality}</td>
                  <td className="tnum px-3 py-2 text-right text-muted">{metric.points.length}</td>
                  <td className="px-3 py-2 text-right">
                    <PointSummary metric={metric} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function PointSummary({ metric }: { metric: ReturnType<typeof useMetricCollection>['metrics'][number] }) {
  if (metric.type === 'histogram') {
    let count = 0
    let sum = 0
    for (const point of metric.points) {
      count += point.count ?? 0
      sum += point.sum ?? 0
    }
    return (
      <div className="tnum font-mono text-2xs leading-relaxed text-muted">
        <div>n={formatNumber(count)}</div>
        <div className="text-subtle">
          mean {count > 0 ? formatNumber(sum / count, 1) : '—'}
          {metric.unit ? ` ${metric.unit}` : ''}
        </div>
      </div>
    )
  }

  const total = metric.points.reduce((acc, point) => acc + (point.value ?? 0), 0)
  return (
    <span className="tnum font-mono text-xs text-muted">
      {formatNumber(total, total % 1 === 0 ? 0 : 2)}
      {metric.unit && metric.unit !== '{request}' && metric.unit !== '{span}' ? (
        <span className="ml-1 text-subtle">{metric.unit}</span>
      ) : null}
    </span>
  )
}
