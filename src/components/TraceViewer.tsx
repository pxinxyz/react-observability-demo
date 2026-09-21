import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as Collapsible from '@radix-ui/react-collapsible'
import { Check, ChevronDown, ChevronRight, Copy, ListTree, Search } from 'lucide-react'
import type { SimulatedTrace, TraceSpan } from '@simulator/types'
import type { SpanRecord, SpanTree } from '@/observability'
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  StatusDot,
  type Tone,
} from '@/components/ui/primitives'
import { spanStatusTone } from '@/lib/telemetry'
import { cn, formatDuration, formatNumber, formatClock, shortId } from '@/lib/utils'
import { useDebounce } from '@/hooks/useDebounce'

/**
 * A trace waterfall that does not care where its spans came from.
 *
 * This is the component that makes the project's honesty rules enforceable
 * rather than aspirational. It takes a normalised `WaterfallSpan[]`, and three
 * adapters feed it:
 *
 *   - `fromSpanRecord`   — REAL spans, teed out of the OTel SDK by `spanStore`
 *   - `fromSimulatedSpan` — FABRICATED spans from `/api/traces`
 *
 * Because both arrive in the same shape, the *rendering* is shared and only the
 * data source differs. The caller labels which is which; the UI never has to
 * pretend one is the other.
 */

export interface WaterfallSpan {
  spanId: string
  parentSpanId: string | null
  name: string
  serviceName: string
  scopeName?: string
  /** Milliseconds from the start of the trace. */
  offsetMs: number
  durationMs: number
  status: 'ok' | 'error' | 'unset'
  kind: string
  attributes: Record<string, string | number | boolean>
  events: Array<{
    name: string
    offsetMs: number
    attributes: Record<string, string | number | boolean>
  }>
}

export interface TraceViewerTrace {
  id: string
  title: string
  subtitle: string
  startTimeMs: number
  durationMs: number
  status: 'ok' | 'error'
  spans: WaterfallSpan[]
}

/* ── Adapters ────────────────────────────────────────────────────────────── */

/** REAL: an OTel `ReadableSpan` captured by the in-browser span store. */
export function fromSpanRecord(span: SpanRecord, traceStartMs: number): WaterfallSpan {
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    serviceName:
      typeof span.resource['service.name'] === 'string'
        ? span.resource['service.name']
        : 'unknown',
    scopeName: span.scopeName,
    offsetMs: Math.max(0, span.startTimeMs - traceStartMs),
    durationMs: Math.max(span.durationMs, 0.05),
    status:
      span.statusCode === 'ERROR' ? 'error' : span.statusCode === 'OK' ? 'ok' : 'unset',
    kind: span.kind,
    attributes: span.attributes,
    events: span.events.map((event) => ({
      name: event.name,
      offsetMs: event.offsetMs,
      attributes: event.attributes,
    })),
  }
}

/** FABRICATED: a span produced by `simulator/engine.ts`. */
export function fromSimulatedSpan(span: TraceSpan): WaterfallSpan {
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    serviceName: span.serviceName,
    offsetMs: span.offsetMs,
    durationMs: span.durationMs,
    status: span.status === 'error' ? 'error' : 'ok',
    kind: span.kind,
    attributes: span.attributes,
    events: [],
  }
}

/** REAL: group a set of span-store spans into a viewer trace. */
export function fromSpanTree(tree: SpanTree): TraceViewerTrace {
  return {
    id: tree.traceId,
    title: tree.rootSpan.name,
    subtitle: `${tree.spans.length} spans · ${tree.services.length} service${tree.services.length === 1 ? '' : 's'}`,
    startTimeMs: tree.startTimeMs,
    durationMs: tree.durationMs,
    status: tree.hasError ? 'error' : 'ok',
    spans: tree.spans.map((span) => fromSpanRecord(span, tree.startTimeMs)),
  }
}

/** FABRICATED: shape a simulator trace for the same viewer. */
export function fromSimulatedTrace(trace: SimulatedTrace): TraceViewerTrace {
  const startTimeMs = new Date(trace.startedAt).getTime()
  return {
    id: trace.traceId,
    title: trace.rootName,
    subtitle: `${trace.spans.length} spans · via ${trace.serviceName}`,
    startTimeMs,
    durationMs: trace.durationMs,
    status: trace.status,
    spans: trace.spans.map(fromSimulatedSpan),
  }
}

/* ── Layout helpers ──────────────────────────────────────────────────────── */

interface PositionedSpan extends WaterfallSpan {
  depth: number
}

/**
 * Flatten the span tree depth-first so parents always precede their children.
 * Orphans — a span whose parent was evicted from the ring buffer — are treated
 * as roots rather than dropped.
 */
function position(spans: readonly WaterfallSpan[]): PositionedSpan[] {
  const byParent = new Map<string | null, WaterfallSpan[]>()
  const ids = new Set(spans.map((span) => span.spanId))

  for (const span of spans) {
    const parent = span.parentSpanId && ids.has(span.parentSpanId) ? span.parentSpanId : null
    const bucket = byParent.get(parent)
    if (bucket) bucket.push(span)
    else byParent.set(parent, [span])
  }

  const ordered: PositionedSpan[] = []

  const walk = (parentId: string | null, depth: number): void => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => a.offsetMs - b.offsetMs)
    for (const child of children) {
      ordered.push({ ...child, depth })
      walk(child.spanId, depth + 1)
    }
  }

  walk(null, 0)
  return ordered
}

