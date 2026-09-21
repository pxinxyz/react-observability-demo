import { useMemo } from 'react'
import { ChevronRight, CornerDownRight } from 'lucide-react'
import { StatusDot, type Tone } from '@/components/ui/primitives'
import { spanStatusTone } from '@/lib/telemetry'
import { cn, formatDuration } from '@/lib/utils'
import { position, serviceColour, type TraceViewerTrace, type WaterfallSpan } from './model'

/**
 * The waterfall itself.
 *
 * One implementation, used in two places: inline under the trace list for
 * scanning, and inside the trace drawer for inspection. Selection is delegated
 * upward rather than owned here, so the same rows drive inline expansion in one
 * context and a side detail panel in the other.
 */

export function TimelineRuler({ durationMs }: { durationMs: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  return (
    <div className="flex items-center gap-2 border-b border-edge px-4 py-1">
      <div className="w-[min(38%,14rem)] shrink-0" />
      <div className="relative h-4 flex-1">
        {ticks.map((tick) => (
          <span
            key={tick}
            className="tnum absolute top-0 -translate-x-1/2 font-mono text-2xs text-subtle"
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

export function SpanWaterfall({
  trace,
  selectedSpanId,
  onSelectSpan,
}: {
  trace: TraceViewerTrace
  selectedSpanId: string | null
  onSelectSpan: (span: WaterfallSpan) => void
}) {
  const rows = useMemo(() => position(trace.spans), [trace.spans])
  const total = Math.max(trace.durationMs, 0.1)
  const criticalPath = useMemo(() => longestPath(trace), [trace])

  /*
   * Only mark the critical path when it discriminates. On a short or linear
   * trace every span is on it, so a badge on every row carries no information
   * and just adds noise; it earns its place only on a trace with enough spans
   * to branch, where it answers "which of these actually made this slow".
   */
  const showCriticalPath =
    trace.spans.length >= 3 && criticalPath.size > 0 && criticalPath.size < trace.spans.length

  return (
    <ul>
      {rows.map((span) => {
        const left = Math.min(100, (span.offsetMs / total) * 100)
        // Bars narrower than half a percent vanish on a 60-span trace.
        const width = Math.max(0.4, Math.min(100 - left, (span.durationMs / total) * 100))
        const isSelected = selectedSpanId === span.spanId
        const tone: Tone = spanStatusTone(span.status)

        return (
          <li key={span.spanId} className="border-b border-edge/40">
            <button
              type="button"
              onClick={() => onSelectSpan(span)}
              aria-current={isSelected ? 'true' : undefined}
              className={cn(
                'flex w-full items-center gap-2 px-4 py-1.5 text-left transition-colors',
                isSelected ? 'bg-raised' : 'hover:bg-raised/50',
              )}
            >
              <span className="flex w-[min(38%,14rem)] shrink-0 items-center gap-1.5">
                <span style={{ width: `${span.depth * 10}px` }} className="shrink-0" aria-hidden />
                {span.depth > 0 ? (
                  <CornerDownRight className="size-3 shrink-0 text-subtle/60" aria-hidden />
                ) : (
                  <ChevronRight
                    className={cn('size-3 shrink-0 text-subtle transition-transform', isSelected && 'rotate-90')}
                    aria-hidden
                  />
                )}
                <StatusDot tone={tone} />
                <span className="truncate text-xs text-ink" title={span.name}>
                  {span.name}
                </span>
                {showCriticalPath && criticalPath.has(span.spanId) ? (
                  <span
                    className="shrink-0 font-mono text-2xs text-subtle"
                    title="On the critical path — the chain of spans that determines total trace duration."
                  >
                    crit
                  </span>
                ) : null}
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

              <span className="tnum w-16 shrink-0 text-right font-mono text-2xs text-muted">
                {formatDuration(span.durationMs)}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The chain of spans whose durations sum to the trace's total — the path that
 * actually determined how long the request took. Everything else was concurrent
 * and did not extend the critical path, which is the single most useful thing a
 * waterfall can tell you and which a plain indented list hides.
 */
function longestPath(trace: TraceViewerTrace): Set<string> {
  const byParent = new Map<string | null, WaterfallSpan[]>()
  const ids = new Set(trace.spans.map((s) => s.spanId))
  for (const span of trace.spans) {
    const parent = span.parentSpanId && ids.has(span.parentSpanId) ? span.parentSpanId : null
    const bucket = byParent.get(parent)
    if (bucket) bucket.push(span)
    else byParent.set(parent, [span])
  }

  const best = new Map<string, number>()
  const bestChild = new Map<string, string>()

  const visit = (span: WaterfallSpan): number => {
    const cached = best.get(span.spanId)
    if (cached !== undefined) return cached
    let longest = 0
    let chosen: string | undefined
    for (const child of byParent.get(span.spanId) ?? []) {
      const childTotal = visit(child)
      if (childTotal > longest) {
        longest = childTotal
        chosen = child.spanId
      }
    }
    best.set(span.spanId, span.durationMs + longest)
    if (chosen) bestChild.set(span.spanId, chosen)
    return span.durationMs + longest
  }

  const path = new Set<string>()
  for (const root of byParent.get(null) ?? []) {
    visit(root)
    let cursor: string | undefined = root.spanId
    while (cursor) {
      path.add(cursor)
      cursor = bestChild.get(cursor)
    }
  }
  return path
}
