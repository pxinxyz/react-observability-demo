import { SERVICE_CATALOG } from './catalog'
import { between, clamp, hashString, mulberry32, round, timeBucket } from './random'
import { resolveScenario } from './scenarios'
import type {
  Incident,
  IncidentEvent,
  IncidentSeverity,
  IncidentsResponse,
  MetricPoint,
  MetricsResponse,
  MetricSeries,
  Scenario,
  ScenarioFailure,
  ServiceHealth,
  ServiceSnapshot,
  SimulatedTrace,
  SpanStatus,
  TelemetrySummary,
  TraceSpan,
  TracesResponse,
} from './types'

/** The simulated world only changes every 15 seconds. */
const SERVICE_BUCKET_MS = 15_000
/** Incident and trace fixtures change more slowly still. */
const SLOW_BUCKET_MS = 120_000

/** PRNG seeded by the scenario, the thing being generated, and the time bucket. */
function seeded(scenarioId: string, ...parts: Array<string | number>): () => number {
  return mulberry32(hashString([scenarioId, ...parts].join(':')))
}

function failureFor(scenario: Scenario, serviceId: string): ScenarioFailure {
  return scenario.perService[serviceId] ?? {}
}

function deriveHealth(errorRate: number, saturation: number, p95Ms: number): ServiceHealth {
  if (errorRate >= 0.05 || saturation >= 0.85 || p95Ms >= 2000) return 'critical'
  if (errorRate >= 0.01 || saturation >= 0.7 || p95Ms >= 800) return 'degraded'
  return 'healthy'
}

/**
 * Roll the catalog forward to a point in time under a given scenario.
 *
 * Every service gets jitter proportional to its own baseline, then the scenario's
 * overrides are layered on. The jitter is what stops the table looking synthetic:
 * a datastore and a gateway do not wobble by the same absolute amount.
 */
export function buildServices(scenario: Scenario, now: number): ServiceSnapshot[] {
  const bucket = timeBucket(now, SERVICE_BUCKET_MS)

  return SERVICE_CATALOG.map((descriptor) => {
    const rand = seeded(scenario.id, descriptor.id, bucket)
    const failure = failureFor(scenario, descriptor.id)
    const base = descriptor.baseline

    // ±6% jitter on traffic, ±9% on latency. Enough to look alive, not enough
    // to make the scenario unrecognisable.
    const trafficJitter = between(rand, 0.94, 1.06)
    const latencyJitter = between(rand, 0.91, 1.09)

    const requestRate = round(base.rps * trafficJitter * (failure.trafficFactor ?? 1), 1)
    const errorRate = clamp(
      base.errorRate + (failure.errorRate ?? 0) + between(rand, -0.0004, 0.0004),
      0,
      1,
    )
    const saturation = clamp(
      base.saturation + (failure.saturation ?? 0) + between(rand, -0.02, 0.02),
      0,
      1,
    )

    const p50Ms = round(base.p50Ms * latencyJitter * (failure.latencyFactor ?? 1), 1)
    // Real p95/p99 relationships are multiplicative and heavy-tailed.
    const p95Ms = round(p50Ms * between(rand, 2.0, 2.5), 1)
    const p99Ms = round(p50Ms * between(rand, 3.4, 4.4), 1)

    const health = deriveHealth(errorRate, saturation, p95Ms)

    // The error budget burns in proportion to how far past the SLO target we are.
    const slo = { target: descriptor.kind === 'datastore' ? 0.9995 : 0.999, budgetRemaining: 0 }
    const observedAvailability = 1 - errorRate
    const burn = slo.target > 0 ? clamp((slo.target - observedAvailability) / slo.target, 0, 1) : 0
    slo.budgetRemaining = round(clamp(1 - burn * between(rand, 0.8, 1.2), 0, 1), 4)

    // Deploys are stable per service per hour, not per request.
    const deployRand = seeded(scenario.id, descriptor.id, 'deploy', timeBucket(now, 3_600_000))
    const minutesAgo = Math.floor(between(deployRand, 12, 2880))

    return {
      ...descriptor,
      health,
      requestRate,
      errorRate: round(errorRate, 5),
      p50Ms,
      p95Ms,
      p99Ms,
      saturation: round(saturation, 3),
      instances: descriptor.baseline.instances + (failure.trafficFactor && failure.trafficFactor > 2 ? 2 : 0),
      lastDeployAt: new Date(now - minutesAgo * 60_000).toISOString(),
      slo,
    }
  })
}

