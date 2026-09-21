import { metrics } from '@opentelemetry/api'
import type { Counter, Histogram, Meter } from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { observabilityConfig } from './config'
import { instrumentExporter } from './exportStats'
import { UiMetricReader } from './metricStore'
import { spanStore } from './spanStore'
import { buildResource } from './tracing'

/**
 * Metrics.
 *
 * Everything recorded here is a real OTel instrument, fed by real events in this
 * tab, and read back two ways: exported to the collector via OTLP, and pulled
 * into the UI by `UiMetricReader`. One set of instruments, two destinations.
 */

const METER_NAME = 'react-observability-demo'

interface Instruments {
  apiDuration: Histogram
  apiRequests: Counter
  apiErrors: Counter
  interactions: Counter
  routeRender: Histogram
  spansEmitted: Counter
}

let meter: Meter | null = null
let instruments: Instruments | null = null

/** Latency buckets tuned for browser-to-server calls, not for a generic service. */
const LATENCY_BUCKETS = [5, 10, 25, 50, 75, 100, 150, 250, 400, 600, 1000, 2000, 5000]

export interface MetricsHandle {
  provider: MeterProvider
  uiReader: UiMetricReader
}

export function initMetrics(): MetricsHandle {
  const readers: Array<PeriodicExportingMetricReader | UiMetricReader> = []

  const uiReader = new UiMetricReader()
  readers.push(uiReader)

  if (observabilityConfig.configured && observabilityConfig.endpoints.metrics) {
    const exporter = instrumentExporter(
      new OTLPMetricExporter({
        url: observabilityConfig.endpoints.metrics,
        headers: observabilityConfig.headers,
      }),
      'metrics',
    )
    readers.push(
      new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: observabilityConfig.metricExportIntervalMs,
      }),
    )
  }

  const provider = new MeterProvider({
    resource: buildResource(),
    readers,
  })

  metrics.setGlobalMeterProvider(provider)
  meter = provider.getMeter(METER_NAME, observabilityConfig.serviceVersion)

  instruments = {
    apiDuration: meter.createHistogram('app.api.client.duration', {
      description: 'Duration of calls from this browser to the demo API.',
      unit: 'ms',
      advice: { explicitBucketBoundaries: LATENCY_BUCKETS },
    }),
    apiRequests: meter.createCounter('app.api.client.requests', {
      description: 'Total API calls made by this browser.',
      unit: '{request}',
    }),
    apiErrors: meter.createCounter('app.api.client.errors', {
      description: 'API calls that failed, by reason.',
      unit: '{error}',
    }),
    interactions: meter.createCounter('app.ui.interactions', {
      description: 'User interactions that triggered a UI response.',
      unit: '{interaction}',
    }),
    routeRender: meter.createHistogram('app.route.render.duration', {
      description: 'Time from navigation start to the route being committed.',
      unit: 'ms',
      advice: { explicitBucketBoundaries: LATENCY_BUCKETS },
    }),
    spansEmitted: meter.createCounter('app.spans.emitted', {
      description: 'Spans this browser has recorded, by instrumentation scope.',
      unit: '{span}',
    }),
  }

  // A genuinely self-referential gauge: the app reports how much of its own
  // telemetry it is currently holding in memory.
  meter
    .createObservableGauge('app.telemetry.spans_buffered', {
      description: 'Spans currently held in the in-browser ring buffer for the UI.',
      unit: '{span}',
    })
    .addCallback((observation) => {
      observation.observe(spanStore.getSpans().length)
    })

  // The UI reader polls far more often than the exporter ships, so the panel
  // moves at the speed of the interface rather than the speed of the network.
  uiReader.start(Math.min(2_000, observabilityConfig.metricExportIntervalMs))

  return { provider, uiReader }
}

export function recordApiCall(params: {
  route: string
  method: string
  status: number | null
  durationMs: number
  ok: boolean
  errorType?: string
}): void {
  if (!instruments) return
  const attributes = {
    'app.api.route': params.route,
    'http.request.method': params.method,
    'http.response.status_code': params.status ?? 0,
  }

  instruments.apiDuration.record(params.durationMs, attributes)
  instruments.apiRequests.add(1, attributes)

  if (!params.ok) {
    instruments.apiErrors.add(1, {
      ...attributes,
      'error.type': params.errorType ?? 'unknown',
    })
  }
}

export function recordInteraction(action: string, target?: string): void {
  if (!instruments) return
  instruments.interactions.add(1, {
    'app.interaction.action': action,
    ...(target ? { 'app.interaction.target': target } : {}),
  })
}

export function recordRouteRender(route: string, durationMs: number): void {
  if (!instruments) return
  instruments.routeRender.record(durationMs, { 'app.route': route })
}

export function getMeter(): Meter | null {
  return meter
}