/** Stable per-service colour, so the same service is the same colour every time. */
const SERVICE_COLOURS = [
  'var(--color-accent)',
  'var(--color-ok)',
  'var(--color-info)',
  'var(--color-warn)',
  '#f472b6',
  '#22d3ee',
  '#a3e635',
  '#fb923c',
]

function serviceColour(serviceName: string): string {
  let hash = 0
  for (let i = 0; i < serviceName.length; i += 1) {
    hash = (hash * 31 + serviceName.charCodeAt(i)) >>> 0
  }
  return SERVICE_COLOURS[hash % SERVICE_COLOURS.length] ?? 'var(--color-accent)'
}

/* ── Component ───────────────────────────────────────────────────────────── */

export function TraceViewer({
  traces,
  emptyTitle = 'No traces',
  emptyDescription,
  onRefresh,
}: {
  traces: TraceViewerTrace[]
  emptyTitle?: string
  emptyDescription?: ReactNode
  onRefresh?: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rawFilter, setRawFilter] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [hideNoise, setHideNoise] = useState(true)
  const filter = useDebounce(rawFilter, 200)

  /**
   * Standalone `longtask` spans are legitimate telemetry but terrible company:
   * the browser emits one every time the main thread blocks, so a handful of
   * them drown out the traces you actually navigated to. They are filtered by
   * default and one click brings them back.
   */
  const noiseCount = useMemo(
    () => traces.filter((trace) => trace.spans.every((span) => span.name === 'longtask')).length,
    [traces],
  )

  const base = useMemo(
    () =>
      hideNoise
        ? traces.filter((trace) => !trace.spans.every((span) => span.name === 'longtask'))
        : traces,
    [traces, hideNoise],
  )

  const selected = useMemo(
    () => base.find((trace) => trace.id === selectedId) ?? base[0] ?? null,
    [base, selectedId],
  )

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return base
    return base.filter(
      (trace) =>
        trace.title.toLowerCase().includes(needle) ||
        trace.id.toLowerCase().includes(needle) ||
        trace.spans.some((span) => span.serviceName.toLowerCase().includes(needle)),
    )
  }, [base, filter])

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(value)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // Clipboard access can be denied; the id is on screen either way.
    }
  }

  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      <PanelHeader
        icon={ListTree}
        title="Traces"
        subtitle={
          selected
            ? `${traces.length} traces · showing ${formatNumber(selected.spans.length)} spans`
            : undefined
        }
        actions={
          <>
            {noiseCount > 0 ? (
              <Button
                size="sm"
                variant={hideNoise ? 'solid' : 'outline'}
                onClick={() => setHideNoise((current) => !current)}
                title="Standalone long-task spans, emitted whenever the main thread blocks."
              >
                {hideNoise ? `+${noiseCount} long tasks` : `hide ${noiseCount} long tasks`}
              </Button>
            ) : null}
            {onRefresh ? (
              <Button size="sm" variant="outline" onClick={onRefresh}>
                Refresh
              </Button>
            ) : null}
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle"
                aria-hidden
              />
              <input
                value={rawFilter}
                onChange={(event) => setRawFilter(event.target.value)}
                placeholder="Filter…"
                aria-label="Filter traces"
                className="w-32 rounded border border-edge bg-canvas/60 py-1 pl-7 pr-2 text-xs text-ink placeholder:text-subtle focus:border-accent/50 focus:outline-none"
              />
            </div>
          </>
        }
      />

      {traces.length === 0 ? (
        <EmptyState icon={ListTree} title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          {/* Trace list */}
          <ul className="scroll-thin max-h-72 overflow-auto border-b border-edge lg:max-h-none lg:border-b-0 lg:border-r">
            {filtered.map((trace) => {
              const isSelected = selected?.id === trace.id
              return (
                <li key={trace.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(trace.id)}
                    className={cn(
                      'w-full border-b border-edge/50 px-3 py-2.5 text-left transition-colors',
                      isSelected ? 'bg-raised' : 'hover:bg-raised/50',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <StatusDot tone={trace.status === 'error' ? 'crit' : 'ok'} />
                      <span className="truncate text-xs font-medium text-ink">{trace.title}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-subtle">
                      <span className="truncate font-mono">{trace.subtitle}</span>
                      <span className="tnum shrink-0">{formatDuration(trace.durationMs)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[10px] text-subtle">
                      <span>{formatClock(trace.startTimeMs)}</span>
                      <span className="truncate">{shortId(trace.id, 12)}</span>
                    </div>
                  </button>
                </li>
              )
            })}

            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-subtle">
                No traces match “{filter}”.
              </li>
            ) : null}
          </ul>

          {/* Waterfall */}
          {selected ? (
            <div className="scroll-thin min-h-0 overflow-auto">
              <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-edge bg-panel/95 px-4 py-2.5 backdrop-blur">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-xs font-medium text-ink">{selected.title}</span>
                  <Badge tone={selected.status === 'error' ? 'crit' : 'ok'}>
                    {formatDuration(selected.durationMs)}
                  </Badge>
                </div>
                <button
                  type="button"
                  onClick={() => void copy(selected.id)}
                  title="Copy trace id"
                  className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 font-mono text-[10px] text-subtle transition-colors hover:bg-raised hover:text-muted"
                >
                  {copied === selected.id ? (
                    <Check className="size-3 text-ok" aria-hidden />
                  ) : (
                    <Copy className="size-3" aria-hidden />
                  )}
                  {selected.id}
                </button>
              </div>

              <TimelineRuler durationMs={selected.durationMs} />
              <SpanRows trace={selected} />
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  )
}

function TimelineRuler({ durationMs }: { durationMs: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  return (
    <div className="flex items-center gap-2 border-b border-edge px-4 py-1">
      <div className="w-[min(38%,14rem)] shrink-0" />
      <div className="relative h-4 flex-1">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="tnum absolute top-0 -translate-x-1/2 font-mono text-[9px] text-subtle"
            style={{ left: `${tick * 100}%` }}
          >
            {formatDuration(durationMs * tick)}
          </span>
        ))}
      </div>
      <div className="w-16 shrink-0" />
    </div>
  )
}

function SpanRows({ trace }: { trace: TraceViewerTrace }) {
  const [openSpanId, setOpenSpanId] = useState<string | null>(null)
  const rows = useMemo(() => position(trace.spans), [trace.spans])
  const total = Math.max(trace.durationMs, 0.1)

  return (
    <ul>
      {rows.map((span) => {
        const left = Math.min(100, (span.offsetMs / total) * 100)
        // Bars narrower than half a percent vanish on a 60-span trace.
        const width = Math.max(0.4, Math.min(100 - left, (span.durationMs / total) * 100))
        const isOpen = openSpanId === span.spanId
        const tone: Tone = spanStatusTone(span.status)

        return (
          <li key={span.spanId} className="border-b border-edge/40">
            <Collapsible.Root
              open={isOpen}
              onOpenChange={(next) => setOpenSpanId(next ? span.spanId : null)}
            >
              <Collapsible.Trigger asChild>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 px-4 py-1.5 text-left transition-colors',
                    isOpen ? 'bg-raised/60' : 'hover:bg-raised/40',
                  )}
                >
                  <span className="flex w-[min(38%,14rem)] shrink-0 items-center gap-1.5">
                    <span style={{ width: `${span.depth * 10}px` }} className="shrink-0" aria-hidden />
                    {isOpen ? (
                      <ChevronDown className="size-3 shrink-0 text-subtle" aria-hidden />
                    ) : (
                      <ChevronRight className="size-3 shrink-0 text-subtle" aria-hidden />
                    )}
                    <StatusDot tone={tone} />
                    <span className="truncate text-[11px] text-ink" title={span.name}>
                      {span.name}
                    </span>
                  </span>

                  <span className="relative h-4 flex-1">
                    <span
                      className="absolute top-1/2 h-2 -translate-y-1/2 rounded-sm opacity-90"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor:
                          span.status === 'error' ? 'var(--color-crit)' : serviceColour(span.serviceName),
                      }}
                      title={`${span.serviceName} · ${formatDuration(span.durationMs)}`}
                    />
                  </span>

                  <span className="tnum w-16 shrink-0 text-right font-mono text-[10px] text-muted">
                    {formatDuration(span.durationMs)}
                  </span>
                </button>
              </Collapsible.Trigger>

              <Collapsible.Content>
                <SpanDetail span={span} />
              </Collapsible.Content>
            </Collapsible.Root>
          </li>
        )
      })}
    </ul>
  )
}

