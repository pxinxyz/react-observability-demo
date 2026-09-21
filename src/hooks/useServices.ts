import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, queryKeys } from '@/api/client'
import { useScenario } from '@/state/scenario'

/**
 * The service catalogue and every service's current health.
 *
 * Polled on the simulator's own cadence: the fabricated estate is bucketed to
 * 15 seconds, so refetching faster would return identical bytes.
 */
export function useServices() {
  const { scenarioId } = useScenario()

  return useQuery({
    queryKey: queryKeys.services(scenarioId),
    queryFn: () => api.getServices(scenarioId),
    refetchInterval: 15_000,
    staleTime: 10_000,
    // Keeps the previous estate on screen while the next scenario loads, so
    // switching scenarios does not blank the dashboard.
    placeholderData: keepPreviousData,
  })
}

/** Convenience selector for the header tiles. */
export function useSummary() {
  return useServices().data?.summary
}
