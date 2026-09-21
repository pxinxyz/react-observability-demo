import type { LoggerProvider } from '@opentelemetry/sdk-logs'
import type { MeterProvider } from '@opentelemetry/sdk-metrics'
import type { WebTracerProvider } from '@opentelemetry/sdk-trace-web'
import { observabilityConfig } from './config'
import { exportStats } from './exportStats'
import { appLogger, initLogs, logStore } from './logger'
import { initMetrics } from './metrics'
import { UiMetricReader } from './metricStore'
import { spanStore } from './spanStore'
import { initTracing, registerWebInstrumentations } from './tracing'
import type { ObservabilityStatus } from './types'
import { initWebVitals } from './webVitals'

/**
 * The single entry point for instrumenting this app.
 *
 * Call `initObservability()` once, before React renders. See `src/main.tsx`.
 *
 * Everything here is real OTel: genuine SDK providers, genuine OTLP exporters,
 * genuine spans and metric data points produced by this browser. What is
 * simulated in this project is the *backend estate* the dashboard displays, not
 * the telemetry about the dashboard itself.
 */

export interface ObservabilityHandle {
  tracerProvider: WebTracerProvider
  meterProvider: MeterProvider
  loggerProvider: LoggerProvider
  uiMetricReader: UiMetricReader
}

let handle: ObservabilityHandle | null = null
let status: ObservabilityStatus | null = null

export function initObservability(): ObservabilityStatus {
  if (status && handle) return status

  const startedAt = Date.now()

  // Order matters: the tracer provider must exist before instrumentations are
  // registered, because they capture it at that moment.
  const tracerProvider = initTracing()
  const instrumentations = registerWebInstrumentations(tracerProvider)
  const { provider: meterProvider, uiReader } = initMetrics()
  const loggerProvider = initLogs()
  const vitals = initWebVitals()

  handle = { tracerProvider, meterProvider, loggerProvider, uiMetricReader: uiReader }

  status = {
    configured: observabilityConfig.configured,
    baseEndpoint: observabilityConfig.baseEndpoint,
    serviceName: observabilityConfig.serviceName,
    serviceVersion: observabilityConfig.serviceVersion,
    environment: observabilityConfig.environment,
    sampleRate: observabilityConfig.sampleRate,
    metricExportIntervalMs: observabilityConfig.metricExportIntervalMs,
    grafanaUrl: observabilityConfig.grafanaUrl,
    startedAt,
    instrumentations,
    endpoints: observabilityConfig.endpoints,
  }

  appLogger.info('observability initialised', {
    'app.otlp.configured': observabilityConfig.configured,
    'app.otlp.endpoint': observabilityConfig.baseEndpoint ?? 'none',
    'app.instrumentation.count': instrumentations.length,
    'app.web_vitals.count': vitals.length,
  })

  return status
}

export function getObservabilityStatus(): ObservabilityStatus {
  if (!status) return initObservability()
  return status
}

export interface FlushReport {
  traces: boolean
  metrics: boolean
  logs: boolean
  timedOut: boolean
}

/**
 * Force every provider to ship what it is holding.
 *
 * Useful because `BatchSpanProcessor` waits a couple of seconds by default — if
 * you want to click something and immediately go look at Tempo, flush first. The
 * Observability page exposes this as a button.
 */
export async function flushTelemetry(timeoutMs = 8_000): Promise<FlushReport> {
  if (!handle) return { traces: false, metrics: false, logs: false, timedOut: false }

  const timeout = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), timeoutMs)
  })

  const work = (async (): Promise<FlushReport> => {
    const results = await Promise.allSettled([
      handle!.tracerProvider.forceFlush(),
      handle!.meterProvider.forceFlush(),
      handle!.loggerProvider.forceFlush(),
      // Pull the UI's own view forward too, so the panel updates with the flush.
      handle!.uiMetricReader.refresh(),
    ])
    return {
      traces: results[0]?.status === 'fulfilled',
      metrics: results[1]?.status === 'fulfilled',
      logs: results[2]?.status === 'fulfilled',
      timedOut: false,
    }
  })()

  const winner = await Promise.race([work, timeout])
  if (winner === 'timeout') {
    return { traces: false, metrics: false, logs: false, timedOut: true }
  }
  return winner
}

/** Wipe everything the UI has buffered. Does not affect what was already exported. */
export function clearTelemetryBuffers(): void {
  spanStore.clear()
  logStore.clear()
  exportStats.reset()
}

export { observabilityConfig } from './config'
export { exportStats } from './exportStats'
export { appLogger, logStore, activeTraceId } from './logger'
export { metricStore } from './metricStore'
export { spanStore, attributeOf } from './spanStore'
export {
  annotateActiveSpan,
  recordException,
  withSpan,
} from './tracing'
export { recordApiCall, recordInteraction, recordRouteRender } from './metrics'
export { vitalsStore } from './webVitals'

export type {
  Attributes,
  AttributeValue,
  ExportAttempt,
  ExportStatsSnapshot,
  LogRecordSnapshot,
  MetricSnapshot,
  ObservabilityStatus,
  SignalName,
  SpanRecord,
  SpanTree,
} from './types'
export type { VitalReading } from './webVitals'
export type { MetricStoreSnapshot, MetricHistoryPoint } from './metricStore'
