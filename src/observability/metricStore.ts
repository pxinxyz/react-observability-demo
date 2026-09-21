import { DataPointType, MetricReader } from '@opentelemetry/sdk-metrics'
import type {
  DataPoint,
  ExponentialHistogram,
  Histogram,
  MetricData,
  ResourceMetrics,
} from '@opentelemetry/sdk-metrics'
import type { Attributes, MetricPointSnapshot, MetricSnapshot } from './types'

/**
 * A `MetricReader` that feeds the UI.
 *
 * The SDK used to export `InMemoryMetricReader` for exactly this purpose; it is
 * gone in the 2.x line, so this module provides the equivalent in ~40 lines. It
 * is registered alongside the real `PeriodicExportingMetricReader`, which means
 * the numbers on screen and the numbers in Prometheus come from the same
 * instruments and the same recordings — the only difference is the destination.
 *
 * Readers each own their own aggregation state, so adding this one does not
 * perturb what gets exported.
 */

export interface MetricStoreSnapshot {
  metrics: MetricSnapshot[]
  /** Epoch ms of the most recent successful collection, or null. */
  collectedAt: number | null
  /** Non-fatal errors reported by the SDK during the last collection. */
  errors: string[]
  /**
   * Rolling history per metric name, appended on every collection.
   *
   * The SDK reports cumulative aggregates, so a single collection is a still
   * frame. Keeping the last `MAX_HISTORY` frames is what lets the UI draw a live
   * chart of the app's own metrics without inventing values.
   */
  history: Record<string, MetricHistoryPoint[]>
}

export interface MetricHistoryPoint {
  t: number
  v: number
}

/** ~2 minutes of history at the UI reader's cadence. */
const MAX_HISTORY = 60

function hrTimeToMs(hrTime: readonly [number, number]): number {
  return hrTime[0] * 1000 + hrTime[1] / 1e6
}

function normalizeAttributes(source: Readonly<Record<string, unknown>> | undefined): Attributes {
  const out: Attributes = {}
  if (!source) return out
  for (const [key, raw] of Object.entries(source)) {
    if (raw === undefined || raw === null) continue
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      out[key] = raw
    } else {
      out[key] = String(raw)
    }
  }
  return out
}

function describeType(dataPointType: DataPointType): string {
  switch (dataPointType) {
    case DataPointType.SUM:
      return 'sum'
    case DataPointType.GAUGE:
      return 'gauge'
    case DataPointType.HISTOGRAM:
      return 'histogram'
    case DataPointType.EXPONENTIAL_HISTOGRAM:
      return 'exponential-histogram'
    default:
      return 'unknown'
  }
}

function describeTemporality(value: number): string {
  return value === 1 ? 'cumulative' : 'delta'
}

function toSnapshotPoint(
  point:
    | DataPoint<number>
    | DataPoint<Histogram>
    | DataPoint<ExponentialHistogram>,
  dataPointType: DataPointType,
): MetricPointSnapshot {
  const base = {
    attributes: normalizeAttributes(point.attributes),
    startTimeMs: hrTimeToMs(point.startTime),
    timeMs: hrTimeToMs(point.endTime),
  }

  if (
    dataPointType === DataPointType.HISTOGRAM ||
    dataPointType === DataPointType.EXPONENTIAL_HISTOGRAM
  ) {
    const histogram = point.value as Histogram | ExponentialHistogram
    // Exponential histograms have no explicit boundaries; the SDK never produces
    // one with this app's instruments, but a plugin-supplied view could, so the
    // shape is preserved rather than silently dropped.
    const isExplicit = 'buckets' in histogram
    return {
      ...base,
      value: null,
      count: histogram.count,
      sum: histogram.sum ?? null,
      min: histogram.min ?? null,
      max: histogram.max ?? null,
      buckets: isExplicit
        ? {
            boundaries: [...(histogram as Histogram).buckets.boundaries],
            counts: [...(histogram as Histogram).buckets.counts],
          }
        : null,
    }
  }

  return {
    ...base,
    value: point.value as number,
    count: null,
    sum: null,
    min: null,
    max: null,
    buckets: null,
  }
}

