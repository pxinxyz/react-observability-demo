import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import type { Attributes, Span } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { LongTaskInstrumentation } from '@opentelemetry/instrumentation-long-task'
import { UserInteractionInstrumentation } from '@opentelemetry/instrumentation-user-interaction'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  WebTracerProvider,
} from '@opentelemetry/sdk-trace-web'
import type { SpanProcessor } from '@opentelemetry/sdk-trace-web'
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import { observabilityConfig } from './config'
import { instrumentExporter } from './exportStats'
import { UiSpanProcessor } from './spanStore'

/**
 * Tracing.
 *
 * The browser is the observed system: these spans describe what this tab did,
 * not what some backend did. `document-load`, `fetch` and `click` instrumentations
 * supply spans automatically; `withSpan` is the manual escape hatch for anything
 * worth naming explicitly.
 *
 * A deliberate omission: no `ZoneContextManager`. zone.js would propagate
 * context across `await` boundaries, but it patches Promise, timers and every
 * event target in the page — a heavy, invasive dependency for a demo. The
 * default `StackContextManager` propagates synchronously, which is sufficient
 * provided fetch calls happen inside the active span rather than after a stray
 * `await`. `withSpan` below is written with that constraint in mind.
 */

const TRACER_NAME = 'react-observability-demo'

let provider: WebTracerProvider | null = null
let instrumentationsRegistered = false

/** Resource attributes attached to every span, metric and log this app emits. */
export function buildResource() {
  const attributes: Record<string, string | number> = {
    [ATTR_SERVICE_NAME]: observabilityConfig.serviceName,
    [ATTR_SERVICE_VERSION]: observabilityConfig.serviceVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: observabilityConfig.environment,
    'telemetry.sdk.name': 'react-observability-demo',
  }

  if (typeof navigator !== 'undefined') {
    attributes['browser.language'] = navigator.language
    attributes['browser.online'] = navigator.onLine ? 'true' : 'false'
    // The full UA is long and low-cardinality-hostile in aggregate; the platform
    // hint plus viewport is enough to tell two sessions apart in this demo.
    attributes['browser.user_agent'] = navigator.userAgent
  }

  if (typeof window !== 'undefined') {
    attributes['browser.viewport.width'] = window.innerWidth
    attributes['browser.viewport.height'] = window.innerHeight
    attributes['browser.timezone'] = Intl.DateTimeFormat().resolvedOptions().timeZone
  }

  return resourceFromAttributes(attributes)
}

/** URL patterns whose fetch calls must never be traced — chiefly OTLP export. */
function exportIgnoreUrls(): Array<string | RegExp> {
  const base = observabilityConfig.baseEndpoint
  if (!base) return []
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [new RegExp(`^${escaped}`)]
}

export function initTracing(): WebTracerProvider {
  if (provider) return provider

  const spanProcessors: SpanProcessor[] = [new UiSpanProcessor()]

  if (observabilityConfig.configured && observabilityConfig.endpoints.traces) {
    const exporter = instrumentExporter(
      new OTLPTraceExporter({
        url: observabilityConfig.endpoints.traces,
        headers: observabilityConfig.headers,
      }),
      'traces',
    )
    spanProcessors.push(
      new BatchSpanProcessor(exporter, {
        // Shorter than the 5s default so the Grafana/Tempo round trip feels live
        // when you click something and then go look at the trace.
        scheduledDelayMillis: 2_000,
        maxExportBatchSize: 128,
      }),
    )
  }

  provider = new WebTracerProvider({
    resource: buildResource(),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(observabilityConfig.sampleRate),
    }),
    spanProcessors,
  })

  // Registering the provider is what makes `trace.getTracer()` return real spans.
  provider.register()
  return provider
}

/**
 * Turn on the automatic instrumentations.
 *
 * Kept separate from `initTracing` so the provider exists before anything is
 * patched — instrumentations capture the provider at registration time.
 */
export function registerWebInstrumentations(tracerProvider: WebTracerProvider): string[] {
  if (instrumentationsRegistered) return []
  instrumentationsRegistered = true

  const instrumentations = [
    new DocumentLoadInstrumentation(),
    new FetchInstrumentation({
      // Never trace telemetry export itself. Without this the exporter's own
      // POSTs become spans, which then get exported, and so on.
      ignoreUrls: exportIgnoreUrls(),
      // Same-origin `/api/*` calls always propagate; the wildcard also covers
      // the separate-origin case when someone points the SPA at a remote API.
      propagateTraceHeaderCorsUrls: [/.*/],
      clearTimingResources: true,
      applyCustomAttributesOnSpan: (span, request, result) => {
        const url =
          typeof request === 'string'
            ? request
            : request instanceof URL
              ? request.href
              : 'url' in request
                ? request.url
                : undefined
        if (url) {
          try {
            span.setAttribute('app.request.path', new URL(url, location.origin).pathname)
          } catch {
            // A relative or malformed URL is not worth failing a span over.
          }
        }
        if (result && 'status' in result && typeof result.status === 'number') {
          span.setAttribute('app.response.status', result.status)
        }
      },
    }),
    new UserInteractionInstrumentation({
      eventNames: ['click', 'submit'],
    }),
    new LongTaskInstrumentation({
      observerCallback: (span, { longtaskEntry }) => {
        span.setAttribute('app.longtask.duration_ms', Math.round(longtaskEntry.duration))
      },
    }),
  ]

  registerInstrumentations({
    tracerProvider,
    instrumentations,
  })

  return instrumentations.map((instrumentation) => instrumentation.instrumentationName)
}

function tracer() {
  return trace.getTracer(TRACER_NAME, observabilityConfig.serviceVersion)
}

/**
 * Run `fn` inside a new active span.
 *
 * Contract: `fn` should reach its first `fetch` before awaiting anything, so the
 * fetch instrumentation sees the active context and nests correctly. Callers in
 * `src/api/client.ts` follow that rule.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => T | Promise<T>,
  options: { kind?: SpanKind } = {},
): Promise<T> {
  return tracer().startActiveSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes },
    async (span) => {
      try {
        const result = await fn(span)
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        recordException(span, error)
        throw error
      } finally {
        span.end()
      }
    },
  )
}

/** Record an exception on a span and mark it failed, following the OTel spec. */
export function recordException(span: Span, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  span.setStatus({ code: SpanStatusCode.ERROR, message })
  if (error instanceof Error) {
    span.recordException(error)
  } else {
    span.recordException({ name: 'Error', message })
  }
}

/** Add attributes to whatever span is currently active, if any. */
export function annotateActiveSpan(attributes: Attributes): void {
  const span = trace.getActiveSpan()
  if (!span) return
  span.setAttributes(attributes)
}

export function getTracerProvider(): WebTracerProvider | null {
  return provider
}
