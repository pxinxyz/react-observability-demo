import { useEffect, useState, useSyncExternalStore } from 'react'
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

/**
 * The same spans, grouped into per-trace trees ready for the waterfall.
 *
 * `paused` freezes the returned list while spans keep arriving underneath. Real
 * telemetry streams in continuously, so an unpaused list re-sorts every second
 * and moves rows out from under the cursor — which makes a list genuinely hard
 * to click and makes an open detail view jump to a different trace. Pausing is
 * what real observability tools offer for exactly this reason.
 */
export function useSpanTrees(paused = false): SpanTree[] {
  const live = useSyncExternalStore(spanStore.subscribe, spanStore.getTrees, spanStore.getTrees)
  const [frozen, setFrozen] = useState(live)

  useEffect(() => {
    if (!paused) setFrozen(live)
  }, [live, paused])

  return paused ? frozen : live
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
