import type {
  IncidentsResponse,
  MetricsResponse,
  ScenariosResponse,
  ServicesResponse,
  SimulationResult,
  TracesResponse,
} from '@simulator/types'
import { appLogger, recordApiCall, withSpan } from '@/observability'

/**
 * The one boundary between this React app and its backend.
 *
 * Every network call in the project goes through `request()` below. That is not
 * a stylistic preference — it is what makes the instrumentation honest. Because
 * there is exactly one place where `fetch` is called:
 *
 *   - every call produces a named span, with route and status attributes
 *   - every call is timed by a real histogram instrument
 *   - every failure is logged once, in one format, with its trace id
 *   - the OTel `fetch` instrumentation's own span nests inside ours rather than
 *     appearing from nowhere
 *
 * If components called `fetch` directly, all four of those would be aspirational
 * rather than true.
 */

const DEFAULT_TIMEOUT_MS = 10_000

/** Where the API lives. Same-origin by default — Vite proxies `/api` in dev. */
const API_BASE = '/api'

export type ApiRoute = '/services' | '/metrics' | '/traces' | '/incidents' | '/simulate'

export class ApiError extends Error {
  readonly status: number | null
  readonly route: string
  readonly detail: unknown

  constructor(message: string, options: { status: number | null; route: string; detail?: unknown }) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status
    this.route = options.route
    this.detail = options.detail ?? null
  }
}

interface QueryParams {
  [key: string]: string | number | boolean | undefined | null
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  query?: QueryParams
  body?: unknown
  timeoutMs?: number
}

function buildUrl(route: ApiRoute, query?: QueryParams): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const suffix = search.toString()
  return `${API_BASE}${route}${suffix ? `?${suffix}` : ''}`
}

/**
 * The absolute form of a request path.
 *
 * `url.full` is meant to be a resolvable URL per the HTTP semantic conventions,
 * and a relative path is not one. Falls back to the relative form in a
 * non-browser environment rather than throwing.
 */
function absoluteUrl(path: string): string {
  try {
    return new URL(path, globalThis.location?.origin ?? 'http://localhost').href
  } catch {
    return path
  }
}

/** Cheap classification so failures are countable by kind, not just by count. */
function classifyError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout'
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted'
  if (error instanceof TypeError) return 'network'
  if (error instanceof ApiError) return 'http_error'
  return 'unknown'
}

async function readErrorDetail(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    try {
      return await response.text()
    } catch {
      return null
    }
  }
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

async function request<T>(route: ApiRoute, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const url = buildUrl(route, options.query)

  return withSpan(
    `HTTP ${method} ${route}`,
    {
      'app.api.boundary': 'src/api/client.ts',
      'app.api.route': route,
      'http.request.method': method,
      'url.full': absoluteUrl(url),
    },
    async (span) => {
      const startedAt = performance.now()

      try {
        // `fetch` is invoked before any `await` so that it runs while this span
        // is the active context — that is what makes the instrumentation's own
        // span a child of ours instead of a sibling.
        const response = await fetch(url, {
          method,
          headers: {
            accept: 'application/json',
            ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        })

        const durationMs = performance.now() - startedAt
        span.setAttribute('app.api.duration_ms', round(durationMs))
        span.setAttribute('http.response.status_code', response.status)

        if (!response.ok) {
          const detail = await readErrorDetail(response)
          recordApiCall({
            route,
            method,
            status: response.status,
            durationMs,
            ok: false,
            errorType: 'http_error',
          })
          appLogger.error(`API ${method} ${route} failed with ${response.status}`, {
            'app.api.route': route,
            'http.response.status_code': response.status,
            'app.api.duration_ms': round(durationMs),
          })
          throw new ApiError(`Request to ${route} failed with HTTP ${response.status}`, {
            status: response.status,
            route,
            detail,
          })
        }

        const data = (await response.json()) as T
        recordApiCall({ route, method, status: response.status, durationMs, ok: true })
        appLogger.debug(`API ${method} ${route} ok in ${round(durationMs)}ms`, {
          'app.api.route': route,
          'app.api.duration_ms': round(durationMs),
          'http.response.status_code': response.status,
        })
        return data
      } catch (error) {
        // An ApiError thrown above is already recorded; do not double count it.
        if (error instanceof ApiError) throw error

        const durationMs = performance.now() - startedAt
        const errorType = classifyError(error)
        const message = error instanceof Error ? error.message : String(error)

        recordApiCall({ route, method, status: null, durationMs, ok: false, errorType })
        appLogger.error(`API ${method} ${route} failed: ${message}`, {
          'app.api.route': route,
          'error.type': errorType,
          'app.api.duration_ms': round(durationMs),
        })

        throw new ApiError(`Request to ${route} failed: ${message}`, {
          status: null,
          route,
          detail: { errorType },
        })
      }
    },
  )
}

/**
 * The API surface, as a typed object rather than loose functions, so that
 * "what can this app call?" has exactly one answer.
 */
export const api = {
  /** Service catalogue plus a health snapshot of each service. */
  getServices(scenarioId: string): Promise<ServicesResponse> {
    return request<ServicesResponse>('/services', { query: { scenario: scenarioId } })
  },

  /** Prometheus-style time series for the simulated estate. */
  getMetrics(
    scenarioId: string,
    options: { windowMinutes?: number; stepSeconds?: number } = {},
  ): Promise<MetricsResponse> {
    return request<MetricsResponse>('/metrics', {
      query: {
        scenario: scenarioId,
        window: options.windowMinutes ?? 30,
        step: options.stepSeconds ?? 30,
      },
    })
  },

  /** Synthesised distributed traces, shaped like OTLP. */
  getTraces(scenarioId: string, limit = 12): Promise<TracesResponse> {
    return request<TracesResponse>('/traces', { query: { scenario: scenarioId, limit } })
  },

  /** The incident feed. */
  getIncidents(scenarioId: string): Promise<IncidentsResponse> {
    return request<IncidentsResponse>('/incidents', { query: { scenario: scenarioId } })
  },

  /** The menu of available scenarios. */
  getScenarios(): Promise<ScenariosResponse & { activeScenarioId?: string }> {
    return request<ScenariosResponse & { activeScenarioId?: string }>('/simulate')
  },

  /** Switch the estate into a scenario and get the resulting state in one shot. */
  simulate(scenarioId: string): Promise<SimulationResult> {
    return request<SimulationResult>('/simulate', {
      method: 'POST',
      body: { scenarioId },
    })
  },
}

/**
 * Query keys, centralised.
 *
 * The active scenario is part of every key, which is what makes switching
 * scenarios refetch rather than serve stale data from a different world.
 */
export const queryKeys = {
  services: (scenarioId: string) => ['services', scenarioId] as const,
  metrics: (scenarioId: string, windowMinutes: number, stepSeconds: number) =>
    ['metrics', scenarioId, windowMinutes, stepSeconds] as const,
  traces: (scenarioId: string, limit: number) => ['traces', scenarioId, limit] as const,
  incidents: (scenarioId: string) => ['incidents', scenarioId] as const,
  scenarios: () => ['scenarios'] as const,
}

export type { ServicesResponse, MetricsResponse, TracesResponse, IncidentsResponse, SimulationResult }