export function buildSummary(
  scenario: Scenario,
  services: ServiceSnapshot[],
  windowMinutes: number,
  now: number,
): TelemetrySummary {
  const edge = services.find((service) => service.tier === 1 && service.kind === 'gateway')
  const totalRps = services.reduce((sum, service) => sum + service.requestRate, 0)
  const weightedError =
    services.reduce((sum, service) => sum + service.errorRate * service.requestRate, 0) /
    (totalRps || 1)
  const p95 = edge?.p95Ms ?? round(services.reduce((m, s) => Math.max(m, s.p95Ms), 0), 1)

  return {
    scenarioId: scenario.id,
    generatedAt: new Date(now).toISOString(),
    windowMinutes,
    services: {
      total: services.length,
      healthy: services.filter((s) => s.health === 'healthy').length,
      degraded: services.filter((s) => s.health === 'degraded').length,
      critical: services.filter((s) => s.health === 'critical').length,
    },
    traffic: {
      requestsPerSecond: round(totalRps, 0),
      errorRate: round(weightedError, 5),
      p95Ms: p95,
    },
    incidents: {
      open: countOpenIncidents(scenario, now),
      worstSeverity: scenario.expectedSeverity,
    },
    availability: round(clamp(1 - weightedError, 0, 1), 5),
    sloTarget: 0.999,
  }
}

function countOpenIncidents(scenario: Scenario, now: number): number {
  return buildIncidents(scenario, now).incidents.filter((i) => i.status !== 'resolved').length
}

/* ── Metrics ─────────────────────────────────────────────────────────────── */

interface SeriesSpec {
  name: string
  unit: string
  description: string
  /** Value at rest, before the scenario is applied. */
  baseline: number
  /** How much of the estate's degradation leaks into this series, 0..1. */
  sensitivity: number
}

const SERIES_SPECS: readonly SeriesSpec[] = [
  {
    name: 'http_requests_per_second',
    unit: 'req/s',
    description: 'Total offered load across the estate.',
    baseline: 7800,
    sensitivity: 1,
  },
  {
    name: 'http_request_error_rate',
    unit: 'ratio',
    description: '5xx and timeout responses as a fraction of all responses.',
    baseline: 0.002,
    sensitivity: 6,
  },
  {
    name: 'http_request_duration_p95',
    unit: 'ms',
    description: '95th percentile server-side request duration.',
    baseline: 46,
    sensitivity: 4,
  },
  {
    name: 'http_request_duration_p50',
    unit: 'ms',
    description: 'Median server-side request duration.',
    baseline: 18,
    sensitivity: 3,
  },
  {
    name: 'process_cpu_saturation',
    unit: 'ratio',
    description: 'CPU throttling pressure averaged across all pods.',
    baseline: 0.41,
    sensitivity: 0.9,
  },
  {
    name: 'cache_hit_ratio',
    unit: 'ratio',
    description: 'Cache hits as a fraction of lookups.',
    baseline: 0.94,
    sensitivity: -0.7,
  },
  {
    name: 'queue_consumer_lag',
    unit: 'messages',
    description: 'Undelivered messages across all consumer groups.',
    baseline: 340,
    sensitivity: 5,
  },
  {
    name: 'db_connection_pool_utilisation',
    unit: 'ratio',
    description: 'Checked-out connections as a fraction of pool size.',
    baseline: 0.38,
    sensitivity: 1.4,
  },
]

/**
 * Build a metric window.
 *
 * Each point is seeded by its own timestamp, so the shape of the history is
 * stable across refetches while still varying smoothly from point to point.
 */
