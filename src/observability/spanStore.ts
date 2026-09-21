import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-web'
import type { Attributes, AttributeValue, SpanEvent, SpanRecord, SpanTree } from './types'

/**
 * A `SpanProcessor` that keeps ended spans in the browser.
 *
 * This is the mechanism behind the project's central claim. The spans the
 * TraceViewer renders are not fetched from a fixture — they are the same
 * `ReadableSpan` objects the SDK hands to the OTLP exporter, teed into a ring
 * buffer on their way out. Click a button, and a real span shows up.
 *
 * Registering a second processor alongside `BatchSpanProcessor` costs one
 * synchronous array push per ended span and changes nothing about what gets
 * exported.
 */

/** Ring buffer capacity. Old spans are dropped first. */
const MAX_SPANS = 400

const INVALID_SPAN_ID = '0000000000000000'

/**
 * The SDK's `Attributes` allows arrays and `undefined`; our view models do not.
 * Flatten defensively so a span with an odd attribute cannot break the UI.
 */
function normalizeAttributes(
  source: Readonly<Record<string, unknown>> | undefined,
): Attributes {
  const out: Attributes = {}
  if (!source) return out

  for (const [key, raw] of Object.entries(source)) {
    if (raw === undefined || raw === null) continue
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      out[key] = raw
    } else if (Array.isArray(raw)) {
      out[key] = raw.map((item) => String(item)).join(', ')
    } else {
      try {
        out[key] = JSON.stringify(raw)
      } catch {
        out[key] = String(raw)
      }
    }
  }
  return out
}

/** `HrTime` is `[seconds, nanoseconds]`. */
function hrTimeToMs(hrTime: readonly [number, number]): number {
  return hrTime[0] * 1000 + hrTime[1] / 1e6
}

function statusCodeOf(span: ReadableSpan): SpanRecord['statusCode'] {
  const name = SpanStatusCode[span.status.code]
  if (name === 'OK' || name === 'ERROR') return name
  return 'UNSET'
}

function toRecord(span: ReadableSpan): SpanRecord {
  const context = span.spanContext()
  const parentSpanId = span.parentSpanContext?.spanId

  const events: SpanEvent[] = span.events.map((event) => ({
    name: event.name,
    offsetMs: hrTimeToMs(event.time) - hrTimeToMs(span.startTime),
    attributes: normalizeAttributes(event.attributes),
  }))

  return {
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: parentSpanId && parentSpanId !== INVALID_SPAN_ID ? parentSpanId : null,
    name: span.name,
    kind: (SpanKind[span.kind] ?? 'INTERNAL').toLowerCase(),
    startTimeMs: hrTimeToMs(span.startTime),
    endTimeMs: hrTimeToMs(span.endTime),
    durationMs: hrTimeToMs(span.duration),
    statusCode: statusCodeOf(span),
    statusMessage: span.status.message ?? null,
    attributes: normalizeAttributes(span.attributes),
    events,
    resource: normalizeAttributes(span.resource.attributes),
    scopeName: span.instrumentationScope?.name ?? 'unknown',
    scopeVersion: span.instrumentationScope?.version ?? null,
  }
}

/** Group flat spans into per-trace trees, newest trace first. */
function buildTrees(spans: readonly SpanRecord[]): SpanTree[] {
  const byTrace = new Map<string, SpanRecord[]>()
  for (const span of spans) {
    const bucket = byTrace.get(span.traceId)
    if (bucket) bucket.push(span)
    else byTrace.set(span.traceId, [span])
  }

  const trees: SpanTree[] = []

  for (const [traceId, group] of byTrace) {
    const sorted = [...group].sort((a, b) => a.startTimeMs - b.startTimeMs)
    const ids = new Set(sorted.map((span) => span.spanId))
    // A span whose parent never made it into the buffer is treated as a root,
    // otherwise a truncated trace would render as an empty waterfall.
    const root =
      sorted.find((span) => span.parentSpanId === null || !ids.has(span.parentSpanId)) ??
      sorted[0]
    if (!root) continue

    const startTimeMs = Math.min(...sorted.map((span) => span.startTimeMs))
    const endTimeMs = Math.max(...sorted.map((span) => span.endTimeMs))

    trees.push({
      traceId,
      rootSpan: root,
      spans: sorted,
      startTimeMs,
      durationMs: Math.max(endTimeMs - startTimeMs, root.durationMs),
      hasError: sorted.some((span) => span.statusCode === 'ERROR'),
      services: [
        ...new Set(
          sorted
            .map((span) => span.resource['service.name'])
            .filter((name): name is string => typeof name === 'string'),
        ),
      ],
    })
  }

  return trees.sort((a, b) => b.startTimeMs - a.startTimeMs)
}

class SpanStore {
  private spans: SpanRecord[] = []
  private trees: SpanTree[] = []
  private treesDirty = true
  private listeners = new Set<() => void>()

  /** Called by the SDK. Must stay cheap and must never throw. */
  add(span: ReadableSpan): void {
    try {
      this.spans.push(toRecord(span))
      if (this.spans.length > MAX_SPANS) {
        this.spans.splice(0, this.spans.length - MAX_SPANS)
      }
      this.treesDirty = true
      this.emit()
    } catch {
      // A malformed span must never take down the tracer pipeline.
    }
  }

  /** Stable reference between mutations, as `useSyncExternalStore` requires. */
  getSpans = (): SpanRecord[] => this.spans

  getTrees = (): SpanTree[] => {
    if (this.treesDirty) {
      this.trees = buildTrees(this.spans)
      this.treesDirty = false
    }
    return this.trees
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  clear(): void {
    this.spans = []
    this.trees = []
    this.treesDirty = true
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Process-wide singleton. There is exactly one browser being observed. */
export const spanStore = new SpanStore()

/** The processor handed to `WebTracerProvider`. */
export class UiSpanProcessor implements SpanProcessor {
  onStart(): void {
    // Nothing to do until a span ends.
  }

  onEnd(span: ReadableSpan): void {
    spanStore.add(span)
  }

  async forceFlush(): Promise<void> {
    // Nothing is buffered here; spans are stored synchronously on end.
  }

  async shutdown(): Promise<void> {
    // Intentionally does not clear the buffer: the UI should keep showing what
    // was captured even after the provider is torn down (e.g. React strict mode).
  }
}

/** Small helper so components do not reach into raw attribute bags. */
export function attributeOf(span: SpanRecord, key: string): AttributeValue | undefined {
  return span.attributes[key] ?? span.resource[key]
}
