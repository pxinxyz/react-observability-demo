import type { SignalName } from './types'

/**
 * Configuration, resolved once at module load from Vite's build-time env.
 *
 * `VITE_OTLP_ENDPOINT` is the whole integration. Leave it unset and every
 * exporter is disabled — the app still runs, still renders, and says plainly
 * in the Observability panel that it is not shipping anything anywhere.
 */

export interface ObservabilityConfig {
  /** True when a syntactically usable endpoint was provided. */
  configured: boolean
  baseEndpoint: string | null
  endpoints: Record<SignalName, string | null>
  headers: Record<string, string>
  serviceName: string
  serviceVersion: string
  environment: string
  sampleRate: number
  metricExportIntervalMs: number
  grafanaUrl: string | null
}

/**
 * Turn a base endpoint into a signal-specific OTLP URL.
 *
 * This is necessary rather than cosmetic: the OTLP HTTP exporters use a
 * user-supplied `url` verbatim and do *not* append the signal path. Passing
 * `http://localhost:4318` to `OTLPTraceExporter` would POST to `/` and 404.
 *
 * Also tolerates someone pasting a full signal URL into the env var, which is
 * an easy mistake to make and should not silently produce `/v1/traces/v1/traces`.
 */
export function signalUrl(base: string, signal: SignalName): string {
  const trimmed = base.trim().replace(/\/+$/, '')
  // Strip a trailing `/v1` or `/v1/<signal>` so both base and full URLs work.
  const withoutSignal = trimmed.replace(/\/v1(\/(traces|metrics|logs))?$/, '')
  return `${withoutSignal}/v1/${signal}`
}

/** Parse `key=value,key2=value2` into a header map. Malformed pairs are skipped. */
export function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  const headers: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const trimmed = pair.trim()
    if (!trimmed) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (key) headers[key] = value
  }
  return headers
}

function readSampleRate(raw: string | undefined): number {
  const parsed = Number(raw ?? '1')
  if (!Number.isFinite(parsed)) return 1
  return Math.min(1, Math.max(0, parsed))
}

function readInterval(raw: string | undefined): number {
  const parsed = Number(raw ?? '10000')
  if (!Number.isFinite(parsed) || parsed < 1000) return 10_000
  return Math.min(parsed, 300_000)
}

function resolveConfig(): ObservabilityConfig {
  const env = import.meta.env
  const rawEndpoint = env.VITE_OTLP_ENDPOINT?.trim() ?? ''
  const configured = rawEndpoint.length > 0

  const serviceName = env.VITE_SERVICE_NAME?.trim() || 'react-observability-demo'
  const serviceVersion = env.VITE_SERVICE_VERSION?.trim() || '0.1.0'
  const environment = env.VITE_DEPLOYMENT_ENVIRONMENT?.trim() || (import.meta.env.PROD ? 'production' : 'development')

  return {
    configured,
    baseEndpoint: configured ? rawEndpoint : null,
    endpoints: {
      traces: configured ? signalUrl(rawEndpoint, 'traces') : null,
      metrics: configured ? signalUrl(rawEndpoint, 'metrics') : null,
      logs: configured ? signalUrl(rawEndpoint, 'logs') : null,
    },
    headers: parseHeaders(env.VITE_OTLP_HEADERS),
    serviceName,
    serviceVersion,
    environment,
    sampleRate: readSampleRate(env.VITE_TRACES_SAMPLE_RATE),
    metricExportIntervalMs: readInterval(env.VITE_METRIC_EXPORT_INTERVAL),
    grafanaUrl: env.VITE_GRAFANA_URL?.trim() || null,
  }
}

export const observabilityConfig: ObservabilityConfig = resolveConfig()