export function buildMetrics(
  scenario: Scenario,
  services: ServiceSnapshot[],
  windowMinutes: number,
  stepSeconds: number,
  now: number,
): MetricsResponse {
  const stepMs = stepSeconds * 1000
  const pointCount = Math.floor((windowMinutes * 60_000) / stepMs) + 1
  const end = timeBucket(now, stepMs)
  const start = end - (pointCount - 1) * stepMs

  // A single scalar describing how bad things are right now, used to drive all series.
  const degradation =
    services.reduce((sum, s) => sum + s.errorRate * 12 + (s.saturation - 0.35) * 0.6, 0) /
    (services.length || 1)

  const series: MetricSeries[] = SERIES_SPECS.map((spec) => {
    const points: MetricPoint[] = []

    for (let i = 0; i < pointCount; i += 1) {
      const t = start + i * stepMs
      const rand = seeded(scenario.id, spec.name, t)

      // Scenario effects ramp in rather than snapping on, so charts show a
      // believable onset instead of a step function.
      const progress = pointCount <= 1 ? 1 : i / (pointCount - 1)
      const ramp = 0.35 + 0.65 * progress

      const jitter = between(rand, 0.93, 1.07)
      const wave = 1 + 0.05 * Math.sin((t / 60_000) * 0.7 + spec.baseline)

      // A negative sensitivity means degradation pushes the series *down*
      // (cache hit ratio being the obvious one).
      const delta = degradation * spec.sensitivity * ramp
      const ceiling = spec.unit === 'ratio' ? 1 : Number.MAX_SAFE_INTEGER

      points.push({
        t,
        v: round(clamp(spec.baseline * (1 + delta) * jitter * wave, 0, ceiling), 4),
      })
    }

    return { name: spec.name, unit: spec.unit, description: spec.description, points }
  })

  return {
    scenarioId: scenario.id,
    windowMinutes,
    stepSeconds,
    generatedAt: new Date(now).toISOString(),
    series,
  }
}

/* ── Traces ──────────────────────────────────────────────────────────────── */

function spanStatusFor(service: ServiceSnapshot, rand: () => number): SpanStatus {
  return rand() < service.errorRate * 3 ? 'error' : 'ok'
}

const OPERATIONS: Record<string, string[]> = {
  gateway: ['HTTP GET /api/v1/checkout', 'HTTP POST /api/v1/cart', 'HTTP GET /api/v1/catalog'],
  api: ['GET /v1/resource', 'POST /v1/resource', 'handler.dispatch'],
  worker: ['consume batch', 'process message', 'flush offsets'],
  datastore: ['SELECT', 'INSERT', 'UPDATE'],
  cache: ['GET', 'MGET', 'SET'],
  queue: ['publish', 'fetch', 'ack'],
}

/** Synthesise a trace by walking the dependency graph from the edge service. */
export function buildTraces(
  scenario: Scenario,
  services: ServiceSnapshot[],
  count: number,
  now: number,
): TracesResponse {
  const bucket = timeBucket(now, SERVICE_BUCKET_MS)
  const byId = new Map(services.map((service) => [service.id, service]))
  const traces: SimulatedTrace[] = []

  for (let n = 0; n < count; n += 1) {
    const rand = seeded(scenario.id, 'trace', bucket, n)
    const entry = byId.get('edge-gateway')
    if (!entry) continue

    const spans: TraceSpan[] = []
    const startedAt = now - Math.floor(between(rand, 0, 90_000))

    const visit = (
      service: ServiceSnapshot,
      parentSpanId: string | null,
      offsetMs: number,
      depth: number,
    ): number => {
      if (depth > 4) return 0
      const spanRand = seeded(scenario.id, 'span', bucket, n, service.id, depth)
      const spanId = Math.floor(spanRand() * 0xffffffff).toString(16).padStart(8, '0')

      const operation = OPERATIONS[service.kind] ?? ['handle']
      const name = operation[Math.floor(spanRand() * operation.length)] ?? 'handle'
      const durationMs = round(service.p50Ms * between(spanRand, 0.8, 2.4), 1)
      const status = spanStatusFor(service, spanRand)

      const span: TraceSpan = {
        spanId,
        parentSpanId,
        name,
        serviceId: service.id,
        serviceName: service.name,
        offsetMs: round(offsetMs, 1),
        durationMs,
        kind: service.kind === 'queue' ? 'producer' : depth === 0 ? 'server' : 'client',
        status,
        attributes: {
          'service.version': service.version,
          'service.tier': service.tier,
          'deployment.environment.name': 'simulated',
          ...(status === 'error' ? { 'error.type': 'UpstreamTimeout' } : {}),
        },
      }
      spans.push(span)

      // Children start shortly after the parent and must fit inside its duration.
      let cursor = offsetMs + between(spanRand, 0.4, 1.6)
      let maxChildEnd = offsetMs
      for (const childId of service.dependsOn) {
        const child = byId.get(childId)
        if (!child) continue
        const childEnd = visit(child, spanId, cursor, depth + 1)
        maxChildEnd = Math.max(maxChildEnd, childEnd)
        cursor += between(spanRand, 0.5, 2.5)
      }

      // Widen the parent if its children genuinely ran past it, so the waterfall
      // never renders a child escaping its parent's bar.
      const ownEnd = offsetMs + durationMs
      if (maxChildEnd > ownEnd) {
        span.durationMs = round(maxChildEnd - offsetMs + between(spanRand, 1, 5), 1)
      }

      return offsetMs + span.durationMs
    }

    const totalMs = visit(entry, null, 0, 0)
    const root = spans[0]
    const hasError = spans.some((span) => span.status === 'error')

    traces.push({
      traceId: Array.from({ length: 4 }, () =>
        Math.floor(rand() * 0xffffffff)
          .toString(16)
          .padStart(8, '0'),
      ).join(''),
      rootName: root?.name ?? 'HTTP GET /',
      serviceName: entry.name,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: round(totalMs, 1),
      status: hasError ? 'error' : 'ok',
      spans,
    })
  }

  return {
    scenarioId: scenario.id,
    generatedAt: new Date(now).toISOString(),
    traces,
  }
}