function toSnapshot(metric: MetricData, scopeName: string): MetricSnapshot {
  return {
    name: metric.descriptor.name,
    description: metric.descriptor.description,
    unit: metric.descriptor.unit,
    type: describeType(metric.dataPointType),
    temporality: describeTemporality(metric.aggregationTemporality),
    scopeName,
    points: metric.dataPoints.map((point) => toSnapshotPoint(point, metric.dataPointType)),
  }
}

class MetricStore {
  private snapshot: MetricStoreSnapshot = {
    metrics: [],
    collectedAt: null,
    errors: [],
    history: {},
  }
  private listeners = new Set<() => void>()

  setMetrics(resourceMetrics: ResourceMetrics, errors: readonly unknown[]): void {
    const metrics: MetricSnapshot[] = []
    for (const scope of resourceMetrics.scopeMetrics) {
      const scopeName = scope.scope?.name ?? 'unknown'
      for (const metric of scope.metrics) {
        metrics.push(toSnapshot(metric, scopeName))
      }
    }

    metrics.sort((a, b) => a.name.localeCompare(b.name))

    const collectedAt = Date.now()
    const history = this.appendHistory(metrics, collectedAt)

    this.snapshot = {
      metrics,
      collectedAt,
      errors: errors.map((error) => (error instanceof Error ? error.message : String(error))),
      history,
    }

    for (const listener of this.listeners) listener()
  }

  /** Reduce each metric to one plottable number per collection and append it. */
  private appendHistory(
    metrics: readonly MetricSnapshot[],
    collectedAt: number,
  ): Record<string, MetricHistoryPoint[]> {
    const next: Record<string, MetricHistoryPoint[]> = { ...this.snapshot.history }

    for (const metric of metrics) {
      const value = aggregate(metric)
      if (value === null) continue

      const series = next[metric.name] ? [...next[metric.name]!] : []
      series.push({ t: collectedAt, v: value })
      if (series.length > MAX_HISTORY) series.splice(0, series.length - MAX_HISTORY)
      next[metric.name] = series
    }

    return next
  }

  /** Stable identity between collections, for `useSyncExternalStore`. */
  getSnapshot = (): MetricStoreSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

/**
 * One number per metric per collection.
 *
 * Sums and gauges are totalled across attribute sets so that a counter broken
 * down by route still plots as one line. Histograms plot their running mean,
 * which is the honest single-number summary of a cumulative histogram.
 */
function aggregate(metric: MetricSnapshot): number | null {
  if (metric.points.length === 0) return null

  if (metric.type === 'histogram') {
    let sum = 0
    let count = 0
    for (const point of metric.points) {
      sum += point.sum ?? 0
      count += point.count ?? 0
    }
    return count > 0 ? sum / count : null
  }

  return metric.points.reduce((total, point) => total + (point.value ?? 0), 0)
}

export const metricStore = new MetricStore()

/**
 * Collects from the SDK on a timer purely so the UI has something to render.
 * Independent of `PeriodicExportingMetricReader`, which owns network export.
 */
export class UiMetricReader extends MetricReader {
  private timer: ReturnType<typeof setInterval> | null = null

  protected async onShutdown(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  protected async onForceFlush(): Promise<void> {
    await this.refresh()
  }

  /** Pull the current aggregation state and hand it to the UI store. */
  async refresh(): Promise<void> {
    try {
      const result = await this.collect()
      metricStore.setMetrics(result.resourceMetrics, result.errors)
    } catch {
      // A failed collection must not break rendering; the panel just goes stale.
    }
  }

  start(intervalMs: number): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = setInterval(() => {
      void this.refresh()
    }, intervalMs)
    void this.refresh()
  }
}
