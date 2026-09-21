import { Badge, ProvenanceTag } from '@/components/ui/primitives'
import { formatDuration } from '@/lib/utils'
import type { PositionedSpan, TraceViewerTrace, WaterfallSpan } from './model'

/**
 * Everything known about one span.
 *
 * The point of this panel is that it is the bottom of the drill-down — fleet →
 * telemetry → incident → trace → span — so it should be complete enough that
 * you never need to leave the app to answer "what actually happened here".
 */
export function SpanDetailPanel({
  span,
  trace,
  className,
}: {
  span: PositionedSpan | WaterfallSpan
  trace: TraceViewerTrace
  className?: string
}) {
  const entries = Object.entries(span.attributes)
  const depth = 'depth' in span ? span.depth : 0

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={span.status === 'error' ? 'crit' : 'neutral'} mono>
          {span.kind}
        </Badge>
        <Badge tone="accent" mono>
          {span.serviceName}
        </Badge>
        {span.scopeName ? (
          <Badge tone="neutral" mono>
            {span.scopeName}
          </Badge>
        ) : null}
        <ProvenanceTag kind={trace.origin} />
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-2xs">
        <Row label="span" value={span.spanId} />
        <Row label="parent" value={span.parentSpanId ?? '—  (root span)'} />
        <Row label="trace" value={trace.id} />
        <Row label="duration" value={formatDuration(span.durationMs)} />
        <Row
          label="started at"
          value={`+${formatDuration(span.offsetMs)} into the trace`}
        />
        <Row label="depth" value={String(depth)} />
        <Row label="status" value={span.status} />
      </dl>

      {entries.length > 0 ? (
        <>
          <h4 className="mt-4 text-2xs font-medium uppercase tracking-wider text-subtle">
            Attributes
          </h4>
          <dl className="mt-1.5 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {entries.map(([key, value]) => (
              <div
                key={key}
                className="flex items-baseline justify-between gap-3 border-b border-edge/30 py-0.5"
              >
                <dt className="truncate font-mono text-2xs text-subtle" title={key}>
                  {key}
                </dt>
                <dd className="tnum truncate font-mono text-2xs text-muted" title={String(value)}>
                  {String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="mt-3 text-2xs text-subtle">No attributes on this span.</p>
      )}

      {span.events.length > 0 ? (
        <>
          <h4 className="mt-4 text-2xs font-medium uppercase tracking-wider text-subtle">
            Events
          </h4>
          <ul className="mt-1.5 space-y-0.5">
            {span.events.map((event, index) => (
              <li key={`${event.name}-${index}`} className="flex flex-wrap items-center gap-2 text-2xs">
                <span className="tnum font-mono text-subtle">+{formatDuration(event.offsetMs)}</span>
                <span className="text-muted">{event.name}</span>
                {Object.entries(event.attributes).map(([key, value]) => (
                  <span key={key} className="font-mono text-subtle">
                    {key}={String(value)}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="font-mono text-subtle">{label}</dt>
      <dd className="tnum truncate font-mono text-muted" title={value}>
        {value}
      </dd>
    </>
  )
}
