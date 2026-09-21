import type { IncidentSeverity, IncidentStatus, ServiceHealth } from '@simulator/types'
import type { Tone } from '@/components/ui/primitives'

/**
 * Mapping from domain states to the single `Tone` vocabulary the UI uses.
 *
 * Centralised so that "critical" is the same red in the service table, the
 * incident feed and the metric charts. Colour that drifts between panels is how
 * dashboards become unreadable.
 */

export function healthTone(health: ServiceHealth): Tone {
  switch (health) {
    case 'healthy':
      return 'ok'
    case 'degraded':
      return 'warn'
    case 'critical':
      return 'crit'
    default:
      return 'neutral'
  }
}

export function severityTone(severity: IncidentSeverity): Tone {
  switch (severity) {
    case 'sev1':
      return 'crit'
    case 'sev2':
      return 'warn'
    case 'sev3':
      return 'info'
    case 'sev4':
    default:
      return 'neutral'
  }
}

export function incidentStatusTone(status: IncidentStatus): Tone {
  switch (status) {
    case 'open':
      return 'crit'
    case 'mitigating':
      return 'warn'
    case 'monitoring':
      return 'info'
    case 'resolved':
    default:
      return 'ok'
  }
}

/** OTel span status, for the waterfall and span detail rows. */
export function spanStatusTone(
  status: 'UNSET' | 'OK' | 'ERROR' | 'ok' | 'error' | 'unset',
): Tone {
  if (status === 'ERROR' || status === 'error') return 'crit'
  if (status === 'OK' || status === 'ok') return 'ok'
  return 'neutral'
}

export function logSeverityTone(severityText: string): Tone {
  switch (severityText.toUpperCase()) {
    case 'FATAL':
    case 'ERROR':
      return 'crit'
    case 'WARN':
      return 'warn'
    case 'INFO':
      return 'accent'
    case 'DEBUG':
    case 'TRACE':
      return 'neutral'
    default:
      return 'neutral'
  }
}

/**
 * Saturation is the one place where "more" is not monotonically worse in the
 * same way error rate is, so the thresholds are explicit rather than linear.
 */
export function saturationTone(saturation: number): Tone {
  if (saturation >= 0.85) return 'crit'
  if (saturation >= 0.7) return 'warn'
  if (saturation >= 0.5) return 'accent'
  return 'ok'
}

/** Error-budget tone runs the opposite way: a low remaining budget is bad. */
export function budgetTone(remaining: number): Tone {
  if (remaining <= 0.1) return 'crit'
  if (remaining <= 0.3) return 'warn'
  return 'ok'
}

export const SERVICE_KIND_LABEL: Record<string, string> = {
  gateway: 'gateway',
  api: 'service',
  worker: 'worker',
  datastore: 'database',
  cache: 'cache',
  queue: 'queue',
}
