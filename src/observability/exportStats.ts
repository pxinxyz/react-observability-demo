import type { ExportAttempt, ExportStatsSnapshot, SignalName } from './types'

/**
 * `ExportResult` from `@opentelemetry/core`, declared structurally so this
 * module does not take a direct dependency on a transitive package.
 */
interface ExportResultLike {
  code: number
  error?: Error
}

/**
 * Evidence that the export pipeline is actually working.
 *
 * The most common failure mode for browser OTel is silence: the endpoint is
 * wrong, CORS eats the request, or the collector is not running, and the app
 * looks completely normal because the SDK swallows exporter errors into
 * diagnostics. This module makes those failures visible in the UI.
 *
 * Rather than reimplementing each exporter interface (and drifting from them on
 * every release), `instrumentExporter` returns a `Proxy` that forwards every
 * property to the real exporter and only intercepts `export`. One wrapper works
 * for spans, metrics and logs alike.
 */

const MAX_ATTEMPTS = 60

/** `ExportResultCode.SUCCESS`. Compared numerically to avoid a `core` dependency. */
const SUCCESS = 0

class ExportStatsStore {
  private attempts: ExportAttempt[] = []
  private snapshot: ExportStatsSnapshot = emptySnapshot()
  private listeners = new Set<() => void>()

  record(attempt: ExportAttempt): void {
    this.attempts.push(attempt)
    if (this.attempts.length > MAX_ATTEMPTS) {
      this.attempts.splice(0, this.attempts.length - MAX_ATTEMPTS)
    }
    this.snapshot = derive(this.attempts)
    for (const listener of this.listeners) listener()
  }

  /** Stable identity between mutations, for `useSyncExternalStore`. */
  getSnapshot = (): ExportStatsSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  reset(): void {
    this.attempts = []
    this.snapshot = emptySnapshot()
    for (const listener of this.listeners) listener()
  }
}

function emptySnapshot(): ExportStatsSnapshot {
  return {
    attempts: [],
    succeeded: 0,
    failed: 0,
    itemsExported: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
  }
}

function derive(attempts: readonly ExportAttempt[]): ExportStatsSnapshot {
  let succeeded = 0
  let failed = 0
  let itemsExported = 0
  let lastSuccessAt: number | null = null
  let lastFailureAt: number | null = null
  let lastError: string | null = null

  for (const attempt of attempts) {
    if (attempt.ok) {
      succeeded += 1
      itemsExported += attempt.itemCount
      if (lastSuccessAt === null || attempt.at > lastSuccessAt) lastSuccessAt = attempt.at
    } else {
      failed += 1
      if (lastFailureAt === null || attempt.at > lastFailureAt) {
        lastFailureAt = attempt.at
        lastError = attempt.error
      }
    }
  }

  return {
    attempts: [...attempts],
    succeeded,
    failed,
    itemsExported,
    lastSuccessAt,
    lastFailureAt,
    lastError,
  }
}

export const exportStats = new ExportStatsStore()

/**
 * Wrap an OTLP exporter so every export attempt is recorded.
 *
 * Methods are bound to the real target so proxying cannot break `this`, and the
 * three OTLP exporters all use TypeScript `private` (compile-time only) rather
 * than `#private` fields, which would not survive a proxy.
 */
export function instrumentExporter<T extends object>(inner: T, signal: SignalName): T {
  return new Proxy(inner, {
    get(target, property, receiver) {
      if (property === 'export') {
        return (items: unknown, callback: (result: ExportResultLike) => void): void => {
          const itemCount = countItems(items)

          const wrapped = (result: ExportResultLike): void => {
            const ok = result.code === SUCCESS
            exportStats.record({
              signal,
              ok,
              itemCount,
              at: Date.now(),
              error: ok ? null : (result.error?.message ?? `export failed with code ${result.code}`),
            })
            callback(result)
          }

          try {
            ;(target as { export: (i: unknown, cb: (r: ExportResultLike) => void) => void }).export(
              items,
              wrapped,
            )
          } catch (error) {
            exportStats.record({
              signal,
              ok: false,
              itemCount,
              at: Date.now(),
              error: error instanceof Error ? error.message : String(error),
            })
            throw error
          }
        }
      }

      const value = Reflect.get(target, property, receiver) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as T
}

/** Spans and log records arrive as arrays; metric batches arrive as one object. */
function countItems(items: unknown): number {
  if (Array.isArray(items)) return items.length
  const scopeMetrics = (items as { scopeMetrics?: Array<{ metrics?: unknown[] }> })?.scopeMetrics
  if (Array.isArray(scopeMetrics)) {
    return scopeMetrics.reduce((sum, scope) => sum + (scope.metrics?.length ?? 0), 0)
  }
  return 1
}
