import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, ListTree, Maximize2, Pause, Play, Search } from 'lucide-react'
import { Badge, Button, EmptyState, Panel, PanelHeader, StatusDot } from '@/components/ui/primitives'
import { cn, formatDuration, formatNumber, formatClock, shortId } from '@/lib/utils'
import { useDebounce } from '@/hooks/useDebounce'
import { TimelineRuler, SpanWaterfall } from './trace/SpanWaterfall'
import { TraceDrawer } from './trace/TraceDrawer'
import type { TraceViewerTrace, WaterfallSpan } from './trace/model'

/**
 * The trace list plus an inline waterfall.
 *
 * Three levels of detail, increasing in cost:
 *   list       — scan, filter, pick a trace
 *   waterfall  — see the shape of one trace inline, in place
 *   drawer     — inspect a single span, over the top, without losing context
 *
 * Selection is deliberately not synced to the URL here; the drawer is a
 * transient inspection surface, and making every span click a navigation would
 * make the back button unusable.
 */

export { fromSpanTree, fromSimulatedTrace, fromSpanRecord, fromSimulatedSpan } from './trace/model'
export type { TraceViewerTrace, WaterfallSpan } from './trace/model'

export function TraceViewer({
  traces,
  emptyTitle = 'No traces',
  emptyDescription,
  onRefresh,
}: {
  traces: TraceViewerTrace[]
  emptyTitle?: string
  emptyDescription?: React.ReactNode
  onRefresh?: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rawFilter, setRawFilter] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [hideNoise, setHideNoise] = useState(true)
  const [paused, setPaused] = useState(false)
  const [frozen, setFrozen] = useState(traces)

  /*
   * The drawer holds its own reference to the trace it opened, rather than an
   * id looked up in the live list. Real spans stream in continuously and the
   * ring buffer evicts old ones, so a trace opened a minute ago can fall out of
   * the list entirely — and an id-based lookup would then silently resolve to
   * whatever trace had taken its place.
   */
  const [drawer, setDrawer] = useState<{ trace: TraceViewerTrace; spanId: string | null } | null>(
    null,
  )

  // Freeze the list while paused, and while a trace is open for inspection, so
  // rows do not move out from under the cursor.
  const frozenNow = paused || drawer !== null
  useEffect(() => {
    if (!frozenNow) setFrozen(traces)
  }, [traces, frozenNow])
  const source = frozenNow ? frozen : traces

  const filter = useDebounce(rawFilter, 200)

  /**
   * Standalone `longtask` spans are legitimate telemetry but terrible company:
   * the browser emits one every time the main thread blocks, so a handful drown
   * out the traces you actually navigated to. Filtered by default; one click
   * brings them back.
   */
  const noiseCount = useMemo(
    () => source.filter((trace) => trace.spans.every((span) => span.name === 'longtask')).length,
    [source],
  )

  const base = useMemo(
    () =>
      hideNoise
        ? source.filter((trace) => !trace.spans.every((span) => span.name === 'longtask'))
        : source,
    [source, hideNoise],
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

  function openSpan(trace: TraceViewerTrace, span: WaterfallSpan) {
    setDrawer({ trace, spanId: span.spanId })
  }

  return (
    <>
      <Panel className="flex min-h-0 flex-col overflow-hidden">
        <PanelHeader
          icon={ListTree}
          title="Traces"
          subtitle={
            selected
              ? `${source.length} traces · showing ${formatNumber(selected.spans.length)} spans`
              : undefined
          }
          actions={
            <>
              <Button
                size="sm"
                variant={paused ? 'solid' : 'outline'}
                onClick={() => setPaused((current) => !current)}
                title={
                  paused
                    ? 'Resume: new spans are being buffered but the list is frozen.'
                    : 'Freeze the list so rows stop moving while you read them.'
                }
              >
                {paused ? <Play className="size-3" aria-hidden /> : <Pause className="size-3" aria-hidden />}
                {paused ? 'Paused' : 'Live'}
              </Button>
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

        {source.length === 0 ? (
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
                        'w-full border-b border-edge/50 px-3 py-2 text-left transition-colors',
                        isSelected ? 'bg-raised' : 'hover:bg-raised/50',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <StatusDot tone={trace.status === 'error' ? 'crit' : 'ok'} />
                        <span className="sr-only">{trace.status === 'error' ? 'error' : 'ok'}</span>
                        <span className="truncate text-xs font-medium text-ink">{trace.title}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2 text-2xs text-subtle">
                        <span className="truncate font-mono">{trace.subtitle}</span>
                        <span className="tnum shrink-0">{formatDuration(trace.durationMs)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 font-mono text-2xs text-subtle">
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

            {/* Inline waterfall */}
            {selected ? (
              <div className="scroll-thin min-h-0 overflow-auto">
                <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-edge bg-panel/95 px-4 py-2 backdrop-blur">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-medium text-ink">{selected.title}</span>
                    <Badge tone={selected.status === 'error' ? 'crit' : 'ok'}>
                      {formatDuration(selected.durationMs)}
                    </Badge>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void copy(selected.id)}
                      title="Copy trace id"
                      className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 font-mono text-2xs text-subtle transition-colors hover:bg-raised hover:text-muted"
                    >
                      {copied === selected.id ? (
                        <Check className="size-3 text-ok" aria-hidden />
                      ) : (
                        <Copy className="size-3" aria-hidden />
                      )}
                      {selected.id}
                    </button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDrawer({ trace: selected, spanId: null })}
                      title="Open this trace in the detail drawer"
                    >
                      <Maximize2 className="size-3" aria-hidden />
                      Inspect
                    </Button>
                  </div>
                </div>

                <TimelineRuler durationMs={selected.durationMs} />
                <SpanWaterfall
                  trace={selected}
                  selectedSpanId={drawer?.trace.id === selected.id ? drawer.spanId : null}
                  onSelectSpan={(span) => openSpan(selected, span)}
                />
                <p className="px-4 py-2 text-2xs text-subtle">
                  Select a span to inspect its attributes, timing and parent.
                </p>
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      <TraceDrawer
        trace={drawer?.trace ?? null}
        initialSpanId={drawer?.spanId ?? null}
        open={drawer !== null}
        onOpenChange={(next) => {
          if (!next) setDrawer(null)
        }}
      />
    </>
  )
}