function SpanDetail({ span }: { span: PositionedSpan }) {
  const entries = Object.entries(span.attributes)

  return (
    <div className="border-t border-edge/50 bg-canvas/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral" mono>
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
        <span className="font-mono text-[10px] text-subtle">span {span.spanId}</span>
      </div>

      {entries.length > 0 ? (
        <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between gap-3 border-b border-edge/30 py-0.5">
              <dt className="truncate font-mono text-[10px] text-subtle" title={key}>
                {key}
              </dt>
              <dd className="tnum truncate font-mono text-[10px] text-muted" title={String(value)}>
                {String(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-[11px] text-subtle">No attributes on this span.</p>
      )}

      {span.events.length > 0 ? (
        <div className="mt-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-subtle">
            Events
          </div>
          <ul className="mt-1 space-y-0.5">
            {span.events.map((event, index) => (
              <li key={`${event.name}-${index}`} className="flex items-center gap-2 text-[11px]">
                <span className="tnum font-mono text-[10px] text-subtle">
                  +{formatDuration(event.offsetMs)}
                </span>
                <span className="text-muted">{event.name}</span>
                {Object.entries(event.attributes).map(([key, value]) => (
                  <span key={key} className="font-mono text-[10px] text-subtle">
                    {key}={String(value)}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
