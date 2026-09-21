import { useSyncExternalStore } from 'react'
import {
  exportStats,
  logStore,
  metricStore,
  spanStore,
  vitalsStore,
} from '@/observability'
import type {
  ExportStatsSnapshot,
  LogRecordSnapshot,
  MetricSnapshot,
  SpanRecord,
  SpanTree,
} from '@/observability'
import type { VitalReading } from '@/observability'

/**
 * Read the in-browser telemetry buffers from React.
 *
 * These are *not* TanStack Query hooks, and the distinction matters. Query owns
 * data that lives on a server and must be fetched. These buffers live in this
 * tab and change synchronously as the app runs, so `useSyncExternalStore` is the
 * correct primitive — it subscribes directly to the store and re-renders on
 * mutation, with no polling and no cache to invalidate.
 *
 * Every store returns a referentially stable snapshot between mutations, which
 * is what `useSyncExternalStore` requires to avoid infinite render loops.
 */

/** Every span this tab has recorded, newest last. */
export function useSpans(): SpanRecord[] {
  return useSyncExternalStore(spanStore.subscribe, spanStore.getSpans, spanStore.getSpans)
}

/** The same spans, grouped into per-trace trees ready for the waterfall. */
export function useSpanTrees(): SpanTree[] {
  return useSyncExternalStore(spanStore.subscribe, spanStore.getTrees, spanStore.getTrees)
}

/** Metric data points pulled from the SDK's own aggregation state. */
export function useMetricSnapshots(): MetricSnapshot[] {
  return useSyncExternalStore(
    metricStore.subscribe,
    () => metricStore.getSnapshot().metrics,
    () => metricStore.getSnapshot().metrics,
  )
}

export function useMetricCollection() {
  return useSyncExternalStore(
    metricStore.subscribe,
    metricStore.getSnapshot,
    metricStore.getSnapshot,
  )
}

/** Log records this tab emitted, newest first. */
export function useLogRecords(): LogRecordSnapshot[] {
  return useSyncExternalStore(
    logStore.subscribe,
    logStore.getSnapshot,
    logStore.getSnapshot,
  )
}

/** Whether the OTLP export pipeline is actually succeeding. */
export function useExportStats(): ExportStatsSnapshot {
  return useSyncExternalStore(
    exportStats.subscribe,
    exportStats.getSnapshot,
    exportStats.getSnapshot,
  )
}

/** Real Core Web Vitals, measured by the browser. */
export function useVitals(): VitalReading[] {
  return useSyncExternalStore(
    vitalsStore.subscribe,
    vitalsStore.getSnapshot,
    vitalsStore.getSnapshot,
  )
}
