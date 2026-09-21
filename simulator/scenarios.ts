import type { Scenario } from './types.js'

/**
 * Scenario definitions.
 *
 * Pure data. The engine in `engine.ts` knows nothing about any specific scenario —
 * it just layers `perService` overrides on top of `global` overrides on top of the
 * catalog's baselines. Adding a new situation means adding an object here and
 * nothing else.
 *
 * `latencyFactor` multiplies every percentile; `errorRate` and `saturation` are
 * additive on top of the baseline; `trafficFactor` scales request rate.
 */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'baseline',
    name: 'Steady state',
    description: 'Nominal traffic, no active degradation.',
    narrative:
      'Everything is inside its error budget. This is the control case — if a chart looks wrong here, the chart is wrong, not the system.',
    expectedSeverity: null,
    global: {},
    perService: {},
  },
  {
    id: 'flash-sale',
    name: 'Flash sale',
    description: 'Traffic spike across the checkout path.',
    narrative:
      'A marketing push lands. Request rate triples at the edge and the whole checkout path picks up latency as connection pools fill. Nothing is broken yet — this is a capacity problem, not an availability one.',
    expectedSeverity: 'sev3',
    global: { trafficFactor: 2.8, latencyFactor: 1.35, saturation: 0.16 },
    perService: {
      'edge-gateway': { trafficFactor: 3.4, latencyFactor: 1.5, saturation: 0.22 },
      'checkout-api': { trafficFactor: 3.1, latencyFactor: 1.8, saturation: 0.27 },
      'payments-api': { trafficFactor: 2.6, latencyFactor: 2.1, saturation: 0.31 },
      'inventory-db': { trafficFactor: 2.4, saturation: 0.34 },
      'events-stream': { trafficFactor: 3.0, saturation: 0.3 },
    },
  },
  {
    id: 'cache-stampede',
    name: 'Cache stampede',
    description: 'cart-cache evicts hot keys; checkout thrashes the origin.',
    narrative:
      'A hot key set expires simultaneously. Every checkout request misses the cache and hits the origin at once. Cache hit rate collapses, checkout latency follows, and the errors that surface are timeouts rather than 5xx.',
    expectedSeverity: 'sev2',
    global: {},
    perService: {
      'cart-cache': { errorRate: 0.014, latencyFactor: 9, saturation: 0.62 },
      'checkout-api': { latencyFactor: 4.2, errorRate: 0.031, saturation: 0.48 },
      'inventory-api': { latencyFactor: 1.6, errorRate: 0.008, saturation: 0.29 },
      'edge-gateway': { latencyFactor: 2.4, errorRate: 0.019 },
    },
  },
  {
    id: 'payments-db-failover',
    name: 'Payments DB failover',
    description: 'Primary fails over; writes fail during promotion.',
    narrative:
      'The payments primary dies and the replica is promoted. Reads recover in seconds; writes fail for the duration of the promotion window. Ledger records queue up behind the outage and drain afterwards.',
    expectedSeverity: 'sev1',
    global: {},
    perService: {
      'payments-db': { errorRate: 0.42, latencyFactor: 6.5, saturation: 0.71 },
      'payments-api': { errorRate: 0.27, latencyFactor: 3.1, saturation: 0.58 },
      'checkout-api': { errorRate: 0.12, latencyFactor: 1.9 },
      'edge-gateway': { errorRate: 0.061, latencyFactor: 1.5 },
      'ledger-queue': { trafficFactor: 1.8, saturation: 0.35 },
      'ledger-worker': { errorRate: 0.09, latencyFactor: 2.2 },
    },
  },
  {
    id: 'retry-storm',
    name: 'Retry storm',
    description: 'Client retries amplify a small blip into an outage.',
    narrative:
      'catalog-api slows slightly. Clients retry aggressively with no backoff and no jitter, so the offered load grows faster than the slowdown. A 20% latency regression becomes a 4x traffic amplification.',
    expectedSeverity: 'sev2',
    global: {},
    perService: {
      'catalog-api': { latencyFactor: 2.6, errorRate: 0.021, saturation: 0.42 },
      'catalog-db': { trafficFactor: 3.6, saturation: 0.29 },
      'edge-gateway': { trafficFactor: 2.4, latencyFactor: 1.7, errorRate: 0.014 },
      'media-cache': { trafficFactor: 1.9 },
    },
  },
  {
    id: 'deploy-regression',
    name: 'Bad deploy',
    description: 'catalog-api v3.2.5 regresses p50 by 6x.',
    narrative:
      'A deploy ships an unindexed query. Median latency jumps immediately and uniformly — the signature of a regression rather than a load problem. Error rate is almost flat, which is exactly why the latency SLO is the thing that catches it.',
    expectedSeverity: 'sev3',
    global: {},
    perService: {
      'catalog-api': { latencyFactor: 6.4, errorRate: 0.004, saturation: 0.24 },
      'catalog-db': { latencyFactor: 2.8, saturation: 0.31 },
      'edge-gateway': { latencyFactor: 1.4 },
    },
  },
  {
    id: 'cascading-timeout',
    name: 'Cascading timeouts',
    description: 'inventory-api stalls; timeouts propagate to the edge.',
    narrative:
      'inventory-api stops responding within its deadline. checkout-api threads block waiting, its own callers time out, and the failure walks up the dependency graph one tier at a time. The only service actually broken is the one at the bottom.',
    expectedSeverity: 'sev1',
    global: {},
    perService: {
      'inventory-db': { latencyFactor: 12, errorRate: 0.18, saturation: 0.68 },
      'inventory-api': { latencyFactor: 9.5, errorRate: 0.34, saturation: 0.74 },
      'checkout-api': { latencyFactor: 5.1, errorRate: 0.22, saturation: 0.61 },
      'payments-api': { latencyFactor: 1.8, errorRate: 0.04 },
      'edge-gateway': { latencyFactor: 3.3, errorRate: 0.087, saturation: 0.44 },
      'recommendation-worker': { trafficFactor: 0.4, errorRate: 0.06 },
    },
  },
]

export const DEFAULT_SCENARIO_ID = 'baseline'

const SCENARIO_BY_ID: ReadonlyMap<string, Scenario> = new Map(
  SCENARIOS.map((scenario) => [scenario.id, scenario]),
)

/** Resolve a scenario id, falling back to the default rather than throwing. */
export function resolveScenario(id: string | null | undefined): Scenario {
  if (id) {
    const found = SCENARIO_BY_ID.get(id)
    if (found) return found
  }
  return SCENARIO_BY_ID.get(DEFAULT_SCENARIO_ID)!
}

/** True when `id` names a real scenario. Used to reject bad query params. */
export function isScenarioId(id: string): boolean {
  return SCENARIO_BY_ID.has(id)
}