/* ── Incidents ───────────────────────────────────────────────────────────── */

const INCIDENT_FIXTURES: Record<
  string,
  { title: string; summary: string; serviceIds: string[]; status: Incident['status'] }
> = {
  baseline: {
    title: 'Elevated 5xx on catalog-api after routine restart',
    summary:
      'A rolling restart briefly took the catalog connection pool below its steady-state size. Error rate returned to baseline without intervention; the alert auto-resolved.',
    serviceIds: ['catalog-api', 'catalog-db'],
    status: 'resolved',
  },
  'flash-sale': {
    title: 'Checkout latency above SLO during promotional traffic',
    summary:
      'Offered load roughly tripled within four minutes of the campaign going live. Connection pool wait time on checkout-api is the dominant contributor to the latency increase.',
    serviceIds: ['edge-gateway', 'checkout-api', 'payments-api'],
    status: 'monitoring',
  },
  'cache-stampede': {
    title: 'cart-cache hit ratio collapse causing origin overload',
    summary:
      'A large hot key set expired on the same second. Origin request volume rose by an order of magnitude and checkout-api began shedding load with 504s.',
    serviceIds: ['cart-cache', 'checkout-api', 'inventory-api'],
    status: 'mitigating',
  },
  'payments-db-failover': {
    title: 'Payments writes failing during primary promotion',
    summary:
      'The payments primary became unreachable and the replica was promoted. Reads recovered first; write traffic failed for the duration of the promotion. Ledger messages accumulated and are draining.',
    serviceIds: ['payments-db', 'payments-api', 'ledger-worker', 'checkout-api'],
    status: 'open',
  },
  'retry-storm': {
    title: 'Traffic amplification from unbounded client retries',
    summary:
      'A modest latency regression on catalog-api triggered retries from callers without backoff or jitter. Offered load grew faster than the underlying slowdown.',
    serviceIds: ['catalog-api', 'catalog-db', 'edge-gateway'],
    status: 'mitigating',
  },
  'deploy-regression': {
    title: 'catalog-api p50 regression following release 3.2.5',
    summary:
      'Median latency increased by roughly sixfold immediately after deploy. Error rate is essentially unchanged, consistent with an inefficient query path rather than a failure.',
    serviceIds: ['catalog-api', 'catalog-db'],
    status: 'open',
  },
  'cascading-timeout': {
    title: 'inventory-api stall propagating to the edge',
    summary:
      'inventory-api stopped meeting its deadline. Callers exhausted their thread pools waiting and began timing out in turn, walking the failure up the dependency graph one tier at a time.',
    serviceIds: ['inventory-db', 'inventory-api', 'checkout-api', 'edge-gateway'],
    status: 'open',
  },
}

const SEVERITY_BY_SCENARIO: Record<string, IncidentSeverity> = {
  baseline: 'sev4',
  'flash-sale': 'sev3',
  'cache-stampede': 'sev2',
  'payments-db-failover': 'sev1',
  'retry-storm': 'sev2',
  'deploy-regression': 'sev3',
  'cascading-timeout': 'sev1',
}

