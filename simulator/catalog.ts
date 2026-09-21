import type { ServiceDescriptor } from './types'

/**
 * The fabricated estate.
 *
 * A plausible three-tier commerce topology: an edge gateway fanning out to
 * domain APIs, which lean on datastores, caches and queues. Deliberately
 * includes a queue and a worker so trace waterfalls have something interesting
 * to show across async boundaries.
 *
 * None of this exists. See the header of `simulator/types.ts`.
 */
export const SERVICE_CATALOG: readonly ServiceDescriptor[] = [
  {
    id: 'edge-gateway',
    name: 'edge-gateway',
    kind: 'gateway',
    language: 'Go 1.24',
    version: '4.11.2',
    tier: 1,
    dependsOn: ['checkout-api', 'catalog-api', 'identity-api'],
    baseline: { rps: 1840, p50Ms: 12, errorRate: 0.0004, saturation: 0.31, instances: 12 },
  },
  {
    id: 'checkout-api',
    name: 'checkout-api',
    kind: 'api',
    language: 'TypeScript 5.9 / Node 22',
    version: '2.7.0',
    tier: 1,
    dependsOn: ['payments-api', 'inventory-api', 'cart-cache'],
    baseline: { rps: 420, p50Ms: 38, errorRate: 0.0011, saturation: 0.44, instances: 8 },
  },
  {
    id: 'catalog-api',
    name: 'catalog-api',
    kind: 'api',
    language: 'Rust 1.91',
    version: '3.2.5',
    tier: 1,
    dependsOn: ['catalog-db', 'media-cache'],
    baseline: { rps: 960, p50Ms: 21, errorRate: 0.0006, saturation: 0.38, instances: 10 },
  },
  {
    id: 'identity-api',
    name: 'identity-api',
    kind: 'api',
    language: 'Python 3.13',
    version: '1.19.4',
    tier: 1,
    dependsOn: ['identity-db', 'session-cache'],
    baseline: { rps: 610, p50Ms: 29, errorRate: 0.0009, saturation: 0.29, instances: 6 },
  },
  {
    id: 'payments-api',
    name: 'payments-api',
    kind: 'api',
    language: 'Java 25',
    version: '5.4.1',
    tier: 2,
    dependsOn: ['payments-db', 'ledger-queue'],
    baseline: { rps: 310, p50Ms: 74, errorRate: 0.0018, saturation: 0.52, instances: 8 },
  },
  {
    id: 'inventory-api',
    name: 'inventory-api',
    kind: 'api',
    language: 'Go 1.24',
    version: '2.2.9',
    tier: 2,
    dependsOn: ['inventory-db'],
    baseline: { rps: 355, p50Ms: 47, errorRate: 0.0013, saturation: 0.47, instances: 6 },
  },
  {
    id: 'ledger-worker',
    name: 'ledger-worker',
    kind: 'worker',
    language: 'Rust 1.91',
    version: '1.8.3',
    tier: 2,
    dependsOn: ['ledger-queue', 'ledger-db'],
    baseline: { rps: 96, p50Ms: 132, errorRate: 0.0022, saturation: 0.41, instances: 4 },
  },
  {
    id: 'recommendation-worker',
    name: 'recommendation-worker',
    kind: 'worker',
    language: 'Python 3.13',
    version: '0.14.7',
    tier: 3,
    dependsOn: ['events-stream', 'model-store'],
    baseline: { rps: 54, p50Ms: 288, errorRate: 0.0031, saturation: 0.58, instances: 3 },
  },
  {
    id: 'catalog-db',
    name: 'catalog-db',
    kind: 'datastore',
    language: 'PostgreSQL 18',
    version: '18.1',
    tier: 3,
    dependsOn: [],
    baseline: { rps: 1420, p50Ms: 8, errorRate: 0.0002, saturation: 0.62, instances: 3 },
  },
  {
    id: 'identity-db',
    name: 'identity-db',
    kind: 'datastore',
    language: 'PostgreSQL 18',
    version: '18.1',
    tier: 3,
    dependsOn: [],
    baseline: { rps: 690, p50Ms: 6, errorRate: 0.0002, saturation: 0.44, instances: 3 },
  },
  {
    id: 'payments-db',
    name: 'payments-db',
    kind: 'datastore',
    language: 'PostgreSQL 18',
    version: '18.1',
    tier: 3,
    dependsOn: [],
    baseline: { rps: 480, p50Ms: 11, errorRate: 0.0003, saturation: 0.55, instances: 3 },
  },
  {
    id: 'inventory-db',
    name: 'inventory-db',
    kind: 'datastore',
    language: 'PostgreSQL 18',
    version: '18.1',
    tier: 3,
    dependsOn: [],
    baseline: { rps: 520, p50Ms: 9, errorRate: 0.0002, saturation: 0.49, instances: 3 },
  },
  {
    id: 'ledger-db',
    name: 'ledger-db',
    kind: 'datastore',
    language: 'PostgreSQL 18',
    version: '18.1',
    tier: 3,
    dependsOn: [],
    baseline: { rps: 140, p50Ms: 14, errorRate: 0.0004, saturation: 0.37, instances: 2 },
  },
  {
    id: 'cart-cache',
    name: 'cart-cache',
    kind: 'cache',
    language: 'Valkey 9',
    version: '9.0.1',
    tier: 3,
    dependsOn: [],
    baseline: { rps: 1180, p50Ms: 1, errorRate: 0.0001, saturation: 0.33, instances: 4 },
  },
  {
    id: 'media-cache',
    name: 'media-cache',
    kind: 'cache',
    language: 'Valkey 9',
    version: '9.0.1',
    tier: 3,
    dependsOn: [],
    baseline: { rps: 2240, p50Ms: 1, errorRate: 0.0001, saturation: 0.28, instances: 4 },
  },
  {
    id: 'session-cache',
    name: 'session-cache',
    kind: 'cache',
    language: 'Valkey 9',
    version: '9.0.1',
    tier: 3,
    dependsOn: [],
    baseline: { rps: 910, p50Ms: 1, errorRate: 0.0001, saturation: 0.3, instances: 3 },
  },
  {
    id: 'ledger-queue',
    name: 'ledger-queue',
    kind: 'queue',
    language: 'NATS 2.12',
    version: '2.12.0',
    tier: 3,
    dependsOn: [],
    baseline: { rps: 420, p50Ms: 3, errorRate: 0.0002, saturation: 0.4, instances: 3 },
  },
  {
    id: 'events-stream',
    name: 'events-stream',
    kind: 'queue',
    language: 'Kafka 4.1',
    version: '4.1.0',
    tier: 3,
    dependsOn: [],
    baseline: { rps: 780, p50Ms: 4, errorRate: 0.0002, saturation: 0.46, instances: 3 },
  },
  {
    id: 'model-store',
    name: 'model-store',
    kind: 'datastore',
    language: 'S3-compatible',
    version: 'n/a',
    tier: 3,
    dependsOn: [],
    baseline: { rps: 60, p50Ms: 62, errorRate: 0.0005, saturation: 0.22, instances: 1 },
  },
]

/** Fast lookup by id. Built once at module load. */
export const SERVICE_BY_ID: ReadonlyMap<string, ServiceDescriptor> = new Map(
  SERVICE_CATALOG.map((service) => [service.id, service]),
)

/**
 * The service the "user" is notionally hitting — used as the entry point when
 * synthesising traces.
 */
export const EDGE_SERVICE_ID = 'edge-gateway'
