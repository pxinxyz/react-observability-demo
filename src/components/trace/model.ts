import type { SimulatedTrace, TraceSpan } from '@simulator/types'
import type { SpanRecord, SpanTree } from '@/observability'

/**
 * The trace view model.
 *
 * Deliberately independent of where spans came from. Two adapters produce it —
 * one from real OTel `ReadableSpan`s teed out of the SDK, one from the
 * simulator's fabricated traces — and everything downstream (the inline
 * waterfall, the drawer, the span detail panel) is written against this shape
 * alone. That is what lets the same components render genuine browser telemetry
 * and simulated estate telemetry without either one pretending to be the other.
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
  /** Where these spans came from. Drives the provenance label, nothing else. */
  origin: 'real' | 'simulated'
}

/** REAL: an OTel `ReadableSpan` captured by the in-browser span store. */
export function fromSpanRecord(span: SpanRecord, traceStartMs: number): WaterfallSpan {
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    serviceName:
      typeof span.resource['service.name'] === 'string' ? span.resource['service.name'] : 'unknown',
    scopeName: span.scopeName,
    offsetMs: Math.max(0, span.startTimeMs - traceStartMs),
    durationMs: Math.max(span.durationMs, 0.05),
    status: span.statusCode === 'ERROR' ? 'error' : span.statusCode === 'OK' ? 'ok' : 'unset',
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
    origin: 'real',
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
    origin: 'simulated',
  }
}

export interface PositionedSpan extends WaterfallSpan {
  depth: number
}

/**
 * Flatten the span tree depth-first so parents always precede their children.
 * Orphans — a span whose parent was evicted from the ring buffer, which happens
 * on real traces once the 400-span buffer wraps — are treated as roots rather
 * than dropped.
 */
export function position(spans: readonly WaterfallSpan[]): PositionedSpan[] {
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

/**
 * Stable per-service colour, so a service keeps its colour between renders and
 * between the inline waterfall and the drawer.
 */
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

export function serviceColour(serviceName: string): string {
  let hash = 0
  for (let i = 0; i < serviceName.length; i += 1) {
    hash = (hash * 31 + serviceName.charCodeAt(i)) >>> 0
  }
  return SERVICE_COLOURS[hash % SERVICE_COLOURS.length] ?? 'var(--color-accent)'
}