export function buildIncidents(scenario: Scenario, now: number): IncidentsResponse {
  const fixture = INCIDENT_FIXTURES[scenario.id] ?? INCIDENT_FIXTURES['baseline']!
  const severity = SEVERITY_BY_SCENARIO[scenario.id] ?? 'sev4'
  const bucket = timeBucket(now, SLOW_BUCKET_MS)

  const incidents: Incident[] = []
  const isCalm = scenario.id === 'baseline'

  // A calm estate still has history — one resolved incident in the recent past.
  const count = isCalm ? 1 : 2

  for (let i = 0; i < count; i += 1) {
    const rand = seeded(scenario.id, 'incident', bucket, i)
    const isPrimary = i === 0

    if (!isPrimary && isCalm) continue

    const startedMinutesAgo = isPrimary
      ? Math.floor(between(rand, 8, 55))
      : Math.floor(between(rand, 240, 1600))

    const startedAt = now - startedMinutesAgo * 60_000
    const detectedAt = startedAt + Math.floor(between(rand, 1, 4)) * 60_000

    const status: Incident['status'] = isPrimary
      ? fixture.status
      : 'resolved'

    const resolvedAt =
      status === 'resolved'
        ? new Date(startedAt + Math.floor(between(rand, 14, 95)) * 60_000).toISOString()
        : null

    const durationMinutes = Math.max(
      1,
      Math.round(
        ((resolvedAt ? new Date(resolvedAt).getTime() : now) - startedAt) / 60_000,
      ),
    )

    const timeline: IncidentEvent[] = [
      {
        at: new Date(startedAt).toISOString(),
        actor: 'system',
        note: `First anomalous signal detected on ${fixture.serviceIds[0] ?? 'edge-gateway'}.`,
      },
      {
        at: new Date(detectedAt).toISOString(),
        actor: 'alertmanager',
        note: `Alert fired: ${fixture.title}`,
      },
    ]

    if (severity === 'sev1' || severity === 'sev2') {
      timeline.push({
        at: new Date(detectedAt + 3 * 60_000).toISOString(),
        actor: 'on-call',
        note: 'Acknowledged. Incident channel opened, responders paged.',
      })
      timeline.push({
        at: new Date(detectedAt + 9 * 60_000).toISOString(),
        actor: 'on-call',
        note: 'Mitigation applied. Monitoring for recovery.',
      })
    }

    if (resolvedAt) {
      timeline.push({
        at: resolvedAt,
        actor: 'system',
        note: 'Error rate and latency back inside SLO. Auto-resolving.',
      })
    } else {
      timeline.push({
        at: new Date(now - 2 * 60_000).toISOString(),
        actor: 'on-call',
        note: 'Still degraded. Continuing to investigate.',
      })
    }

    const peakErrorRate = round(
      isPrimary ? between(rand, 0.04, 0.31) * (severity === 'sev1' ? 2.4 : 1) : between(rand, 0.01, 0.06),
      4,
    )

    incidents.push({
      id: `INC-${String(Math.floor(between(rand, 1000, 9999)))}`,
      title: isPrimary ? fixture.title : 'Transient latency spike on catalog-api',
      severity: isPrimary ? severity : 'sev4',
      status,
      serviceIds: isPrimary ? fixture.serviceIds : ['catalog-api'],
      summary: isPrimary
        ? fixture.summary
        : 'A short-lived latency spike with no error-rate impact. Resolved without intervention.',
      startedAt: new Date(startedAt).toISOString(),
      detectedAt: new Date(detectedAt).toISOString(),
      resolvedAt,
      durationMinutes,
      impact: {
        peakErrorRate: clamp(peakErrorRate, 0, 1),
        affectedRequests: Math.round(peakErrorRate * 420 * durationMinutes * 60),
      },
      timeline: timeline.sort((a, b) => a.at.localeCompare(b.at)),
    })
  }

  return {
    scenarioId: scenario.id,
    generatedAt: new Date(now).toISOString(),
    incidents: incidents.sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
  }
}

/**
 * Convenience bundle used by `/api/simulate`, which needs to return a whole
 * estate in one shot rather than making the client fan out.
 */
export function buildEstate(scenarioId: string, now: number = Date.now()) {
  const scenario = resolveScenario(scenarioId)
  const services = buildServices(scenario, now)
  return { scenario, services, summary: buildSummary(scenario, services, 60, now) }
}
