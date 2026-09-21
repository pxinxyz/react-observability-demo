import { getObservabilityStatus } from '@/observability'
import type { ObservabilityStatus } from '@/observability'

/**
 * The resolved observability configuration.
 *
 * Not reactive by design: `initObservability()` runs once before React mounts and
 * nothing about the configuration can change afterwards, so this is a plain read
 * rather than a subscription. Keeping it a hook preserves the option of making it
 * reactive later without touching call sites.
 */
export function useObservabilityStatus(): ObservabilityStatus {
  return getObservabilityStatus()
}
