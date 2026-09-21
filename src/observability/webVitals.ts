import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals'
import type { Metric } from 'web-vitals'
import type { Histogram } from '@opentelemetry/api'
import { getMeter } from './metrics'
import type { AttributeValue } from './types'

/**
 * Real Core Web Vitals, recorded as real OTel instruments.
 *
 * This is the least arguable telemetry in the project: the browser measured its
 * own rendering performance and these are the numbers. Nothing here is simulated
 * — LCP is genuinely how long the largest element took to paint.
 *
 * These are also the natural answer to "what would you actually monitor in a
 * frontend?", which is why they are wired to the same pipeline as everything else
 * rather than living in a separate RUM SDK.
 */

export interface VitalReading {
  name: string
  value: number
  unit: string
  /** `good` | `needs-improvement` | `poor`, per Google's thresholds. */
  rating: string
  /** Milliseconds since epoch of the most recent report. */
  at: number
  /** How the value was obtained, e.g. `navigate` or `back-forward-cache`. */
  navigationType: string
}

const MAX_READINGS = 10

class VitalsStore {
  private readings: VitalReading[] = []
  private listeners = new Set<() => void>()

  record(reading: VitalReading): void {
    // One slot per metric name, newest first.
    this.readings = [reading, ...this.readings.filter((r) => r.name !== reading.name)].slice(
      0,
      MAX_READINGS,
    )
    for (const listener of this.listeners) listener()
  }

  /** Stable identity between mutations, for `useSyncExternalStore`. */
  getSnapshot = (): VitalReading[] => this.readings

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export const vitalsStore = new VitalsStore()

interface VitalSpec {
  /** Metric name suffix, e.g. `lcp` in `browser.web_vitals.lcp`. */
  key: string
  label: string
  unit: string
  description: string
  subscribe: (callback: (metric: Metric) => void) => void
}

const SPECS: readonly VitalSpec[] = [
  {
    key: 'lcp',
    label: 'LCP',
    unit: 'ms',
    description: 'Largest Contentful Paint — when the main content finished rendering.',
    subscribe: (callback) => onLCP(callback, { reportAllChanges: false }),
  },
  {
    key: 'inp',
    label: 'INP',
    unit: 'ms',
    description: 'Interaction to Next Paint — responsiveness across the whole session.',
    subscribe: (callback) => onINP(callback, { reportAllChanges: false }),
  },
  {
    key: 'cls',
    label: 'CLS',
    unit: 'score',
    description: 'Cumulative Layout Shift — visual stability.',
    subscribe: (callback) => onCLS(callback, { reportAllChanges: false }),
  },
  {
    key: 'ttfb',
    label: 'TTFB',
    unit: 'ms',
    description: 'Time to First Byte — server and network responsiveness.',
    subscribe: (callback) => onTTFB(callback, { reportAllChanges: false }),
  },
  {
    key: 'fcp',
    label: 'FCP',
    unit: 'ms',
    description: 'First Contentful Paint — when anything first appeared on screen.',
    subscribe: (callback) => onFCP(callback, { reportAllChanges: false }),
  },
]

export function initWebVitals(): string[] {
  const meter = getMeter()
  if (!meter) return []

  const histograms = new Map<string, Histogram>()
  const registered: string[] = []

  for (const spec of SPECS) {
    const histogram = meter.createHistogram(`browser.web_vitals.${spec.key}`, {
      description: spec.description,
      unit: spec.unit,
      advice: {
        explicitBucketBoundaries:
          spec.unit === 'score'
            ? [0, 0.05, 0.1, 0.15, 0.25, 0.5, 1]
            : [100, 300, 500, 1000, 1500, 2000, 2500, 4000, 6000, 10000],
      },
    })
    histograms.set(spec.key, histogram)

    spec.subscribe((metric) => {
      const attributes: Record<string, AttributeValue> = {
        'browser.web_vitals.rating': metric.rating,
        'browser.web_vitals.navigation_type': metric.navigationType ?? 'unknown',
        'browser.web_vitals.id': metric.id,
      }

      histogram.record(metric.value, attributes)

      vitalsStore.record({
        name: spec.label,
        value: Math.round(metric.value * 1000) / 1000,
        unit: spec.unit,
        rating: metric.rating,
        at: Date.now(),
        navigationType: metric.navigationType ?? 'unknown',
      })
    })

    registered.push(spec.key)
  }

  return registered
}
