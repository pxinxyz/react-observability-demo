/**
 * Shared types for the simulated telemetry backend.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS FIRST: everything in `simulator/` is FABRICATED.
 *
 * No production system is being observed. These types describe a plausible
 * microservice estate that is generated on demand from a seeded PRNG so that
 * the dashboard has something stable to render without anyone needing to
 * deploy eight real services.
 *
 * What is REAL in this project is the telemetry the *browser* emits about
 * itself — those are genuine OTLP spans, metrics and logs. See `src/observability/`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type ServiceHealth = 'healthy' | 'degraded' | 'critical'

export type ServiceKind = 'gateway' | 'api' | 'worker' | 'datastore' | 'cache' | 'queue'

export type SpanStatus = 'ok' | 'error'

export type SpanKind = 'server' | 'client' | 'producer' | 'consumer' | 'internal'

/** Steady-state characteristics of a service. Stable across requests. */
export interface ServiceBaseline {
  /** Requests per second at rest. */
  rps: number
  /** Median latency in milliseconds at rest. */
  p50Ms: number
  /** Error rate at rest, 0..1. */
  errorRate: number
  /** Resource saturation at rest, 0..1. */
  saturation: number
  instances: number
}

/** A service in the fabricated estate. Stable across requests. */
export interface ServiceDescriptor {
  id: string
  name: string
  kind: ServiceKind
  language: string
  version: string
  /** Dependency tier — 1 is closest to the edge. */
  tier: 1 | 2 | 3
  /** IDs of services this one calls. */
  dependsOn: string[]
  baseline: ServiceBaseline
}

/** A descriptor plus a point-in-time observation. Changes as the scenario changes. */
export interface ServiceSnapshot extends ServiceDescriptor {
  health: ServiceHealth
  /** Requests per second. */
  requestRate: number
  /** Errors as a fraction of requests, 0..1. */
  errorRate: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  /** Resource saturation, 0..1. */
  saturation: number
  instances: number
  lastDeployAt: string
  slo: {
    /** Target availability as a fraction, e.g. 0.999. */
    target: number
    /** Fraction of the error budget still unspent, 0..1. */
    budgetRemaining: number
  }
}

export interface MetricPoint {
  /** Unix epoch milliseconds. */
  t: number
  v: number
}

export interface MetricSeries {
  /** Prometheus-style metric name. */
  name: string
  unit: string
  /** Human-readable description, surfaced as a chart subtitle. */
  description: string
  points: MetricPoint[]
}

export interface MetricsResponse {
  scenarioId: string
  windowMinutes: number
  stepSeconds: number
  generatedAt: string
  series: MetricSeries[]
}

export interface TraceSpan {
  spanId: string
  parentSpanId: string | null
  name: string
  serviceId: string
  serviceName: string
  /** Milliseconds since the trace started. */
  offsetMs: number
  durationMs: number
  kind: SpanKind
  status: SpanStatus
  attributes: Record<string, string | number | boolean>
}

export interface SimulatedTrace {
  traceId: string
  rootName: string
  serviceName: string
  startedAt: string
  durationMs: number
  status: SpanStatus
  spans: TraceSpan[]
}

export interface TracesResponse {
  scenarioId: string
  generatedAt: string
  traces: SimulatedTrace[]
}

export type IncidentSeverity = 'sev1' | 'sev2' | 'sev3' | 'sev4'

export type IncidentStatus = 'open' | 'mitigating' | 'monitoring' | 'resolved'

export interface IncidentEvent {
  at: string
  actor: string
  note: string
}

export interface Incident {
  id: string
  title: string
  severity: IncidentSeverity
  status: IncidentStatus
  serviceIds: string[]
  summary: string
  startedAt: string
  detectedAt: string
  resolvedAt: string | null
  /** Minutes from `startedAt` to `resolvedAt`, or to now if still open. */
  durationMinutes: number
  impact: {
    /** Peak user-facing error rate during the incident, 0..1. */
    peakErrorRate: number
    affectedRequests: number
  }
  timeline: IncidentEvent[]
}

export interface IncidentsResponse {
  scenarioId: string
  generatedAt: string
  incidents: Incident[]
}

/** The roll-up shown in the header tiles and on the Overview page. */
export interface TelemetrySummary {
  scenarioId: string
  generatedAt: string
  windowMinutes: number
  services: {
    total: number
    healthy: number
    degraded: number
    critical: number
  }
  traffic: {
    requestsPerSecond: number
    errorRate: number
    p95Ms: number
  }
  incidents: {
    open: number
    worstSeverity: IncidentSeverity | null
  }
  /** Aggregate availability across the estate for the window, 0..1. */
  availability: number
  sloTarget: number
}

export interface ScenarioFailure {
  /** Fraction of requests that fail outright, 0..1. Added to the baseline. */
  errorRate?: number
  /** Multiplier applied to every latency percentile. */
  latencyFactor?: number
  /** Additional saturation, 0..1. */
  saturation?: number
  /** Additional requests per second. */
  trafficFactor?: number
}

/**
 * A named situation the estate can be in.
 *
 * Scenarios are pure data — no code paths, no branching per scenario. The engine
 * applies `perService` overrides on top of `global`, so adding a scenario is a
 * matter of adding an entry to `simulator/scenarios.ts`.
 */
export interface Scenario {
  id: string
  name: string
  /** One line, shown in the scenario picker. */
  description: string
  /** Longer explanation, shown once a scenario is active. */
  narrative: string
  /** Default incident severity this scenario is expected to produce. */
  expectedSeverity: IncidentSeverity | null
  global: ScenarioFailure
  perService: Record<string, ScenarioFailure>
}

/** The union of everything `/api/simulate` can return. */
export interface SimulationResult {
  scenario: Scenario
  services: ServiceSnapshot[]
  summary: TelemetrySummary
}

/** `GET /api/services` */
export interface ServicesResponse {
  scenarioId: string
  generatedAt: string
  services: ServiceSnapshot[]
  summary: TelemetrySummary
}

/** `GET /api/simulate` — the menu of available scenarios. */
export interface ScenariosResponse {
  generatedAt: string
  defaultScenarioId: string
  scenarios: Scenario[]
}
