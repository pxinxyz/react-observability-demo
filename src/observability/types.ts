/**
 * View models for the telemetry this browser actually produced.
 *
 * These are deliberately plain, JSON-ish shapes rather than the SDK's own
 * `ReadableSpan` / `MetricData` types. Two reasons:
 *
 *  1. The UI should not be coupled to the OTel SDK's internals, which carry
 *     `HrTime` tuples and private machinery that React cannot diff.
 *  2. The same view models render both the real spans from `spanStore` and the
 *     simulated traces from `/api/traces`, so the waterfall has exactly one
 *     input format.
 */

export type AttributeValue = string | number | boolean

export type Attributes = Record<string, AttributeValue>

export interface SpanEvent {
  name: string
  /** Milliseconds since the span started. */
  offsetMs: number
  attributes: Attributes
}

export interface SpanRecord {
  traceId: string
  spanId: string
  parentSpanId: string | null
  name: string
  /** `SpanKind` as a readable string, e.g. `client`. */
  kind: string
  /** Epoch milliseconds. */
  startTimeMs: number
  endTimeMs: number
  durationMs: number
  statusCode: 'UNSET' | 'OK' | 'ERROR'
  statusMessage: string | null
  attributes: Attributes
  events: SpanEvent[]
  /** Resource attributes, flattened. Includes `service.name`. */
  resource: Attributes
  /** e.g. `@opentelemetry/instrumentation-fetch`. */
  scopeName: string
  scopeVersion: string | null
}

/** Spans grouped into one trace, ready for the waterfall. */
export interface SpanTree {
  traceId: string
  rootSpan: SpanRecord
  spans: SpanRecord[]
  /** Total wall-clock duration of the trace, in milliseconds. */
  durationMs: number
  startTimeMs: number
  hasError: boolean
  /** Distinct service names present in the trace. */
  services: string[]
}

export interface HistogramBuckets {
  boundaries: number[]
  /** `counts[i]` is the count in `(boundaries[i-1], boundaries[i]]`. */
  counts: number[]
}

export interface MetricPointSnapshot {
  attributes: Attributes
  startTimeMs: number
  timeMs: number
  /** For sums and gauges. */
  value: number | null
  /** Histogram-only fields. */
  count: number | null
  sum: number | null
  min: number | null
  max: number | null
  buckets: HistogramBuckets | null
}

export interface MetricSnapshot {
  name: string
  description: string
  unit: string
  /** `sum` | `gauge` | `histogram`. */
  type: string
  /** `cumulative` | `delta`. */
  temporality: string
  scopeName: string
  points: MetricPointSnapshot[]
}

export interface LogRecordSnapshot {
  timeMs: number
  severityNumber: number
  severityText: string
  body: string
  attributes: Record<string, AttributeValue>
  traceId: string | null
  spanId: string | null
  scopeName: string
}

export type SignalName = 'traces' | 'metrics' | 'logs'

/** One attempt by an exporter to ship a batch, successful or not. */
export interface ExportAttempt {
  signal: SignalName
  ok: boolean
  /** How many spans / metric points / log records were in the batch. */
  itemCount: number
  at: number
  error: string | null
}

export interface ExportStatsSnapshot {
  attempts: ExportAttempt[]
  /** Attempts in the ring buffer that succeeded. */
  succeeded: number
  failed: number
  /** Items shipped successfully, summed over the buffered attempts. */
  itemsExported: number
  lastSuccessAt: number | null
  lastFailureAt: number | null
  lastError: string | null
}

export interface ObservabilityStatus {
  /** Whether a usable OTLP endpoint was configured at build time. */
  configured: boolean
  baseEndpoint: string | null
  serviceName: string
  serviceVersion: string
  environment: string
  /** Head sampling ratio, 0..1. */
  sampleRate: number
  metricExportIntervalMs: number
  grafanaUrl: string | null
  /** Epoch ms when `initObservability()` completed. */
  startedAt: number
  /** Instrumentation library names that were registered. */
  instrumentations: string[]
  /** Resolved OTLP URLs, shown in the UI so the integration is inspectable. */
  endpoints: Record<SignalName, string | null>
}
